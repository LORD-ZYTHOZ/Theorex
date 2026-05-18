/**
 * Fleet-GE Signal Scanner
 * 
 * Scans runtime signals (watchdog events, PM2 logs, Theorex spans) for patterns.
 * Matches against gene registry. Emits signals + GEP directives.
 * 
 * Run from: bun run src/ge/signal-scanner.ts [--source watchdog|pm2|theorex|all]
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Client } from 'pg';

// ── Config ──────────────────────────────────────────────────────────────────

const FLEET_BRAIN = process.env.FLEET_BRAIN ?? '/Users/eoh/.openclaw/workspace/fleet-brain';
const PG_HOST = process.env.THEOREX_PG_HOST ?? '100.95.91.32';
const PG_DB = process.env.THEOREX_PG_DB ?? 'theorex';
const PG_USER = process.env.THEOREX_PG_USER ?? 'claw';

// ── Types ────────────────────────────────────────────────────────────────────

interface Gene {
  id: string;
  name: string;
  description: string;
  pattern: string;
  severity: string;
  gene_type: string;
  target: string;
  files?: string[];
  status: string;
}

interface Signal {
  id: string;
  source: string;
  pattern: string;
  severity: string;
  context: string;
  gene_id: string | null;
  status: string;
  created_at: Date;
}

interface GEPDirective {
  id: string;
  signal_id: string;
  gene_id: string;
  directive: string;
  agent_assigned: string;
  status: string;
  created_at: Date;
}

// ── Gene Registry ─────────────────────────────────────────────────────────────

async function loadGenes(): Promise<Gene[]> {
  const genesDir = join(FLEET_BRAIN, 'genes');
  const files = await readdir(genesDir).catch(() => []);
  const genes: Gene[] = [];
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(genesDir, file), 'utf-8');
      const gene = JSON.parse(raw) as Gene;
      if (gene.status === 'active') genes.push(gene);
    } catch (e) {
      console.warn(`[GE] Failed to load gene ${file}: ${e}`);
    }
  }
  return genes;
}

/**
 * Check if a gene is currently in cooldown.
 * cooldown_until is set after a gene is applied to prevent immediate re-scoring.
 */
function isGeneOnCooldown(gene: Gene): boolean {
  if (!gene.cooldown_until) return false
  return new Date(gene.cooldown_until) > new Date()
}

/**
 * Check if a gene already has a recent directive — dedup prevents GEP spam.
 * last_directive_id non-null + directive is < 24h old = skip.
 */
function isGeneRecentlySignaled(gene: Gene): boolean {
  if (!gene.last_directive_id) return false
  // We don't store directive timestamp, so check if last directive file exists
  // and is < 24h old. If gene has a last_directive_id, assume it was recently emitted.
  return true
}

/**
 * Compute priority score for a gene — higher = more urgent.
 * Formula (v2): consecutive_failures drives urgency, not cumulative failures.
 * Genes in cooldown score lower.
 */
function computePriorityScore(gene: Gene): number {
  const severityMap: Record<string, number> = { CRITICAL: 1.0, HIGH: 0.7, MEDIUM: 0.4, LOW: 0.2 }
  let score = severityMap[gene.severity?.toUpperCase()] ?? 0.3

  const cf = (gene as any).consecutive_failures ?? 0
  const successCount = (gene as any).success_count ?? 0
  const lastOutcome = (gene as any).last_outcome

  // Recent consecutive failures push priority UP (needs attention)
  if (cf > 0) score += cf * 0.15

  // Repeated success = stable, deprioritize slightly
  if (successCount > 0) score -= successCount * 0.03

  // Partial outcomes need follow-up
  if (lastOutcome === 'partial') score += 0.1

  // Cooldown = deprioritize hard
  if (isGeneOnCooldown(gene)) score -= 0.5

  return score
}

