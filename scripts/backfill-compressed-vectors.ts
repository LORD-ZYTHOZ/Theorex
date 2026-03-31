/**
 * Backfill compressed_vector for all concepts that have embeddings but no compressed vector.
 * Uses TurboQuant native compression via NativeQuantizer.
 * Run: bun scripts/backfill-compressed-vectors.ts
 */

const { NativeQuantizer } = require('../packages/turbo-quant-native/index.js');

const FULL_DIM = 768;

const sql = new Bun.SQL({
  host: process.env.THEOREX_PG_HOST || '100.95.91.32',
  port: Number(process.env.THEOREX_PG_PORT || 5432),
  user: process.env.THEOREX_PG_USER || 'claw',
  database: process.env.THEOREX_PG_DB || 'theorex',
});

const BATCH = 100;

function parseVec(raw: unknown): Float32Array {
  if (typeof raw !== 'string') throw new Error(`expected string from pgvector, got ${typeof raw}`);
  const nums = raw.slice(1, -1).split(',').map(Number);
  if (nums.length !== FULL_DIM) throw new Error(`expected ${FULL_DIM}d vector, got ${nums.length}d`);
  return new Float32Array(nums);
}

async function main() {
  const seed = parseInt(process.env['TURBO_SEED'] ?? '42', 10);
  console.log(`Creating NativeQuantizer (seed=${seed})...`);
  const quantizer = new NativeQuantizer(768, 8, 192, BigInt(seed));

  const totalRows = await sql`
    SELECT COUNT(*) AS n FROM concepts
    WHERE embedding IS NOT NULL AND compressed_vector IS NULL
  `;
  const total = Number(totalRows[0].n);
  console.log(`Compressing ${total} concepts...`);

  let done = 0;
  let failed = 0;

  while (true) {
    const rows = await sql`
      SELECT id, embedding FROM concepts
      WHERE embedding IS NOT NULL AND compressed_vector IS NULL
      ORDER BY created_at
      LIMIT ${BATCH}
    `;
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const vec = parseVec(row.embedding);
        const compressed = quantizer.encode(vec);
        const buf = Buffer.from(compressed);
        await sql`
          UPDATE concepts SET compressed_vector = ${buf} WHERE id = ${row.id}
        `;
        done++;
      } catch (err) {
        console.error(`Failed for id=${row.id}:`, err);
        failed++;
        // Mark as skipped by setting a sentinel so we don't loop forever
        await sql`UPDATE concepts SET compressed_vector = ${Buffer.alloc(32)} WHERE id = ${row.id}`;
      }
    }

    if (done % 500 === 0 || done + failed >= total) {
      console.log(`  ${done}/${total} done, ${failed} failed`);
    }
  }

  console.log(`Done. ${done} compressed, ${failed} failed.`);
  await sql.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
