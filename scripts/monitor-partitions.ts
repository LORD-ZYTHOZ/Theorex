#!/usr/bin/env bun
/**
 * monitor-partitions.ts — Partition health monitor with Telegram alerting
 *
 * Runs daily (OC cron or manual).
 * Checks:
 *   1. Next month's partition exists — alert if missing
 *   2. Current month partition healthy
 *   3. Partition count within reasonable bounds
 *
 * Usage: bun scripts/monitor-partitions.ts
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID ?? ''

async function sendTelegram(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
  })
  if (!resp.ok) console.error(`[telegram] send failed: ${resp.status} ${await resp.text()}`)
  else console.log('[telegram] alert sent')
}

function monthKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}_${m}`
}

async function checkPartitions(): Promise<{
  ok: boolean
  alerts: string[]
  info: string[]
  nextKey: string
  currentKey: string
  totalCount: number
}> {
  const sql = new (await import('bun')).SQL({
    host: process.env.THEOREX_PG_HOST || '100.95.91.32',
    port: Number(process.env.THEOREX_PG_PORT || 5432),
    user: process.env.THEOREX_PG_USER || 'claw',
    database: process.env.THEOREX_PG_DB || 'theorex',
    max: 2,
  })

  try {
    const now = new Date()
    const nextKey = monthKey(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    const currentKey = monthKey(now)

    const rows = await sql`
      SELECT c.relname AS partition_name
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE parent.relname = 'flash_events'
      ORDER BY c.relname
    `

    const partitionNames = rows.map((r: any) => r.partition_name as string)
    const partitionKeys = partitionNames.map((n: string) => {
      const m = n.match(/^flash_events_(\d{4}_\d{2})$/)
      return m ? m[1] : null
    }).filter(Boolean) as string[]

    const alerts: string[] = []
    const info: string[] = []

    // Check next month
    if (!partitionKeys.includes(nextKey)) {
      alerts.push(`🚨 NEXT MONTH MISSING: flash_events_${nextKey}`)
    } else {
      info.push(`✅ Next month partition: flash_events_${nextKey}`)
    }

    // Check current month
    if (!partitionKeys.includes(currentKey)) {
      alerts.push(`🚨 CURRENT MONTH MISSING: flash_events_${currentKey}`)
    } else {
      info.push(`✅ Current month partition: flash_events_${currentKey}`)
    }

    // Check count
    const totalCount = partitionNames.length
    if (totalCount > 24) {
      alerts.push(`⚠️ HIGH COUNT: ${totalCount} partitions (max: 24)`)
    } else {
      info.push(`ℹ️ Total partitions: ${totalCount}`)
    }

    // Recent partitions
    for (const name of partitionNames.slice(-6)) {
      info.push(`  ${name}`)
    }

    return { ok: alerts.length === 0, alerts, info, nextKey, currentKey, totalCount }
  } finally {
    sql.end()
  }
}

async function main() {
  console.log('[partition-monitor] Starting...')

  const result = await checkPartitions()

  result.info.forEach(i => console.log(' ', i))

  if (result.ok) {
    console.log('[partition-monitor] ✅ All partitions healthy')
  } else {
    console.log('[partition-monitor] ⚠️ Issues found:')
    result.alerts.forEach(a => console.log(' ', a))

    const msg = `[HADES] Theorex Partition Alert\n\n${result.alerts.join('\n')}\n\nflash_events_${result.nextKey} should be created.`
    try { await sendTelegram(msg) } catch (e) {
      console.error('[partition-monitor] Telegram failed:', e)
    }
  }

  process.exit(result.ok ? 0 : 1)
}

main().catch((err) => {
  console.error('[partition-monitor] FATAL:', err)
  process.exit(1)
})
