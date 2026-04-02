#!/usr/bin/env bun
/**
 * security-pg-hba.ts — Postgres pg_hba.conf audit
 * Verifies auth rules are correct (no trust/md5 over 0.0.0.0/0)
 */

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID ?? ''

async function sendTelegram(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
  })
}

interface PgHbaIssue {
  severity: 'WARN' | 'CRITICAL'
  line: string
  reason: string
}

function auditPgHba(path: string): PgHbaIssue[] {
  const issues: PgHbaIssue[] = []
  const lines = readFileSync(path, 'utf8').split('\n')

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const parts = trimmed.split(/\s+/)
    if (parts.length < 4) continue

    const type = parts[0]
    const database = parts[1]
    const user = parts[2]
    const cidr = parts[parts.length - 2]
    const method = parts[parts.length - 1]

    // CRITICAL: trust or md5 over 0.0.0.0/0 (remote access without strong auth)
    if (cidr === '0.0.0.0/0' || cidr === '::/0') {
      if (method === 'trust') {
        issues.push({ severity: 'CRITICAL', line: trimmed, reason: `trust auth on ${cidr} — no password required` })
      }
      if (method === 'md5') {
        issues.push({ severity: 'CRITICAL', line: trimmed, reason: `md5 auth on ${cidr} — upgrade to scram-sha-256` })
      }
    }

    // WARN: trust locally (should be peer)
    if (cidr === '127.0.0.1/32' || cidr === '::1/128') {
      if (method === 'trust') {
        issues.push({ severity: 'WARN', line: trimmed, reason: 'trust on localhost — prefer peer or scram-sha-256' })
      }
    }

    // WARN: password auth without encryption
    if (method === 'password') {
      issues.push({ severity: 'WARN', line: trimmed, reason: 'password method — plaintext on network' })
    }
  }

  return issues
}

function findPgHba(): string | null {
  // Try common locations
  const candidates = [
    '/etc/postgresql/16/main/pg_hba.conf',
    '/etc/postgresql/15/main/pg_hba.conf',
    '/etc/postgresql/14/main/pg_hba.conf',
    '/opt/homebrew/etc/postgresql/pg_hba.conf',
    process.env.PGDATA ? `${process.env.PGDATA}/pg_hba.conf` : null,
  ].filter(Boolean) as string[]

  for (const path of candidates) {
    if (existsSync(path)) return path
  }

  return null
}

async function main() {
  console.log('[pg-hba] Starting...')

  const hbaPath = findPgHba()
  if (!hbaPath) {
    console.log('[pg-hba] pg_hba.conf not found locally — skipping (DB on m1)')
    process.exit(0)
  }

  console.log(`[pg-hba] Checking ${hbaPath}...`)
  const issues = auditPgHba(hbaPath)

  if (issues.length > 0) {
    console.error(`[pg-hba] FOUND ${issues.length} issues:`)
    issues.forEach(i => console.error(`  [${i.severity}] ${i.reason}`))

    const criticals = issues.filter(i => i.severity === 'CRITICAL')
    const msg = `[HADES] pg_hba.conf ALERT\n\n${criticals.length > 0 ? `${criticals.length} CRITICAL issues:\n${criticals.map(c => `${c.reason}`).join('\n')}` : `${issues.length} warnings`}\n\n${hbaPath}\n\nReview pg_hba.conf immediately.`
    try { sendTelegram(msg) } catch {}
    process.exit(1)
  }

  console.log('[pg-hba] ✅ pg_hba.conf OK')
  process.exit(0)
}

main()
