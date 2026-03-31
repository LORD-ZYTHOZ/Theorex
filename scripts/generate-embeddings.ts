/**
 * Generate embeddings for all concepts in Postgres that don't have one yet.
 * Uses Ollama nomic-embed-text (768d).
 * Run: bun scripts/generate-embeddings.ts
 */

import { embedText } from '../src/rag/ollama-embedder';

const sql = new Bun.SQL({
  host: process.env.THEOREX_PG_HOST || '100.95.91.32',
  port: Number(process.env.THEOREX_PG_PORT || 5432),
  user: process.env.THEOREX_PG_USER || 'claw',
  database: process.env.THEOREX_PG_DB || 'theorex',
});

const BATCH = 20; // concurrent embed requests

async function main() {
  const total = await sql`SELECT COUNT(*) AS n FROM concepts WHERE embedding IS NULL`;
  const count = Number(total[0].n);
  console.log(`Generating embeddings for ${count} concepts...`);

  let done = 0;
  let failed = 0;

  // Fetch in pages — no offset needed since WHERE embedding IS NULL shrinks each pass
  while (true) {
    const rows = await sql`
      SELECT id, label, body FROM concepts
      WHERE embedding IS NULL
      ORDER BY created_at
      LIMIT 200
    `;
    if (rows.length === 0) break;

    // Process in concurrent batches
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const texts = chunk.map((r: any) => [r.label, r.body].filter(Boolean).join(' '));

      const vecs = await Promise.all(texts.map(embedText));

      for (let j = 0; j < chunk.length; j++) {
        const vec = vecs[j];
        if (!vec) { failed++; continue; }

        const embStr = `[${vec.join(',')}]`;
        await sql`UPDATE concepts SET embedding = ${embStr}::vector(768) WHERE id = ${chunk[j].id}`;
        done++;
      }
    }

    process.stdout.write(`\r  ${done}/${count} embedded, ${failed} failed`);
  }

  console.log(`\n\nDone. ${done} embedded, ${failed} failed.`);

  // Verify
  const check = await sql`SELECT COUNT(*) AS n FROM concepts WHERE embedding IS NOT NULL`;
  console.log(`Postgres: ${check[0].n} concepts with embeddings`);

  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
