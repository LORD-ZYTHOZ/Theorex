/**
 * benchmark-search.ts — Manual benchmark comparing compressed two-stage search
 * vs pgvector hybrid_search for the same query.
 *
 * Usage:
 *   THEOREX_STORAGE=postgres bun scripts/benchmark-search.ts
 *
 * Requires:
 *   - Postgres running at 100.95.91.32 (or THEOREX_PG_HOST env var)
 *   - Ollama running at localhost:11434 (or OLLAMA_URL env var)
 *   - concepts table with compressed_vector and embedding columns populated
 */

import { embedText } from "../src/rag/ollama-embedder";
import { buildProjectionMatrix } from "../src/rag/turbo-quant";
import { compressedSearch } from "../src/rag/compressed-search";
import { PostgresStore } from "../src/axon/postgres-store";

const QUERY = "gold price momentum";
const AGENT_ID = "main";
const PRE_FILTER_N = 200;
const TOP_K = 10;

async function main(): Promise<void> {
  console.log("=== Theorex Search Benchmark ===");
  console.log(`Query: "${QUERY}"`);
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`preFilterN: ${PRE_FILTER_N}, topK: ${TOP_K}`);
  console.log("");

  // Embed query
  console.log("Embedding query...");
  const embeddingArr = await embedText(QUERY);
  if (!embeddingArr) {
    console.error("ERROR: Ollama embedding failed. Is Ollama running?");
    process.exit(1);
  }
  console.log(`Embedding dimension: ${embeddingArr.length}`);
  console.log("");

  const queryVec = new Float32Array(embeddingArr);
  const matrix = buildProjectionMatrix();

  // -------------------------------------------------------------------------
  // Benchmark: compressed two-stage search
  // -------------------------------------------------------------------------

  console.log("--- Compressed Two-Stage Search ---");
  const t0 = performance.now();
  let compressedResults;
  try {
    compressedResults = await compressedSearch(queryVec, matrix, {
      agentId: AGENT_ID,
      preFilterN: PRE_FILTER_N,
      topK: TOP_K,
    });
  } catch (err) {
    console.error("Compressed search failed:", err);
    compressedResults = [];
  }
  const t1 = performance.now();
  const compressedMs = (t1 - t0).toFixed(1);

  console.log(`Time: ${compressedMs}ms`);
  console.log(`Results (${compressedResults.length}):`);
  for (const r of compressedResults) {
    console.log(`  [hamming=${r.hammingScore} cosine=${r.cosineScore.toFixed(4)}] ${r.label}`);
  }
  console.log("");

  // -------------------------------------------------------------------------
  // Benchmark: hybrid_search (FTS + pgvector cosine)
  // -------------------------------------------------------------------------

  console.log("--- Hybrid Search (FTS + pgvector) ---");
  const pgStore = new PostgresStore(AGENT_ID);
  const t2 = performance.now();
  let hybridResults;
  try {
    hybridResults = await pgStore.search(QUERY, embeddingArr, {
      agentFilter: AGENT_ID,
      limit: TOP_K,
    });
  } catch (err) {
    console.error("Hybrid search failed:", err);
    hybridResults = [];
  } finally {
    await pgStore.close();
  }
  const t3 = performance.now();
  const hybridMs = (t3 - t2).toFixed(1);

  console.log(`Time: ${hybridMs}ms`);
  console.log(`Results (${hybridResults.length}):`);
  for (const r of hybridResults) {
    console.log(`  [score=${r.score.toFixed(4)}] ${r.label}`);
  }
  console.log("");

  // -------------------------------------------------------------------------
  // Comparison summary
  // -------------------------------------------------------------------------

  console.log("=== Summary ===");
  console.log(`Compressed: ${compressedMs}ms → ${compressedResults.length} results`);
  console.log(`Hybrid:     ${hybridMs}ms → ${hybridResults.length} results`);

  const compressedLabels = new Set(compressedResults.map((r) => r.label));
  const hybridLabels = new Set(hybridResults.map((r) => r.label));
  const overlap = [...compressedLabels].filter((l) => hybridLabels.has(l));
  console.log(`Overlap: ${overlap.length}/${TOP_K} results in common`);
  if (overlap.length > 0) {
    console.log("Common labels:");
    for (const l of overlap) console.log(`  - ${l}`);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
