#!/usr/bin/env bun
/**
 * verify-backup.ts — Verify latest pg_dump backup isn't corrupt
 *
 * Run after backup-postgres.sh completes:
 *   1. Find latest .sql.gz in ~/backups/theorex/
 *   2. Extract to temp DB (theorex_verify)
 *   3. Check row counts on key tables match expected thresholds
 *   4. Alert via Telegram if corrupt
 *   5. Clean up temp DB
 *
 * Usage: bun scripts/verify-backup.ts
 * Exit codes: 0=OK, 1=corrupt, 2=no backup found, 3=config error
 */

const BACKUP_DIR = `${process.env.HOME}/backups/theorex`
const { mkdirSync, readdirSync, statSync, existsSync } = require('node:fs')
const TEMP_DB = 'theorex_verify'
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID ?? ''  // Ph3x

// Key tables + minimum row thresholds (catches schema-level corruption)
const MIN_ROWS: Record<string, number> = {
  concepts: 100,
  concept_edges: 50,
  flash_events: 10,
  agent_tasks: 0,  // may be empty, just check table exists
}

// Tables that must exist (schema-level check)
const REQUIRED_TABLES = ['concepts', 'concept_edges', 'flash_events', 'agent_tasks']

async function sendTelegram(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
  })
}

function latestBackup(): string | null {
  if (!existsSync(BACKUP_DIR)) return null
  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.sql.gz'))
    .map(f => ({ f, mtime: statSync(`${BACKUP_DIR}/${f}`).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  return files.length > 0 ? `${BACKUP_DIR}/${files[0].f}` : null
}

async function verifyBackup(backupFile: string): Promise<{ ok: boolean; error?: string; details?: string[] }> {
  const { spawnSync } = require('node:child_process')

  // Create temp DB
  const dropSql = `DROP DATABASE IF EXISTS ${TEMP_DB};`
  const createSql = `CREATE DATABASE ${TEMP_DB};`
  spawnSync('psql', ['-h', 'localhost', '-U', 'claw', '-c', dropSql], { stdio: 'pipe' })
  const createResult = spawnSync('psql', ['-h', 'localhost', '-U', 'claw', '-c', createSql], { stdio: 'pipe' })
  if (createResult.status !== 0) {
    return { ok: false, error: `Failed to create temp DB: ${createResult.stderr.toString()}` }
  }

  try {
    // Restore
    const gunzip = require('node:child_process').spawn('gunzip', ['-c', backupFile], { stdio: 'pipe' })
    const psql = require('node:child_process').spawn('psql', ['-h', 'localhost', '-U', 'claw', '-d', TEMP_DB], { stdio: 'pipe' })

    let restoreErr = ''
    psql.stderr.on('data', (d: Buffer) => { restoreErr += d.toString() })

    await new Promise<void>((resolve, reject) => {
      gunzip.stdout.pipe(psql.stdin as any)
      psql.on('close', (code: number) => {
        if (code !== 0) reject(new Error(`psql restore failed: ${restoreErr}`))
        else resolve()
      })
      gunzip.on('error', reject)
    })

    const details: string[] = []
    const errors: string[] = []

    // Check required tables exist
    const tablesResult = spawnSync('psql', [
      '-h', 'localhost', '-U', 'claw', '-d', TEMP_DB,
      '-t', '-c', "SELECT tablename FROM pg_tables WHERE schemaname='public'"
    ], { stdio: 'pipe', encoding: 'utf8' })

    const existingTables = (tablesResult.stdout as string)
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean)

    for (const table of REQUIRED_TABLES) {
      if (!existingTables.includes(table)) {
        errors.push(`MISSING TABLE: ${table}`)
      }
    }

    // Check row counts
    for (const [table, minRows] of Object.entries(MIN_ROWS)) {
      if (!existingTables.includes(table)) continue
      const result = spawnSync('psql', [
        '-h', 'localhost', '-U', 'claw', '-d', TEMP_DB,
        '-t', '-c', `SELECT COUNT(*) FROM ${table}`
      ], { stdio: 'pipe', encoding: 'utf8' })
      const count = parseInt((result.stdout as string).trim() || '0', 10)
      details.push(`${table}: ${count} rows`)

      if (count < minRows) {
        errors.push(`LOW ROWS: ${table} has ${count} rows (min: ${minRows})`)
      }
    }

    // Quick integrity check
    const integrityResult = spawnSync('psql', [
      '-h', 'localhost', '-U', 'claw', '-d', TEMP_DB,
      '-c', 'SELECT 1'  // just verify connection works
    ], { stdio: 'pipe' })

    if (integrityResult.status !== 0) {
      errors.push(`INTEGRITY FAIL: ${integrityResult.stderr.toString().slice(0, 100)}`)
    }

    if (errors.length > 0) {
      return { ok: false, error: errors.join('; '), details }
    }

    return { ok: true, details }
  } finally {
    // Clean up temp DB
    spawnSync('psql', ['-h', 'localhost', '-U', 'claw', '-c', `DROP DATABASE IF EXISTS ${TEMP_DB}`], { stdio: 'pipe' })
  }
}

async function main() {
  const backup = latestBackup()
  if (!backup) {
    console.log('[verify-backup] No backup found')
    process.exit(2)
  }

  const fileAge = Date.now() - statSync(backup).mtime.getTime()
  const ageHours = Math.round(fileAge / 3600000)
  console.log(`[verify-backup] Checking: ${backup} (${ageHours}h old)`)

  const result = await verifyBackup(backup)
  const size = Math.round(require('node:fs').statSync(backup).size / 1024 / 1024)

  if (result.ok) {
    console.log(`[verify-backup] ✅ Backup OK — ${size}MB`)
    result.details?.forEach(d => console.log(`  ${d}`))
    process.exit(0)
  } else {
    console.error(`[verify-backup] ❌ CORRUPT: ${result.error}`)
    result.details?.forEach(d => console.log(`  ${d}`))

    // Alert
    const msg = `[HADES] Theorex Backup CORRUPT\n\nFile: ${backup.split('/').pop()}\nError: ${result.error}\n\nCheck backup log immediately.`
    try { await sendTelegram(msg) } catch (e) { /* non-blocking */ }
    process.exit(1)
  }
}

main()
