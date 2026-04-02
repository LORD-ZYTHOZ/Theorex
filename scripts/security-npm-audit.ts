#!/usr/bin/env bun
/**
 * security-npm-audit.ts — NPM CVE scan
 * Weekly security sweep for Theorex dependencies
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID ?? ''
const PROJECT_DIR = '/Users/eoh/.openclaw/projects/theorex'

async function sendTelegram(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
  })
}

function main() {
  console.log('[npm-audit] Scanning...')

  const result = spawnSync('npm', ['audit', '--audit-level=high', '--json'], {
    cwd: PROJECT_DIR,
    timeout: 60000,
  })

  let vulns: Array<{ severity: string; name: string; url: string }> = []

  if (result.status !== 0) {
    try {
      const audit = JSON.parse(result.stdout.toString())
      const adr = audit?.auditRecords ?? {}
      for (const [, record] of Object.entries(adr as Record<string, any>)) {
        const sev = record?.vulnerability?.severity
        if (sev === 'high' || sev === 'critical') {
          vulns.push({
            severity: sev,
            name: record.vulnerability.name,
            url: record.vulnerability.url || '',
          })
        }
      }
    } catch (e) {
      console.error('[npm-audit] Parse error:', e)
    }
  }

  if (vulns.length > 0) {
    console.error(`[npm-audit] FOUND ${vulns.length} vulnerabilities:`)
    vulns.slice(0, 10).forEach(v => console.error(`  ${v.severity}: ${v.name}`))

    const msg = `[HADES] NPM CVE ALERT\n\nFound ${vulns.length} ${vulns.some(v => v.severity === 'critical') ? 'CRITICAL' : 'HIGH'} vulnerabilities\n\n${vulns.slice(0, 5).map(v => `${v.severity}: ${v.name}`).join('\n')}\n\nRun: npm audit fix in ${PROJECT_DIR}`
    try { sendTelegram(msg) } catch {}
    process.exit(1)
  }

  console.log('[npm-audit] ✅ No critical/high vulnerabilities')
  process.exit(0)
}

main()
