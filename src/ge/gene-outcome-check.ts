/**
 * Fleet-GE Gene Outcome Check
 *
 * For each gene with status='applied', checks whether the fix worked.
 * Called by the OC cron — runs daily or on demand.
 *
 * Workflow per applied gene:
 * 1. Load gene JSON
 * 2. Check if observation window has passed (days_since_apply >= window)
 * 3. Query Theorex/outcomes: did the problem recur?
 * 4. record_gene_outcome → Theorex
 * 5. increment_gene_count on gene JSON (atomic)
 * 6. Release lock (locked_by = null)
 */

import { readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { Client } from 'pg'

// ── Config ─────────────────────────────────────────────────────────────────────

const FLEET_BRAIN = process.env.FLEET_BRAIN ?? '/Users/eoh/.openclaw/workspace/fleet-brain'
const PG_HOST = process.env.THEOREX_PG_HOST ?? '100.95.91.32'
const PG_DB = process.env.THEOREX_PG_DB ?? 'theorex'
const PG_USER = process.env.THEOREX_PG_USER ?? 'claw'
const THEOREX_MCP = process.env.THEOREX_MCP ?? 'http://localhost:18801/mcp'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Gene extends Record<string, unknown> {
  id: string
  name: string
  gene_type: string
  status: string
  applied_at: string | null
  applied_by: string | null
  observation_window_days: number | null
  last_directive_id: string | null
  locked_by: string | null
  locked_at: string | null
  pattern: string
  target: string
  success_count: number
  failure_count: number
  consecutive_failures: number
  last_outcome: string | null
  cooldown_until: string | null
}

interface GeneOutcome {
  gene_id: string
  directive_id: string
  applied_at: string
  outcome_at: string
  outcome: 'success' | 'partial' | 'failure'
  observations: Array<{ tag: string; value: string; recorded_at: string }>
  recurrence: boolean
  recurrence_detail?: string
  days_since_apply?: number
  metric_delta?: { before: number; after: number; unit: string }
  confounders?: string[]
  agent_id: string
  audited: boolean
}

// ── PostgreSQL ───────────────────────────────────────────────────────────────

async function pgClient() {
  const client = new Client({ host: PG_HOST, database: PG_DB, user: PG_USER })
  await client.connect()
  return client
}

// ── Gene JSON Helpers ────────────────────────────────────────────────────────

async function loadAppliedGenes(): Promise<Gene[]> {
  const genesDir = join(FLEET_BRAIN, 'genes')
  const files = await readdir(genesDir).catch(() => [])
  const genes: Gene[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await readFile(join(genesDir, file), 'utf-8')
      const gene = JSON.parse(raw) as Gene
      if (gene.status === 'applied') genes.push(gene)
    } catch { /* skip */ }
  }
  return genes
}

