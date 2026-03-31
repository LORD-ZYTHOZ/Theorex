/**
 * Re-encode all concepts with real TurboCode via NativeQuantizer.
 * Replaces legacy 32-byte JL/1-bit codes with proper PolarQuant+QJL codes.
 *
 * Run: bun scripts/backfill-turbo-quant.ts
 */

const { NativeQuantizer } = require("../packages/turbo-quant-native/index.js");

const DIM = 768;
const BITS = 8;
const PROJECTIONS = 192;
const SEED = 42n;
const BATCH = 100;

const sql = new Bun.SQL({
  host: process.env.THEOREX_PG_HOST || "100.95.91.32",
  port: Number(process.env.THEOREX_PG_PORT || 5432),
  user: process.env.THEOREX_PG_USER || "claw",
  database: process.env.THEOREX_PG_DB || "theorex",
});

function parseVec(raw: unknown): Float32Array {
  if (typeof raw !== "string") throw new Error(`expected string from pg, got ${typeof raw}`);
  const nums = raw.slice(1, -1).split(",").map(Number);
  if (nums.length !== DIM) throw new Error(`expected ${DIM}d vector, got ${nums.length}d`);
  return new Float32Array(nums);
}

async function main() {
  console.log(`Initializing NativeQuantizer(${DIM}, ${BITS}, ${PROJECTIONS}, ${SEED})...`);
  const quantizer = new NativeQuantizer(DIM, BITS, PROJECTIONS, SEED);

  // Count all concepts with embeddings (overwrite all, not just null)
  const totalRows = await sql`SELECT COUNT(*) AS n FROM concepts WHERE embedding IS NOT NULL`;
  const total = Number(totalRows[0].n);
  console.log(`Re-encoding ${total} concepts...`);

  let done = 0;
  let failed = 0;
  let offset = 0;

  while (true) {
    const rows = await sql`
      SELECT id, embedding FROM concepts
      WHERE embedding IS NOT NULL
      ORDER BY created_at
      LIMIT ${BATCH} OFFSET ${offset}
    `;
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const vec = parseVec(row.embedding);
        const code = quantizer.encode(vec);
        await sql`UPDATE concepts SET compressed_vector = ${code} WHERE id = ${row.id}`;
        done++;
      } catch (err) {
        console.error(`Failed id=${row.id}:`, err);
        failed++;
      }
    }

    offset += BATCH;

    if (done % 500 < BATCH || done + failed >= total) {
      console.log(`  ${done}/${total} done, ${failed} failed`);
    }
  }

  console.log(`Done. ${done} re-encoded, ${failed} failed.`);
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
