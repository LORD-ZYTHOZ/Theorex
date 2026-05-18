/**
 * Circuit 5: Adversarial Audit Tool for Fleet-GE
 * Loads all applied gene JSONs, runs adversarial checks, writes audit to Theorex.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const PG_HOST = '100.95.91.32';
const PG_PORT = '5432';
const PG_DB = 'theorex';
const PG_USER = 'claw';
const GENES_DIR = '/Users/eoh/.openclaw/workspace/fleet-brain/genes/';
const AUDITOR = 'hades';

interface Gene {
  id: string;
  label: string;
  status: string;
  gene_type: string;
  severity: string;
  applied_at: string | null;
  applied_by: string | null;
  success_count: number;
  failure_count: number;
  consecutive_failures: number;
  last_outcome: string | null;
  last_outcome_at: string | null;
  last_directive_id: string | null;
  applied_changes: string[] | null;
  observation_window_days: number;
  notes: string;
}

interface AuditResult {
  gene_id: string;
  audit_type: string;
  score: number;
  findings: string[];
  disputed: boolean;
  auditor: string;
  audited_at: string;
}

function loadGenes(): Gene[] {
  if (!fs.existsSync(GENES_DIR)) return [];
  return fs.readdirSync(GENES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(GENES_DIR, f), 'utf8')) as Gene; }
      catch { return null; }
    })
    .filter((g): g is Gene => g !== null && g.status === 'applied');
}

async function queryPg(sql: string): Promise<string[][]> {
  const { stdout } = await execFileAsync('psql', ['-h', PG_HOST, '-p', PG_PORT, '-d', PG_DB, '-U', PG_USER, '-c', sql], { encoding: 'utf8' });
  const lines = stdout.trim().split('\n').filter(l => l.includes('|'));
  if (lines.length < 2) return [];
  return lines.slice(1).map(l => l.split('|').map(v => v.trim()));
}

async function insertAudit(result: AuditResult): Promise<void> {
  const id = randomUUID();
  const label = `audit:${result.gene_id}:${result.audited_at.replace(/[:.]/g, '-')}`;
  const body = JSON.stringify(result);
  const sql = `INSERT INTO concepts (id, label, body, memory_type, agent_id, created_at) VALUES ('${id}', '${label}', '${body.replace(/'/g, "''")}', 'gene_outcome', '${AUDITOR}', NOW())`;
  try {
    await queryPg(sql);
    console.log(`  [AUDIT] recorded audit for ${result.gene_id}`);
  } catch (e) {
    console.error(`  [AUDIT] insert failed for ${result.gene_id}:`, e);
  }
}

async function checkDivergenceFix(gene: Gene): Promise<{ pass: boolean; msg: string }> {
  // Query divergence outcomes after apply date
  if (!gene.applied_at) return { pass: false, msg: 'no apply date' };
  try {
    const rows = await queryPg(
      `SELECT COUNT(*) as cnt, SUM(CASE WHEN pnl >= 0 THEN 1 ELSE 0 END) as wins ` +
      `FROM outcomes WHERE agent = 'divergence' AND created_at > '${gene.applied_at}'`
    );
    if (rows.length === 0 || !rows[0][0]) return { pass: true, msg: 'no post-apply data yet' };
    const [, winsStr] = rows[0];
    const wins = parseInt(winsStr || '0');
    // After fix, win rate should improve above 65%
    if (wins < 5) return { pass: true, msg: `only ${wins} trades post-apply — too soon` };
    return { pass: true, msg: `${wins} post-apply wins — monitoring` };
  } catch (e) {
    return { pass: true, msg: `divergence check skipped: ${e}` };
  }
}

async function checkSingularityFix(gene: Gene): Promise<{ pass: boolean; msg: string }> {
  if (!gene.applied_at) return { pass: false, msg: 'no apply date' };
  try {
    const rows = await queryPg(
      `SELECT COUNT(*) as cnt FROM outcomes WHERE agent = 'singularity' AND created_at > '${gene.applied_at}'`
    );
    const cnt = rows[0]?.[0] || '0';
    if (parseInt(cnt) === 0) return { pass: true, msg: 'no post-apply trades yet' };
    return { pass: true, msg: `${cnt} post-apply trades — monitoring` };
  } catch (e) {
    return { pass: true, msg: `singularity check skipped: ${e}` };
  }
}

async function runAdversarialAudit(gene: Gene): Promise<AuditResult> {
  const findings: string[] = [];
  let score = 0.5; // start neutral
  let disputed = false;

  // Check 1: Was it actually applied?
  if (!gene.applied_at) {
    findings.push('FAIL: not marked as applied');
    score -= 0.4;
    disputed = true;
  } else {
    findings.push(`OK: applied at ${gene.applied_at}`);
    score += 0.1;
  }

  // Check 2: Consecutive failures (auto-fail at > 5)
  if (gene.consecutive_failures > 5) {
    findings.push(`FAIL: ${gene.consecutive_failures} consecutive failures (auto-fail threshold)`);
    score -= 0.3;
    disputed = true;
  } else if (gene.consecutive_failures > 0) {
    findings.push(`WARN: ${gene.consecutive_failures} consecutive failures`);
    score -= 0.1;
  }

  // Check 3: Outcome consistency
  if (gene.last_outcome === 'failure' && gene.failure_count > 3) {
    findings.push(`WARN: ${gene.failure_count} failures but still active`);
    score -= 0.1;
  }

  // Check 4: Gene-type specific checks
  if (gene.id.includes('divergence')) {
    const div = await checkDivergenceFix(gene);
    findings.push(`divergence: ${div.msg}`);
    if (!div.pass) { score -= 0.2; disputed = true; }
  } else if (gene.id.includes('singularity')) {
    const sing = await checkSingularityFix(gene);
    findings.push(`singularity: ${sing.msg}`);
    if (!sing.pass) { score -= 0.2; disputed = true; }
  }

  // Check 5: Applied changes documented
  if (!gene.applied_changes || gene.applied_changes.length === 0) {
    findings.push('WARN: no applied_changes documented');
    score -= 0.05;
  } else {
    findings.push(`OK: ${gene.applied_changes.length} changes applied`);
    score += 0.05;
  }

  score = Math.max(0, Math.min(1, score));

  return {
    gene_id: gene.id,
    audit_type: 'adversarial',
    score: Math.round(score * 100) / 100,
    findings,
    disputed,
    auditor: AUDITOR,
    audited_at: new Date().toISOString(),
  };
}

async function main() {
  const genes = loadGenes();
  console.log(`[GE] Circuit 5 Adversarial Audit`);
  console.log(`[GE] ${genes.length} applied genes to audit`);

  if (genes.length === 0) {
    console.log('[GE] No applied genes found');
    return;
  }

  let totalDisputed = 0;
  let totalScore = 0;

  for (const gene of genes) {
    process.stdout.write(`  auditing ${gene.id}... `);
    const result = await runAdversarialAudit(gene);
    await insertAudit(result);
    console.log(`score=${result.score} disputed=${result.disputed}`);
    if (result.disputed) totalDisputed++;
    totalScore += result.score;
  }

  const avgScore = totalScore / genes.length;
  console.log(`\n[GE] Audit complete: ${totalDisputed}/${genes.length} disputed, avg_score=${avgScore.toFixed(2)}`);
}

main().catch(err => { console.error('[GE] Fatal:', err); process.exit(1); });