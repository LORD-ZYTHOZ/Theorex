/**
 * Stage 2: Migrate axon.json files → Postgres (fast batch version)
 * Uses Bun.SQL with batched inserts for speed.
 * Safe to re-run (TRUNCATE first or uses ON CONFLICT DO NOTHING).
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const OC_ROOT = '/Users/eoh/.openclaw';
const DATA_DIR = join(OC_ROOT, 'projects/theorex/data');

const sql = new Bun.SQL({
  host: process.env.THEOREX_PG_HOST || '100.95.91.32',
  port: Number(process.env.THEOREX_PG_PORT || 5432),
  user: process.env.THEOREX_PG_USER || 'claw',
  database: process.env.THEOREX_PG_DB || 'theorex',
});

function classifyMemoryType(surface: string, obsType: string): string {
  const s = surface.toLowerCase();
  const o = obsType.toLowerCase();
  if (o === 'preference' || s.includes('prefer') || s.includes('setting')) return 'preference';
  if (o === 'relationship' || s.includes('relationship')) return 'relationship';
  if (o === 'episode' || s.includes('session') || s.includes('trade') || s.includes('outcome')) return 'episode';
  if (o === 'procedure' || s.includes('how to') || s.includes('process') || s.includes('pipeline')) return 'procedure';
  return 'fact';
}

async function migrateAxonFile(filePath: string, agentId: string) {
  const graph = JSON.parse(readFileSync(filePath, 'utf-8'));
  const nodes: any[] = graph.nodes || [];
  const edges: any[] = graph.edges || [];
  if (nodes.length === 0) return { concepts: 0, edges: 0 };

  // Batch insert concepts — build values
  const conceptRows = nodes.map(node => {
    const a = node.attributes;
    return {
      label: a.surface_form || node.key,
      memory_type: classifyMemoryType(a.surface_form || '', a.observation_type || ''),
      agent_id: agentId,
      meta: {
        concept_id: a.concept_id,
        importance_weight: a.importance_weight,
        relevance_tier: a.relevance_tier,
        sentiment_tier: a.sentiment_tier,
        frequency_count: a.frequency_count,
        source_weight: a.source_weight,
        observation_type: a.observation_type,
        archive_id: a.archive_id,
        legacy_key: node.key,
      },
      created_at: a.last_seen || new Date().toISOString(),
    };
  });

  // Insert in chunks of 100
  const CHUNK = 100;
  let inserted = 0;
  const idMap = new Map<string, string>(); // legacy_key → uuid

  for (let i = 0; i < conceptRows.length; i += CHUNK) {
    const chunk = conceptRows.slice(i, i + CHUNK);

    for (const row of chunk) {
      const res = await sql`
        INSERT INTO concepts (label, memory_type, agent_id, meta, created_at, updated_at)
        VALUES (
          ${row.label},
          ${row.memory_type}::memory_type,
          ${row.agent_id},
          ${row.meta},
          ${row.created_at},
          ${row.created_at}
        )
        ON CONFLICT (label, agent_id) DO UPDATE SET
          meta = EXCLUDED.meta,
          updated_at = EXCLUDED.updated_at
        RETURNING id, meta->>'legacy_key' AS legacy_key
      `;
      if (res[0]) {
        idMap.set(res[0].legacy_key, res[0].id);
        inserted++;
      } else {
        // Conflict — fetch existing id
        const existing = await sql`SELECT id FROM concepts WHERE label = ${row.label} AND agent_id = ${row.agent_id} LIMIT 1`;
        if (existing[0]) idMap.set(row.meta.legacy_key as string, existing[0].id);
      }
    }
  }

  // Fetch all existing UUIDs for this agent to build complete idMap
  const existing = await sql`
    SELECT id, (meta::jsonb)->>'legacy_key' AS legacy_key
    FROM concepts WHERE agent_id = ${agentId}
  `;
  for (const row of existing) {
    if (row.legacy_key) idMap.set(row.legacy_key, row.id);
  }

  // Batch insert edges in chunks of 200
  let edgeCount = 0;
  const EDGE_CHUNK = 200;
  const edgeRows = edges
    .map((edge: any) => ({
      src: idMap.get(edge.source),
      tgt: idMap.get(edge.target),
      relation: edge.attributes?.relation || 'co-occurrence',
      weight: edge.attributes?.strength || edge.attributes?.weight || 1.0,
      meta: edge.attributes || {},
    }))
    .filter((e: any) => e.src && e.tgt);

  for (let i = 0; i < edgeRows.length; i += EDGE_CHUNK) {
    const chunk = edgeRows.slice(i, i + EDGE_CHUNK);
    // Build VALUES string for bulk insert
    const values = chunk.map((e: any, j: number) => {
      const base = j * 5;
      return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5})`;
    }).join(', ');
    const params = chunk.flatMap((e: any) => [e.src, e.tgt, e.relation, e.weight, e.meta]);

    await sql.unsafe(
      `INSERT INTO concept_edges (source_id, target_id, relation, weight, meta) VALUES ${values} ON CONFLICT DO NOTHING`,
      params
    );
    edgeCount += chunk.length;
  }

  return { concepts: inserted, edges: edgeCount };
}

async function migrateOutcomes() {
  const outcomesDir = join(DATA_DIR, 'outcomes');
  if (!existsSync(outcomesDir)) return 0;

  const files = readdirSync(outcomesDir).filter(f => f.endsWith('.json'));
  let count = 0;

  for (const file of files) {
    const o = JSON.parse(readFileSync(join(outcomesDir, file), 'utf-8'));
    await sql`
      INSERT INTO outcomes (id, trade_id, agent, meta, created_at)
      VALUES (
        ${o.id},
        ${o.id},
        ${o.agent_id || 'unknown'},
        ${{ decision: o.decision, result: o.result, success: o.success, tags: o.tags, concept_ids: o.concept_ids }},
        ${o.timestamp || new Date().toISOString()}
      )
      ON CONFLICT DO NOTHING
    `;
    count++;
  }
  return count;
}

async function main() {
  console.log('Stage 2: Axon → Postgres migration (batch)');
  console.log('============================================');

  const axonFiles: { path: string; agentId: string }[] = [];

  const projectAxon = join(DATA_DIR, 'axon.json');
  if (existsSync(projectAxon)) axonFiles.push({ path: projectAxon, agentId: 'shared' });

  const agentsDir = join(OC_ROOT, 'agents');
  for (const agent of readdirSync(agentsDir)) {
    const axonPath = join(agentsDir, agent, 'theorex', 'axon.json');
    if (existsSync(axonPath)) axonFiles.push({ path: axonPath, agentId: agent });
  }

  console.log(`Found ${axonFiles.length} axon files\n`);

  let totalConcepts = 0;
  let totalEdges = 0;

  for (const { path, agentId } of axonFiles) {
    const start = Date.now();
    process.stdout.write(`  ${agentId.padEnd(22)}`);
    const { concepts, edges } = await migrateAxonFile(path, agentId);
    totalConcepts += concepts;
    totalEdges += edges;
    console.log(`→ ${String(concepts).padStart(4)} concepts, ${String(edges).padStart(3)} edges  (${Date.now() - start}ms)`);
  }

  console.log(`\nTotal concepts: ${totalConcepts}`);
  console.log(`Total edges:    ${totalEdges}`);

  process.stdout.write('\nMigrating outcomes... ');
  const outcomes = await migrateOutcomes();
  console.log(`${outcomes} outcomes`);

  const counts = await sql`
    SELECT
      (SELECT COUNT(*) FROM concepts)::int AS concepts,
      (SELECT COUNT(*) FROM concept_edges)::int AS edges,
      (SELECT COUNT(*) FROM outcomes)::int AS outcomes
  `;
  console.log('\nPostgres totals:', counts[0]);
  await sql.end();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