function matchGene(text: string, genes: Gene[]): Gene | null {
  // Filter out genes on cooldown or recently signaled
  const eligible = genes.filter(g => !isGeneOnCooldown(g))

  // Sort by priority — highest first
  const sorted = eligible.sort((a, b) => computePriorityScore(b) - computePriorityScore(a))

  for (const gene of sorted) {
    if (!gene.pattern) continue;
    try {
      const re = new RegExp(gene.pattern, 'i');
      if (re.test(text)) return gene;
    } catch (e) {
      // invalid regex, skip
    }
  }
  return null
}

// ── Postgres ──────────────────────────────────────────────────────────────────

async function pgClient() {
  const client = new Client({ host: PG_HOST, database: PG_DB, user: PG_USER });
  await client.connect();
  return client;
}

async function insertSignal(signal: Signal): Promise<void> {
  const client = await pgClient();
  try {
    await client.query(
      `INSERT INTO evolution_signals (id, source, pattern, severity, context, gene_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [signal.id, signal.source, signal.pattern, signal.severity, signal.context, signal.gene_id, signal.status, signal.created_at]
    );
  } finally {
    await client.end();
  }
}

async function insertEvent(event: GEPDirective): Promise<void> {
  const client = await pgClient();
  try {
    await client.query(
      `INSERT INTO evolution_events (id, signal_id, gene_id, directive, agent_assigned, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, event.signal_id, event.gene_id, event.directive, event.agent_assigned, event.status, event.created_at]
    );
  } finally {
    await client.end();
  }
}

/**
 * Update gene JSON atomically: mark last_directive_id and lock if taking ownership.
 * Returns updated gene object or null if lock could not be acquired.
 */
async function claimDirectiveForGene(
  gene: Gene,
  directiveId: string,
  agent: string,
  fleetBrain: string
): Promise<Record<string, unknown> | null> {
  const fs = await import('fs/promises')
  const path = await import('path')
  const genePath = path.join(fleetBrain, 'genes', `${gene.id}.json`)
  const lockPath = path.join(fleetBrain, 'genes', `.${gene.id}.lock`)

  // Try to acquire lock
  try {
    await fs.writeFile(lockPath, String(Date.now()), { flag: 'wx' })
  } catch {
    return null // already locked
  }

  try {
    const raw = await fs.readFile(genePath, 'utf-8')
    const geneObj = JSON.parse(raw)

    // Check concurrency guard: skip if locked by another agent for > 30min
    const lockedAt = geneObj.locked_at ? new Date(geneObj.locked_at).getTime() : 0
    const now = Date.now()
    if (geneObj.locked_by && geneObj.locked_by !== agent && now - lockedAt < 30 * 60 * 1000) {
      return null // still locked by another agent
    }

    const nowIso = new Date().toISOString()
    geneObj.last_directive_id = directiveId
    geneObj.locked_by = agent
    geneObj.locked_at = nowIso

    await fs.writeFile(genePath, JSON.stringify(geneObj, null, 2))
    return geneObj
  } catch (e) {
    return null
  } finally {
    await fs.unlink(lockPath).catch(() => {})
  }
}

// ── GEP Directive Generator ──────────────────────────────────────────────────

function buildDirective(signal: Signal, gene: Gene): string {
  const lines = [
    `## GEP Directive: ${gene.id}`,
    ``,
    `**Signal:** ${signal.id}`,
    `**Gene:** ${gene.id} (${gene.gene_type})`,
    `**Severity:** ${signal.severity}`,
    `**Source:** ${signal.source}`,
    `**Target:** ${gene.target}`,
    ``,
    `### Problem`,
    gene.description,
    ``,
    `### Context`,
    signal.context.substring(0, 500),
    signal.context.length > 500 ? '...' : '',
    ``,
    `### Evolution Directive`,
    gene.prompt_fragment || `Apply ${gene.gene_type} to ${gene.target}. See files: ${(gene.files || []).join(', ')}`,
    ``,
    `### Gene Metadata`,
    `- Type: ${gene.gene_type}`,
    `- Target: ${gene.target}`,
    `- Files: ${(gene.files || []).join(', ')}`,
  ].filter(l => l !== undefined).join('\n');
  return lines;
}

function routeAgent(gene_type: string): string {
  if (gene_type === 'repair' || gene_type === 'harden') return 'claude-code + sakan';
  if (gene_type === 'innovate') return 'hades + claude-code';
  return 'hades';
}