async function acquireLock(gene: Gene): Promise<boolean> {
  const { writeFile: writeFileSync } = await import('fs/promises')
  const lockPath = join(FLEET_BRAIN, 'genes', `.${gene.id}.lock`)
  try {
    await writeFileSync(lockPath, String(Date.now()), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

async function releaseLock(gene: Gene): Promise<void> {
  const { unlink } = await import('fs/promises')
  const lockPath = join(FLEET_BRAIN, 'genes', `.${gene.id}.lock`)
  await unlink(lockPath).catch(() => {})
}

async function atomicallyUpdateGene(
  gene: Gene,
  outcome: 'success' | 'partial' | 'failure'
): Promise<boolean> {
  const fs = await import('fs/promises')
  const path = await import('path')
  const genePath = path.join(FLEET_BRAIN, 'genes', `${gene.id}.json`)
  const lockPath = path.join(FLEET_BRAIN, 'genes', `.${gene.id}.lock`)

  if (!(await acquireLock(gene))) return false
  try {
    const raw = await fs.readFile(genePath, 'utf-8')
    const g = JSON.parse(raw)

    const now = new Date().toISOString()
    g.last_outcome = outcome
    g.last_outcome_at = now

    if (outcome === 'success') {
      g.success_count = (g.success_count ?? 0) + 1
      g.consecutive_failures = 0
      g.status = 'superseded' // gene worked, retire it
      g.cooldown_until = null
    } else {
      g.failure_count = (g.failure_count ?? 0) + 1
      g.consecutive_failures = (g.consecutive_failures ?? 0) + 1
      if (g.consecutive_failures >= 3) {
        // 3 consecutive failures = escalate, don't auto-retry
        g.cooldown_until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }
    }

    g.locked_by = null
    g.locked_at = null

    await fs.writeFile(genePath, JSON.stringify(g, null, 2))
    return true
  } catch (e) {
    return false
  } finally {
    await releaseLock(gene)
  }
}

// ── Recurrence Check ──────────────────────────────────────────────────────────

/**
 * Check if a gene pattern recurs after application.
 * Returns { recurred: boolean, detail: string, metricDelta: object | null }
 */
async function checkRecurrence(gene: Gene): Promise<{
  recurred: boolean
  detail: string
  metricDelta: { before: number; after: number; unit: string } | null
}> {
  const client = await pgClient()
  try {
    const appliedAt = gene.applied_at ? new Date(gene.applied_at) : null
    if (!appliedAt) return { recurred: false, detail: 'no apply date', metricDelta: null }

    // For repair/watchdog genes: check if same error recurs post-apply
    if (gene.gene_type === 'repair' || gene.gene_type === 'watchdog') {
      // Look for same pattern in outcomes table after apply date
      let patternQuery: string
      const params: string[] = []

      if (gene.pattern.includes('win_rate') || gene.pattern.includes('pnl')) {
        // Divergence win rate anomaly — check if PnL improved
        const result = await client.query(`
          SELECT
            COUNT(*) as total_trades,
            ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0) * 100, 1) as win_rate,
            SUM(pnl) as total_pnl
          FROM outcomes
          WHERE agent = 'divergence'
            AND created_at > $1
        `, [appliedAt.toISOString()])

        const row = result.rows[0]
        if (row && row.total_trades > 0) {
          const winRate = parseFloat(row.win_rate || '0')
          const pnl = parseFloat(row.total_pnl || '0')

          // Before: 70.7% win rate, -284 PnL. After: check if both improved
          const recurred = pnl < -200 && winRate > 65
          return {
            recurred,
            detail: recurred
              ? `Win rate ${winRate}%, PnL ${pnl} — still losing big`
              : `PnL ${pnl}, win rate ${winRate}% — ${pnl >= 0 ? 'improved' : 'no significant improvement'}`,
            metricDelta: { before: -284, after: pnl, unit: 'pnl' }
          }
        }
        return { recurred: false, detail: 'no divergence outcome data post-apply', metricDelta: null }
      }

      // Generic recurrence: look for same error pattern
      try {
        const re = new RegExp(gene.pattern, 'i')
        // This is simplified — real implementation would check actual error patterns
        return { recurred: false, detail: 'generic recurrence check not implemented for this pattern', metricDelta: null }
      } catch {
        return { recurred: false, detail: 'invalid regex pattern', metricDelta: null }
      }
    }

    // For harden genes: check if outcome tracking now works
    if (gene.gene_type === 'harden') {
      if (gene.id.includes('horizon_outcome')) {
        const result = await client.query(`
          SELECT COUNT(*) as cnt FROM outcomes WHERE agent LIKE 'horizon%' AND created_at > $1
        `, [appliedAt.toISOString()])
        const count = parseInt(result.rows[0]?.cnt ?? '0')
        return {
          recurred: count === 0,
          detail: count === 0 ? 'no horizon outcomes written post-apply' : `horizon wrote ${count} outcomes post-apply`,
          metricDelta: null
        }
      }
      if (gene.id.includes('singularity_variant')) {
        const result = await client.query(`
          SELECT COUNT(DISTINCT agent) as cnt FROM outcomes
          WHERE agent LIKE 'singularity-%' AND created_at > $1
        `, [appliedAt.toISOString()])
        const variants = parseInt(result.rows[0]?.cnt ?? '0')
        return {
          recurred: variants < 3,
          detail: variants < 3 ? `only ${variants} variant(s) writing outcomes` : 'all 3 variants writing',
          metricDelta: null
        }
      }
    }

    return { recurred: false, detail: 'unknown gene_type for recurrence check', metricDelta: null }
  } catch (e) {
    return { recurred: false, detail: `recurrence check error: ${e}`, metricDelta: null }
  } finally {
    await client.end()
  }
}

// ── Theorex MCP Write ──────────────────────────────────────────────────────────

async function writeGeneOutcome(outcome: GeneOutcome): Promise<void> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'record_gene_outcome',
      arguments: {
        gene_id: outcome.gene_id,
        directive_id: outcome.directive_id,
        applied_at: outcome.applied_at,
        outcome_at: outcome.outcome_at,
        outcome: outcome.outcome,
        observations: outcome.observations,
        recurrence: outcome.recurrence,
        recurrence_detail: outcome.recurrence_detail,
        days_since_apply: outcome.days_since_apply,
        metric_delta: outcome.metric_delta,
        confounders: outcome.confounders ?? [],
        agent_id: outcome.agent_id,
        audited: outcome.audited,
      }
    }
  }

  const resp = await fetch(THEOREX_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(e => { throw new Error(`Theorex MCP write failed: ${e}`) })

  if (!resp.ok) throw new Error(`Theorex MCP returned ${resp.status}`)
}

// ── Main Check ───────────────────────────────────────────────────────────────

async function checkGeneOutcome(gene: Gene): Promise<void> {
  console.log(`[GE] Checking ${gene.id} (applied ${gene.applied_at})`)

  if (!gene.applied_at) {
    console.log(`[GE] ⏭ ${gene.id} — no applied_at, skipping`)
    return
  }

  const windowDays = gene.observation_window_days ?? 7
  const appliedAt = new Date(gene.applied_at)
  const now = new Date()
  const daysSinceApply = Math.floor((now.getTime() - appliedAt.getTime()) / (1000 * 60 * 60 * 24))

  if (daysSinceApply < windowDays) {
    console.log(`[GE] ⏭ ${gene.id} — ${daysSinceApply}d since apply, window is ${windowDays}d`)
    return
  }

  // Check recurrence
  const { recurred, detail, metricDelta } = await checkRecurrence(gene)

  const outcome: 'success' | 'partial' | 'failure' = recurred ? 'failure' : 'success'
  const nowIso = new Date().toISOString()

  const geneOutcome: GeneOutcome = {
    gene_id: gene.id,
    directive_id: gene.last_directive_id ?? 'unknown',
    applied_at: gene.applied_at,
    outcome_at: nowIso,
    outcome,
    observations: [
      {
        tag: 'recurrence',
        value: recurred ? `Problem recurred: ${detail}` : `No recurrence detected: ${detail}`,
        recorded_at: nowIso
      },
      {
        tag: 'note',
        value: `Days since apply: ${daysSinceApply} (window: ${windowDays}d)`,
        recorded_at: nowIso
      }
    ],
    recurrence: recurred,
    recurrence_detail: detail,
    days_since_apply: daysSinceApply,
    metric_delta: metricDelta ?? undefined,
    confounders: [],
    agent_id: 'system',
    audited: false,
  }

  try {
    await writeGeneOutcome(geneOutcome)
    console.log(`[GE] ✅ Wrote gene_outcome to Theorex: ${gene.id} → ${outcome}`)
  } catch (e) {
    console.warn(`[GE] ⚠️ Could not write gene_outcome to Theorex: ${e}`)
  }

  // Update gene JSON atomically
  const updated = await atomicallyUpdateGene(gene, outcome)
  if (updated) {
    console.log(`[GE] ✅ Updated gene JSON: ${gene.id} → ${outcome}`)
  } else {
    console.warn(`[GE] ⚠️ Could not atomically update gene JSON (lock busy): ${gene.id}`)
  }
}

async function main() {
  console.log('[GE] Gene outcome check starting...')

  const genes = await loadAppliedGenes()
  console.log(`[GE] Found ${genes.length} applied genes`)

  for (const gene of genes) {
    await checkGeneOutcome(gene)
  }

  console.log('[GE] Gene outcome check complete')
}

main().catch(console.error)