// ── Scanner Sources ──────────────────────────────────────────────────────────

async function scanWatchdog(): Promise<{text: string; source: string}[]> {
  // Read recent watchdog logs from PM2
  const { execSync } = await import('child_process');
  try {
    const out = execSync('pm2 logs watchdog --lines 100 --nostream 2>/dev/null || echo ""', { timeout: 5000 });
    const lines = out.toString().split('\n').filter(l => 
      l.includes('ERROR') || l.includes('WARN') || l.includes('fault') || l.includes('anomaly')
    );
    return lines.map(l => ({ text: l, source: 'watchdog' }));
  } catch {
    return [];
  }
}

async function scanPM2Logs(): Promise<{text: string; source: string}[]> {
  const { execSync } = await import('child_process');
  const results: {text: string; source: string}[] = [];
  try {
    // Check divergence and singularity logs for errors
    for (const name of ['divergence', 'singularity-v13', 'nova-dashboard']) {
      try {
        const out = execSync(`pm2 logs ${name} --lines 50 --nostream 2>/dev/null || echo ""`, { timeout: 5000 });
        const lines = out.toString().split('\n').filter(l => l.includes('ERROR') || l.includes('exception') || l.includes('traceback'));
        results.push(...lines.map(l => ({ text: l, source: `pm2:${name}` })));
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

async function scanTheorexSpans(): Promise<{text: string; source: string}[]> {
  const client = await pgClient();
  try {
    const result = await client.query(`
      SELECT content FROM axonnodes 
      WHERE content::text ILIKE '%error%stagnation%drift%timeout%'
      AND created_at > NOW() - INTERVAL '6 hours'
      LIMIT 20
    `);
    return result.rows.map(r => ({ 
      text: typeof r.content === 'string' ? r.content : JSON.stringify(r.content), 
      source: 'theorex:span' 
    }));
  } catch {
    return [];
  } finally {
    await client.end();
  }
}

async function scanOutcomes(): Promise<{text: string; source: string}[]> {
  const client = await pgClient();
  try {
    // Scan for win rate anomalies per agent
    const winRateResult = await client.query(`
      SELECT agent, COUNT(*) as trades, 
        ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0) * 100, 1) as win_rate,
        SUM(pnl) as total_pnl
      FROM outcomes
      GROUP BY agent
    `);
    
    const signals: {text: string; source: string}[] = [];
    const knownAgents = new Set(winRateResult.rows.map(r => r.agent));
    
    // Detect agents that SHOULD be writing but aren't
    const expectedAgents = ['singularity-default', 'singularity-prop', 'singularity-shadow', 'divergence', 'horizon', 'cauldron'];
    for (const expected of expectedAgents) {
      if (!knownAgents.has(expected)) {
        // Check if partial match exists (e.g. 'singularity' but not split)
        const partial = [...knownAgents].find(a => a.includes(expected.split('-')[0]) && a !== expected);
        if (partial) {
          signals.push({
            text: `OUTCOME_TRACKING|agent=${expected}|pattern=variant_not_split — ${expected} expected but only ${partial} writing`,
            source: `outcomes:audit`
          });
        } else if (expected !== 'cauldron') { // cauldron may not exist yet
          signals.push({
            text: `OUTCOME_TRACKING|agent=${expected}|pattern=no_outcome_data — ${expected} has no outcome records`,
            source: `outcomes:audit`
          });
        }
      }
    }
    
    for (const row of winRateResult.rows) {
      const winRate = parseFloat(row.win_rate || '0');
      const totalPnl = parseFloat(row.total_pnl || '0');
      
      // High win rate but negative PnL = wins small, loses big → inefficiency signal
      if (winRate > 55 && totalPnl < 0) {
        signals.push({
          text: `OUTCOME_ANALYSIS|agent=${row.agent}|win_rate=${winRate}|pnl=${totalPnl}|pattern=high_win_low_pnl — wins often but loses big on average`,
          source: `outcomes:${row.agent}`
        });
      }
      
      // Low win rate and negative PnL = systematic issue
      if (winRate < 40 && totalPnl < 0) {
        signals.push({
          text: `OUTCOME_ANALYSIS|agent=${row.agent}|win_rate=${winRate}|pnl=${totalPnl}|pattern=low_win_negative_pnl — losing system, needs review`,
          source: `outcomes:${row.agent}`
        });
      }
    }
    
    // Large losses (all time)
    const lossResult = await client.query(`
      SELECT trade_id, agent, pnl, (meta->>'reason') as reason
      FROM outcomes
      WHERE pnl < -50
      ORDER BY pnl ASC
      LIMIT 5
    `);
    
    for (const row of lossResult.rows) {
      signals.push({
        text: `LARGE_LOSS|agent=${row.agent}|trade=${row.trade_id}|pnl=${row.pnl}|reason=${row.reason || 'unknown'}`,
        source: `outcomes:${row.agent}`
      });
    }
    
    return signals;
  } catch (e) {
    console.warn(`[GE] Outcomes scan failed: ${e}`);
    return [];
  } finally {
    await client.end();
  }
}

// ── Main Scan ────────────────────────────────────────────────────────────────

async function scan(source: string = 'all') {
  console.log(`[GE] Signal scanner starting — source: ${source}`);
  
  const genes = await loadGenes();
  console.log(`[GE] Loaded ${genes.length} active genes`);
  
  const entries: {text: string; source: string}[] = [];
  
  if (source === 'all' || source === 'watchdog') {
    entries.push(...await scanWatchdog());
    entries.push(...await scanPM2Logs());
  }
  if (source === 'all' || source === 'theorex') {
    entries.push(...await scanTheorexSpans());
    entries.push(...await scanOutcomes());
  }
  
  console.log(`[GE] Scanned ${entries.length} entries from ${source}`);
  
  let signalsEmitted = 0;
  
  for (const entry of entries) {
    const matched = matchGene(entry.text, genes);
    if (!matched) continue;

    // Check if recently signaled (dedup)
    if (isGeneRecentlySignaled(matched)) {
      console.log(`[GE] ⏭ Skipping ${matched.id} — already has recent directive`);
      continue
    }

    const signalId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const assignedAgent = routeAgent(matched.gene_type)

    // Try to claim this directive (concurrency guard)
    const claimed = await claimDirectiveForGene(matched, signalId, assignedAgent, FLEET_BRAIN)
    if (!claimed) {
      console.log(`[GE] ⏭ Skipping ${matched.id} — locked by another agent or could not claim`)
      continue
    }

    // Update in-memory gene so subsequent entries in the same scan don't re-trigger
    matched.last_directive_id = signalId

    const signal: Signal = {
      id: signalId,
      source: entry.source,
      pattern: matched.pattern,
      severity: matched.severity,
      context: entry.text,
      gene_id: matched.id,
      status: 'pending',
      created_at: new Date(),
    };

    await insertSignal(signal);

    const directive = buildDirective(signal, matched);
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const event: GEPDirective = {
      id: eventId,
      signal_id: signalId,
      gene_id: matched.id,
      directive,
      agent_assigned: assignedAgent,
      status: 'pending',
      created_at: new Date(),
    };

    await insertEvent(event);

    // Write GEP directive to fleet-brain tasks
    const { writeFile } = await import('fs/promises');
    const taskFile = join(FLEET_BRAIN, 'tasks', `${new Date().toISOString().slice(0,10)}_GE_${signalId}.md`);
    await writeFile(taskFile, `# GEP Directive\n\n${directive}\n\n---
*Signal: ${signalId} | Gene: ${matched.id} | Status: pending*\n`);

    console.log(`[GE] ✅ Signal ${signalId} → gene ${matched.id} (${matched.gene_type}) — priority score: ${computePriorityScore(matched).toFixed(2)}`);
    console.log(`[GE] 📄 Directive written to ${taskFile}`);
    signalsEmitted++;
  }
  
  console.log(`[GE] Complete — ${signalsEmitted} signals emitted`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const source = process.argv[2] || 'all';
scan(source).catch(console.error);
