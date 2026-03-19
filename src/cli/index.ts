// cli/index.ts — CLI entry point for Theorex.
// Dispatches scan/status/ref/prune/search/graduate subcommands to their respective modules.
//
// INVARIANTS:
//   - No business logic here — pure dispatch and I/O
//   - All paths are relative to process.cwd()

import { parseArgs } from "util";
import { scanAxon } from "../axon/scan";
import { pruneAxon } from "../axon/prune";
import { propagateActivation } from "../axon/propagate";
import { AxonStore } from "../axon/store";
import { compositeScore, classifyTier } from "../axon/scorer";
import { loadConfig } from "../config";
import type { Config } from "../config";
import { hybridSearch } from "../short-term/search";
import { textMatchAxon, semanticSearchAxonHNSW, mergeAxonResults } from "../rag/axon-search";
import { loadEmbeddingStore, loadEmbeddings } from "../rag/embedding-store";
import { loadOrBuildHNSWIndex, buildAndSaveHNSWIndex } from "../rag/hnsw-store";
import { embedText } from "../short-term/embedder";
import { readShortTermFiles, rotateStm } from "../short-term/store";
import { findGraduateCandidates, graduateToLongTerm } from "../short-term/graduate";
import { readMoments } from "../moments/store";
import type { CodeRef } from "../moments/store";
import { searchMoments } from "../moments/search";
import { runMoment } from "../moments/capture";
import { EVENTS_PATH } from "../audit/logger";
import type { AuditEventType } from "../audit/logger";
import { readAuditEvents } from "../audit/reader";
import {
  computeDriftScore,
  detectInstability,
  detectSentimentFlips,
  classifyTrend,
} from "../audit/scorer";

const ARCHIVE_DIR = "data/archive";
const MEMORY_PATH = "data/MEMORY.md";

// ---------------------------------------------------------------------------
// Exported handler functions (testable without spawning subprocess)
// ---------------------------------------------------------------------------

export async function runScan(axonPath: string, config: Config): Promise<void> {
  await scanAxon(axonPath, config);
  console.log("Scan complete.");
}

export async function runStatus(axonPath: string, config: Config): Promise<void> {
  const store = await AxonStore.load(axonPath);

  if (store.graph.order === 0) {
    console.log("No concepts in axon. Run: theorex scan");
    return;
  }

  const nodes = store.graph.nodes().map((key) => ({
    key,
    attrs: store.graph.getNodeAttributes(key),
  }));

  // Phase 9: separate sleeping nodes from live nodes
  const sleepingNodes = nodes.filter((n) => n.attrs.relevance_tier === "SLEEPING");
  const liveNodes = nodes.filter((n) => n.attrs.relevance_tier !== "SLEEPING");

  liveNodes.sort((a, b) => b.attrs.importance_weight - a.attrs.importance_weight);

  const sleepingSuffix = sleepingNodes.length > 0
    ? ` (${sleepingNodes.length} sleeping in cold storage)`
    : "";
  console.log(`Concept Web — ${nodes.length} nodes${sleepingSuffix}\n`);

  // Column widths
  const COL_ID = 12;
  const COL_FORM = 24;
  const COL_REL = 8;
  const COL_SNT = 14;
  const COL_WEIGHT = 8;
  const COL_FREQ = 6;
  const COL_SEEN = 12;

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);

  const header =
    pad("concept_id", COL_ID) +
    pad("surface_form", COL_FORM) +
    pad("rel", COL_REL) +
    pad("sentiment", COL_SNT) +
    pad("weight", COL_WEIGHT) +
    pad("freq", COL_FREQ) +
    pad("last_seen", COL_SEEN);

  const divider = "-".repeat(header.length);

  console.log(header);
  console.log(divider);

  const nowMs = Date.now();

  for (const { key, attrs } of liveNodes) {
    // Lazy elapsed-time correction (REL-03): recompute tier at read time using current clock.
    // This is read-only — no disk write. axon.json is unchanged.
    const neighborStrengths = store.graph
      .neighbors(key)
      .map((nbr) => store.graph.getEdgeAttributes(store.graph.edge(key, nbr)!).strength);
    const score = compositeScore(attrs.last_seen, attrs.frequency_count, neighborStrengths, nowMs, config);
    const displayTier = classifyTier(score, config);

    const dateOnly = attrs.last_seen.slice(0, 10);
    const row =
      pad(String(attrs.concept_id), COL_ID) +
      pad(attrs.surface_form, COL_FORM) +
      pad(displayTier, COL_REL) +
      pad(attrs.sentiment_tier, COL_SNT) +
      pad(attrs.importance_weight.toFixed(2), COL_WEIGHT) +
      pad(String(attrs.frequency_count), COL_FREQ) +
      pad(dateOnly, COL_SEEN);
    console.log(row);
  }

  // Append moment nodes section — failure does NOT affect status output
  try {
    const moments = await readMoments();
    if (moments.length > 0) {
      const displayCount = Math.min(moments.length, 20);
      console.log(`\nMoment Nodes — ${moments.length} permanent (never pruned)`);
      for (let i = 0; i < displayCount; i++) {
        const m = moments[i]!;
        console.log(`  ${m.timestamp.slice(0, 10)}  ${m.story.slice(0, 60)}`);
      }
      if (moments.length > 20) {
        console.log(`  ... and ${moments.length - 20} more`);
      }
    }
  } catch {
    // moment status failure is non-fatal
  }

  // Append drift summary — failure does NOT affect status output (DRF-07)
  try {
    const events = await readAuditEvents(EVENTS_PATH);
    const nowMs = Date.now();
    const momentList = await readMoments(config.momentsDir ?? "data/moments");
    const momentIds = new Set<number>(momentList.flatMap((m) => [...m.concept_ids]));

    // Re-use nodes from the loop above to get active IDs
    const activeIdsForDrift = new Set<number>();
    for (const { key, attrs } of nodes) {
      const neighborStrengths = store.graph
        .neighbors(key)
        .map((nbr) => store.graph.getEdgeAttributes(store.graph.edge(key, nbr)!).strength);
      const score = compositeScore(attrs.last_seen, attrs.frequency_count, neighborStrengths, nowMs, config);
      if (classifyTier(score, config) === "ACTIVE") activeIdsForDrift.add(attrs.concept_id);
    }

    const driftScore = computeDriftScore(momentIds, activeIdsForDrift);
    const instability = detectInstability(events as unknown as readonly { type: string; timestamp: string; [key: string]: unknown }[], config.driftWindowDays ?? 7, nowMs);
    const trend = classifyTrend(driftScore, instability.length);
    const alert = driftScore < 0.5 ? " [!]" : "";
    console.log(`\nDrift: ${driftScore.toFixed(2)} — ${trend}${alert}`);
  } catch {
    // drift summary failure is non-fatal
  }
}

export async function runRef(axonPath: string, keyword: string, config: Config): Promise<void> {
  const store = await AxonStore.load(axonPath);

  const nodeKey = store.graph.nodes().find((key) => {
    const attrs = store.graph.getNodeAttributes(key);
    return (
      attrs.surface_form.toLowerCase() === keyword.toLowerCase() ||
      String(attrs.concept_id) === keyword
    );
  });

  if (nodeKey === undefined) {
    console.error(
      `Concept not found: ${keyword}. Use theorex scan to ingest concepts first.`,
    );
    process.exit(1);
  }

  propagateActivation(store, nodeKey, 1.0, Date.now());
  await store.save(axonPath);

  const attrs = store.graph.getNodeAttributes(nodeKey);
  console.log(`Referenced: ${attrs.surface_form} (tier: ${attrs.relevance_tier})`);
}

export async function runPrune(
  axonPath: string,
  archiveDir: string,
  config: Config,
): Promise<void> {
  await pruneAxon(axonPath, archiveDir, config);
  console.log("Prune complete.");
}

export async function runSearch(query: string, config: Config): Promise<void> {
  // Housekeeping: rotate stale STM files on every CLI invocation (STM-02)
  const stmDir = config.stmDir || undefined;
  await rotateStm(new Date(), stmDir);

  const results = await hybridSearch(query, 10, {
    lmStudioUrl: config.lmStudioUrl,
    lmStudioEmbedModel: config.lmStudioEmbedModel,
    lmStudioTimeoutMs: config.lmStudioTimeoutMs,
  }, stmDir);

  if (results.length === 0) {
    console.log(`No results found for: ${query}`);
    return;
  }

  console.log(`# Search: ${query}\n`);

  const COL_RANK = 6;
  const COL_CONCEPT = 21;
  const COL_SCORE = 9;
  const COL_DATE = 10;

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const padLeft = (s: string, n: number) => s.padStart(n).slice(-n);

  const header =
    pad("Rank", COL_RANK) +
    pad("Concept", COL_CONCEPT) +
    pad("Score", COL_SCORE) +
    pad("Date", COL_DATE);
  const divider =
    "-".repeat(COL_RANK - 2) + "  " +
    "-".repeat(COL_CONCEPT - 2) + "  " +
    "-".repeat(COL_SCORE - 2) + "  " +
    "-".repeat(COL_DATE);

  console.log(header);
  console.log(divider);

  for (let i = 0; i < results.length; i++) {
    const { entry, score } = results[i]!;
    const row =
      padLeft(String(i + 1), COL_RANK - 2) + "  " +
      pad(entry.surface_form, COL_CONCEPT - 2) + "  " +
      score.toFixed(4).padStart(COL_SCORE - 2) + "  " +
      entry.date;
    console.log(row);
  }

  // Append moment node results — failure does NOT fail the search command
  try {
    const moments = await readMoments();
    const momentResults = await searchMoments(moments, query, 5);
    if (momentResults.length > 0) {
      console.log("\n--- Moment Nodes ---");
      for (const result of momentResults) {
        console.log(`[MOMENT] ${result.story.slice(0, 80)} (${result.timestamp.slice(0, 10)})`);
      }
    }
  } catch {
    // moment search failure is non-fatal
  }

  // Phase 4.5 + 9.5: Axon long-term concept search (text + HNSW semantic)
  try {
    const axon = await AxonStore.load(config.axonPath ?? "data/axon.json");
    const nodes = axon.graph
      .nodes()
      .map((k) => axon.graph.getNodeAttributes(k));

    if (nodes.length > 0) {
      const embStorePath = config.ragEmbeddingStorePath ?? "data/concept-embeddings.json";
      const vectors = await loadEmbeddings(embStorePath).catch(() => new Map<string, number[]>());

      const textResults = textMatchAxon(query, nodes, 10);

      // Semantic results via HNSW — only if embeddings available
      let semanticResults: Awaited<ReturnType<typeof mergeAxonResults>> = [];
      if (vectors.size > 0) {
        const queryVec = await embedText(query, config.lmStudioUrl, config.lmStudioEmbedModel, config.lmStudioTimeoutMs);
        if (queryVec !== null) {
          const hnswPath = config.hnswIndexPath ?? "data/hnsw-index.json";
          const hnswIndex = await loadOrBuildHNSWIndex(hnswPath, vectors).catch(() => null);
          if (hnswIndex) {
            semanticResults = semanticSearchAxonHNSW(queryVec, nodes, vectors, hnswIndex, 10) as typeof semanticResults;
          }
        }
      }

      const axonResults = mergeAxonResults(textResults, semanticResults, 5);

      if (axonResults.length > 0) {
        console.log("\n--- Long-term Axon ---");
        for (const r of axonResults) {
          const tier = nodes.find((n) => n.concept_id === r.concept_id)?.relevance_tier ?? "?";
          console.log(`[${tier}] ${r.surface_form} (${r.score.toFixed(3)} ${r.source})`);
        }
      }
    }
  } catch {
    // axon search failure is non-fatal
  }
}

export async function runGraduate(config: Config, memoryPath: string): Promise<void> {
  // Housekeeping: rotate stale STM files on every CLI invocation (STM-02)
  await rotateStm();

  const entries = await readShortTermFiles();
  const candidates = await findGraduateCandidates(entries, config.stmGraduateDays);

  if (candidates.length === 0) {
    console.log("Nothing to graduate.");
    return;
  }

  await graduateToLongTerm(candidates, memoryPath);

  console.log(`Graduated ${candidates.length} concept(s) to long-term memory:`);
  for (const candidate of candidates) {
    console.log(`  - ${candidate.surface_form}`);
  }
}

export async function runDrift(
  axonPath: string,
  eventsPath: string,
  config: Config,
  nowMs: number = Date.now(),
): Promise<void> {
  // 1. Load all audit events
  const events = await readAuditEvents(eventsPath);

  // 2. Get ACTIVE concept IDs using lazy tier correction (same as runStatus — REL-03)
  const store = await AxonStore.load(axonPath);
  const activeIds = new Set<number>();
  const nodeKeys = store.graph.nodes();
  for (const key of nodeKeys) {
    const attrs = store.graph.getNodeAttributes(key);
    const neighborStrengths = store.graph
      .neighbors(key)
      .map((nbr) => {
        const edgeKey = store.graph.edge(key, nbr);
        return edgeKey ? store.graph.getEdgeAttributes(edgeKey).strength : 0;
      });
    const score = compositeScore(attrs.last_seen, attrs.frequency_count, neighborStrengths, nowMs, config);
    const tier = classifyTier(score, config);
    if (tier === "ACTIVE") activeIds.add(attrs.concept_id);
  }

  // 3. Get moment concept IDs (union across all moments)
  const moments = await readMoments(config.momentsDir);
  const momentIds = new Set<number>();
  for (const m of moments) {
    for (const id of m.concept_ids) momentIds.add(id);
  }

  // 4. Compute drift score and flags
  // Cast to satisfy scorer.ts's local AuditEvent type (which has index signature [key: string]: unknown)
  type ScorerEvent = { type: string; timestamp: string; [key: string]: unknown };
  const eventsForScorer = events as unknown as readonly ScorerEvent[];
  const score = computeDriftScore(momentIds, activeIds);
  const instability = detectInstability(eventsForScorer, config.driftWindowDays, nowMs);
  const flips = detectSentimentFlips(eventsForScorer, config.driftWindowDays, nowMs);
  const trend = classifyTrend(score, instability.length);

  // 5. Output
  const alert = score < 0.5 ? " [!]" : "";
  console.log(`Drift Score: ${score.toFixed(2)} — ${trend}${alert}`);
  console.log(`Window: ${config.driftWindowDays} days | Active concepts: ${activeIds.size} | Moment anchors: ${momentIds.size}`);

  if (instability.length > 0) {
    console.log(`\nTier Instability (${instability.length} concept(s) dropped from ACTIVE):`);
    for (const flag of instability) {
      console.log(`  ${flag.surface_form} (id:${flag.concept_id}) — ACTIVE → ${flag.to} at ${flag.dropped_at.slice(0, 10)}`);
    }
  }

  if (flips.length > 0) {
    console.log(`\nSentiment Flips (${flips.length} concept(s)):`);
    for (const flip of flips) {
      console.log(`  ${flip.surface_form} (id:${flip.concept_id}) — ${flip.sentiments_seen.join(" ↔ ")}`);
    }
  }

  if (instability.length === 0 && flips.length === 0) {
    console.log("No flagged concepts in window.");
  }
}

export async function runAudit(
  eventsPath: string,
  options: { type?: string; since?: string },
  limit = 50,
): Promise<void> {
  let sinceMs: number | undefined;
  if (options.since) {
    // Treat --since YYYY-MM-DD as UTC midnight start of that day (DRF-08 pitfall 4)
    sinceMs = new Date(options.since + "T00:00:00.000Z").getTime();
    if (isNaN(sinceMs)) {
      console.error(`Invalid --since date: ${options.since}. Expected format: YYYY-MM-DD`);
      process.exit(1);
    }
  }

  const events = await readAuditEvents(eventsPath, {
    type: options.type as AuditEventType | undefined,
    sinceMs,
  });

  if (events.length === 0) {
    console.log("No events found" + (options.type ? ` of type: ${options.type}` : "") + (options.since ? ` since: ${options.since}` : "") + ".");
    return;
  }

  // Display most recent events first, up to limit
  const display = events.slice(-limit).reverse();
  console.log(`Event Log — ${events.length} total${options.type ? ` (type: ${options.type})` : ""}${options.since ? ` (since: ${options.since})` : ""}\n`);

  for (const event of display) {
    const date = event.timestamp.slice(0, 19).replace("T", " ");
    const base = `${date}  [${event.type}]`;
    if (event.type === "tier_change") {
      console.log(`${base}  ${event.surface_form} (id:${event.concept_id})  ${event.from} → ${event.to}  source:${event.source}`);
    } else if (event.type === "sentiment_flip") {
      console.log(`${base}  ${event.surface_form} (id:${event.concept_id})  ${event.from} → ${event.to}  source:${event.source}`);
    } else if (event.type === "graduation") {
      console.log(`${base}  ${event.surface_form} (id:${event.concept_id})  source:${event.source}`);
    } else if (event.type === "prune") {
      console.log(`${base}  ${event.surface_form} (id:${event.concept_id})  source:${event.source}`);
    } else if (event.type === "moment_capture") {
      console.log(`${base}  ${event.moment_id.slice(0, 8)}...  "${event.story_preview}"  source:${event.source}`);
    } else {
      console.log(`${base}  ${JSON.stringify(event)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 6: AI Family subcommands
// ---------------------------------------------------------------------------

/**
 * write: Write text to an agent's private axon store.
 * Usage: theorex write --agent <id> <text>
 */
export async function runWrite(agentId: string, text: string, config: Config, observationType = ""): Promise<void> {
  const result = await writeToAgent(agentId, text, config, Date.now(), observationType);
  console.log(`Written to ${agentId}: +${result.conceptsAdded} concepts, +${result.edgesAdded} edges`);
  console.log(`  Path: ${result.axonPath}`);
}

/**
 * promote: Promote qualifying concepts from an agent's private axon to the shared web.
 * Usage: theorex promote --agent <id> [--force <concept_id,...>]
 */
export async function runPromote(
  agentId: string,
  config: Config,
  forceIds?: ReadonlySet<number>,
): Promise<void> {
  const result = await promoteToShared(agentId, config, Date.now(), forceIds);
  console.log(`Promoted from ${agentId} → shared: ${result.promoted} concepts, ${result.edgesPromoted} edges (${result.skipped} skipped)`);
  console.log(`  Shared: ${resolvedSharedAxonPath(config.sharedAxonPath)}`);
}

/**
 * query-shared: Show status of the shared concept web.
 * Usage: theorex query-shared
 */
export async function runQueryShared(config: Config): Promise<void> {
  const sharedPath = resolvedSharedAxonPath(config.sharedAxonPath);
  await runStatus(sharedPath, config);
}

/**
 * ingest: Read markdown files into an agent's private axon (section-chunked).
 * Usage: theorex ingest --agent <id> <file1> [file2 ...]
 */
export async function runIngest(agentId: string, filePaths: string[], config: Config): Promise<void> {
  console.log(`Ingesting ${filePaths.length} file(s) for ${agentId}...`);
  const result = await ingestFiles(agentId, filePaths, config);
  console.log(`Done: ${result.filesProcessed} file(s), ${result.sectionsProcessed} section(s), +${result.conceptsAdded} concepts, +${result.edgesAdded} edges`);
}

/**
 * ingest-code: Parse a source directory and write code symbols into an agent's axon.
 * Usage: theorex ingest-code --agent <id> <dir>
 */
export async function runIngestCode(agentId: string, targetDir: string, config: Config): Promise<void> {
  console.log("Ingesting code from " + targetDir + " for " + agentId + "...");
  const result = await ingestCode(agentId, targetDir, config);
  console.log("Done: " + result.filesProcessed + " file(s), +" + result.symbolsAdded + " symbols, +" + result.edgesAdded + " edges");
}

/**
 * synthesize: LLM-assisted lesson extraction → write to agent's private axon.
 * Usage: theorex synthesize --agent <id> <text>
 * Uses local LLM to extract structured lessons before writing.
 */
/**
 * boot-inject: Write SHARED_CONTEXT.md from the shared axon for agent boot loading.
 * Usage: theorex boot-inject [--output <path>]
 */
export async function runBootInject(config: Config, outputPath?: string): Promise<void> {
  const result = await generateBootContext(config, outputPath);
  console.log(`Boot context written: ${result.activeConcepts} active concepts → ${result.outputPath}`);
}

export async function runSynthesize(agentId: string, text: string, config: Config): Promise<void> {
  console.log(`Synthesizing for ${agentId} via ${config.lmStudioUrl}...`);
  const result = await synthesizeToAgent(agentId, text, config);
  if (result.fallbackUsed) {
    console.log(`LLM unavailable — NLP fallback: +${result.conceptsAdded} concepts`);
  } else {
    console.log(`Extracted ${result.lessonsExtracted} lesson(s): +${result.conceptsAdded} concepts, +${result.edgesAdded} edges`);
  }
}

// ---------------------------------------------------------------------------
// Flash Lobe subcommands (Phase 3)
// ---------------------------------------------------------------------------
import { writeToAgent } from "../family/write";
import { promoteToShared } from "../family/promote";
import { resolvedSharedAxonPath, agentAxonPath } from "../family/paths";
import { ingestFiles } from "../family/ingest";
import { synthesizeToAgent } from "../family/synthesize";
import { generateBootContext } from "../family/boot-inject";
import { writeSessionSummary } from "../family/session-summary";
import { ingestCode } from "../code/ingest";
import { recordFlashEvent } from "../flash/record.ts";
import { flushFlash } from "../flash/flush.ts";
import { injectContext } from "../flash/inject.ts";
import { runContextSlide } from "../context-slide/slide.ts";

/**
 * flash-write: Parse PostToolUse stdin JSON and record to flash ring buffer.
 * Called by PostToolUse hook (async: true — non-blocking).
 */
export async function runFlashWrite(sessionId: string, stdinJson: string): Promise<void> {
  let hookInput: Record<string, unknown>;
  try {
    hookInput = JSON.parse(stdinJson) as Record<string, unknown>;
  } catch {
    return; // malformed JSON — silent exit (async context, stderr not shown)
  }
  await recordFlashEvent(sessionId, hookInput);
}

/**
 * flash-flush: Flush flash buffer to short-term. Called by SessionEnd hook.
 * Also callable manually as `theorex flush` (SessionEnd /exit bug workaround).
 * Returns count of events written to short-term.
 */
export async function runFlashFlush(sessionId: string): Promise<number> {
  return await flushFlash(sessionId);
}

/**
 * flash-inject: Print ACTIVE-tier context to stdout for SessionStart hook.
 * Stdout is injected into Claude's conversation context.
 * Exits cleanly with empty output on cold start.
 */
export async function runFlashInject(sessionId: string): Promise<void> {
  const context = await injectContext(sessionId);
  if (context.trim()) {
    process.stdout.write(context + "\n");
  }
}

/**
 * context-monitor: Check context usage and trigger compression if threshold crossed.
 * Called by PostToolUse hook (async: true — non-blocking).
 * Outputs JSON with additionalContext when compression fires; exits silently otherwise.
 */
export async function runContextMonitor(sessionId: string): Promise<void> {
  const config = await loadConfig();
  const result = await runContextSlide(sessionId, config);

  if (result.triggered && result.additionalContext) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: result.additionalContext,
      },
    };
    process.stdout.write(JSON.stringify(output));
  }
}

// ---------------------------------------------------------------------------
// Main dispatch (only runs when executed directly)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    strict: false,
  });

  const [subcommand, ...rest] = positionals;
  const config = await loadConfig();

  // Parse --ref file:line flags for the `moment` subcommand
  const rawRefs: CodeRef[] = Bun.argv
    .filter((_, i) => Bun.argv[i - 1] === "--ref")
    .map((v) => {
      const colonIdx = v.lastIndexOf(":");
      const file = colonIdx > 0 ? v.slice(0, colonIdx) : v;
      const line = colonIdx > 0 ? Number(v.slice(colonIdx + 1)) || 1 : 1;
      return { file, line };
    });

  switch (subcommand) {
    case "prune-agent": {
      // Usage: theorex prune-agent --agent <id>
      // Prune LESS-tier nodes from an agent's private axon. Run after scan-agent.
      const { values: paValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: false,
        strict: false,
      });
      const paAgent = typeof paValues.agent === "string" ? paValues.agent : undefined;
      if (!paAgent) {
        console.error("Usage: theorex prune-agent --agent <id>");
        process.exit(1);
      }
      const paPath = agentAxonPath(paAgent, config.agentAxonDir);
      const paArchive = paPath.replace(/axon\.json$/, "archive");
      console.log("Pruning " + paAgent + "...");
      await runPrune(paPath, paArchive, config);
      break;
    }

    case "scan-agent": {
      // Usage: theorex scan-agent --agent <id>
      // Re-scores all nodes in an agent's private axon using compositeScore (recency + frequency + co-occurrence).
      // Updates relevance_tier: ACTIVE / MILD / LESS. Decays edges. Call this periodically.
      const { values: saValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: false,
        strict: false,
      });
      const saAgent = typeof saValues.agent === "string" ? saValues.agent : undefined;
      if (!saAgent) {
        console.error("Usage: theorex scan-agent --agent <id>");
        process.exit(1);
      }
      const saPath = agentAxonPath(saAgent, config.agentAxonDir);
      console.log("Scanning " + saAgent + "...");
      await runScan(saPath, config);
      console.log("Done.");
      break;
    }

    case "scan":
      await runScan(config.axonPath ?? "data/axon.json", config);
      break;

    case "status":
      await runStatus(config.axonPath ?? "data/axon.json", config);
      break;

    case "ref": {
      const keyword = rest[0];
      if (!keyword) {
        console.error("Usage: theorex ref <keyword>");
        process.exit(1);
      }
      await runRef(config.axonPath ?? "data/axon.json", keyword, config);
      break;
    }

    case "prune":
      await runPrune(config.axonPath ?? "data/axon.json", ARCHIVE_DIR, config);
      break;

    case "search": {
      const query = rest.join(" ");
      if (!query) {
        console.error("Usage: theorex search <query>");
        process.exit(1);
      }
      await runSearch(query, config);
      break;
    }

    case "graduate":
      await runGraduate(config, MEMORY_PATH);
      break;

    case "flash-write": {
      // Usage: theorex flash-write --session <id> (reads stdin)
      const sessionFlag = rest.indexOf("--session");
      const sid = sessionFlag >= 0 ? rest[sessionFlag + 1] : "unknown";
      const stdin = await Bun.stdin.text();
      await runFlashWrite(sid ?? "unknown", stdin);
      break;
    }

    case "flash-flush":
    case "flush": {
      // Usage: theorex flush --session <id>
      // "flush" alias = SessionEnd /exit bug workaround (HKS-02 fallback)
      const sessionFlag = rest.indexOf("--session");
      const sid = sessionFlag >= 0 ? rest[sessionFlag + 1] : "unknown";
      const count = await runFlashFlush(sid ?? "unknown");
      console.log(`Flushed ${count} event(s) to short-term.`);
      break;
    }

    case "flash-inject": {
      // Usage: theorex flash-inject --session <id>
      const sessionFlag = rest.indexOf("--session");
      const sid = sessionFlag >= 0 ? rest[sessionFlag + 1] : "unknown";
      await runFlashInject(sid ?? "unknown");
      break;
    }

    case "context-monitor": {
      // Usage: theorex context-monitor --session <id>
      // Called by PostToolUse hook — outputs additionalContext JSON if compression fires
      const sessionFlag = rest.indexOf("--session");
      const sid = sessionFlag >= 0 ? rest[sessionFlag + 1] : "unknown";
      await runContextMonitor(sid ?? "unknown");
      break;
    }

    case "moment": {
      // Usage: theorex moment <story> [--ref file:line ...]
      const story = positionals.slice(1).join(" ").trim();
      if (!story) {
        console.error("Usage: theorex moment <story>");
        process.exit(1);
      }
      await runMoment(story, config.axonPath ?? "data/axon.json", config, rawRefs);
      break;
    }

    case "write": {
      // Usage: theorex write --agent <id> <text...>
      const { values: writeValues, positionals: writePos } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: true,
        strict: false,
      });
      const agentId = typeof writeValues.agent === "string" ? writeValues.agent : rest[0];
      const writeText = agentId === rest[0] ? rest.slice(1).join(" ") : writePos.join(" ");
      if (!agentId || !writeText) {
        console.error("Usage: theorex write --agent <id> <text>");
        process.exit(1);
      }
      await runWrite(agentId, writeText, config);
      break;
    }

    case "promote": {
      // Usage: theorex promote --agent <id> [--force <id1,id2,...>]
      const { values: promValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent: { type: "string" },
          force: { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const promAgentId = typeof promValues.agent === "string" ? promValues.agent : rest[0];
      if (!promAgentId) {
        console.error("Usage: theorex promote --agent <id> [--force <concept_id,...>]");
        process.exit(1);
      }
      const forceIds = typeof promValues.force === "string"
        ? new Set(promValues.force.split(",").map(Number).filter(Boolean))
        : undefined;
      await runPromote(promAgentId, config, forceIds);
      break;
    }

    case "query-shared":
      await runQueryShared(config);
      break;

    case "boot-inject": {
      // Usage: theorex boot-inject [--output <path>]
      const { values: biValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: { output: { type: "string" } },
        allowPositionals: false,
        strict: false,
      });
      await runBootInject(config, typeof biValues.output === "string" ? biValues.output : undefined);
      break;
    }

    case "ingest": {
      // Usage: theorex ingest --agent <id> <file1> [file2 ...]
      const { values: ingestValues, positionals: ingestFiles } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: true,
        strict: false,
      });
      const ingestAgent = typeof ingestValues.agent === "string" ? ingestValues.agent : ingestFiles[0];
      const ingestPaths = typeof ingestValues.agent === "string" ? ingestFiles : ingestFiles.slice(1);
      if (!ingestAgent || ingestPaths.length === 0) {
        console.error("Usage: theorex ingest --agent <id> <file1> [file2 ...]");
        process.exit(1);
      }
      await runIngest(ingestAgent, ingestPaths, config);
      break;
    }

    case "synthesize": {
      // Usage: theorex synthesize --agent <id> <text>
      const { values: synthValues, positionals: synthPos } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: true,
        strict: false,
      });
      const synthAgent = typeof synthValues.agent === "string" ? synthValues.agent : synthPos[0];
      const synthText = typeof synthValues.agent === "string" ? synthPos.join(" ") : synthPos.slice(1).join(" ");
      if (!synthAgent || !synthText) {
        console.error("Usage: theorex synthesize --agent <id> <text>");
        process.exit(1);
      }
      await runSynthesize(synthAgent, synthText, config);
      break;
    }



    case "session-summary": {
      // Usage: theorex session-summary --agent <id> [--investigated ...] [--learned ...] [--completed ...] [--next ...]
      const { values: ssValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent:        { type: "string" },
          investigated: { type: "string" },
          learned:      { type: "string" },
          completed:    { type: "string" },
          next:         { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const ssAgent = typeof ssValues.agent === "string" ? ssValues.agent : undefined;
      if (!ssAgent) {
        console.error("Usage: theorex session-summary --agent <id> [--investigated ...] [--learned ...] [--completed ...] [--next ...]");
        process.exit(1);
      }
      const summary = {
        investigated: typeof ssValues.investigated === "string" ? ssValues.investigated : undefined,
        learned:      typeof ssValues.learned      === "string" ? ssValues.learned      : undefined,
        completed:    typeof ssValues.completed    === "string" ? ssValues.completed    : undefined,
        next_steps:   typeof ssValues.next        === "string" ? ssValues.next         : undefined,
      };
      const fields = Object.values(summary).filter(Boolean).length;
      if (fields === 0) {
        console.error("Provide at least one field: --investigated, --learned, --completed, --next");
        process.exit(1);
      }
      console.log("Writing session summary for " + ssAgent + " (" + fields + " field(s))...");
      const ssResult = await writeSessionSummary(ssAgent, summary, config);
      console.log("Done: +" + ssResult.conceptsAdded + " concepts, +" + ssResult.edgesAdded + " edges");
      break;
    }

    case "ingest-code": {
      // Usage: theorex ingest-code --agent <id> <dir> [--theronexus]
      const { values: icValues, positionals: icPos } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent: { type: "string" },
          theronexus: { type: "boolean" },
        },
        allowPositionals: true,
        strict: false,
      });
      const icAgent = typeof icValues.agent === "string" ? icValues.agent : icPos[0];
      const icDir = typeof icValues.agent === "string" ? icPos[0] : icPos[1];
      if (!icAgent || !icDir) {
        console.error("Usage: theorex ingest-code --agent <id> <dir> [--theronexus]");
        process.exit(1);
      }
      await runIngestCode(icAgent, icDir, config);

      // Phase 7.5: optionally run Theronexus structural analysis after AST ingest
      if (icValues.theronexus) {
        const { analyzeWithTheronexus } = await import("../code/theronexus-bridge");
        console.log(`\n[theronexus] Indexing ${icDir}...`);
        const gnResult = await analyzeWithTheronexus(icAgent, icDir, config);
        if (gnResult.status === "unavailable") {
          console.warn(`[theronexus] ${gnResult.message}`);
          console.warn(`[theronexus] Structural index skipped — Theorex AST index still complete.`);
        } else if (gnResult.status === "failed") {
          console.warn(`[theronexus] ${gnResult.message}`);
        } else {
          console.log(`[theronexus] ${gnResult.message}`);
          console.log(`[theronexus] Marker node 'theronexus:${icDir.split("/").pop()}' written to axon.`);
          console.log(`[theronexus] Run: theorex mcp-start to serve both Theorex + Theronexus via MCP.`);
        }
      }
      break;
    }

        case "drift":
      await runDrift(config.axonPath ?? "data/axon.json", config.eventsPath, config);
      break;

    case "audit": {
      // Re-parse from raw argv so --type and --since flags are captured correctly.
      // The top-level parseArgs discards option values for unknown options,
      // so we must re-parse the full arg list starting after the subcommand.
      const auditArgs = Bun.argv.slice(2).filter((a) => a !== "audit");
      const { values: auditValues } = parseArgs({
        args: auditArgs,
        options: {
          type: { type: "string" },
          since: { type: "string" },
        },
        strict: false,
        allowPositionals: false,
      });
      await runAudit(config.eventsPath, {
        type: typeof auditValues.type === "string" ? auditValues.type : undefined,
        since: typeof auditValues.since === "string" ? auditValues.since : undefined,
      });
      break;
    }

    case "ingest-image": {
      // Usage: theorex ingest-image <path> [--context "text"] [--agent <id>]
      const { values: iiValues, positionals: iiPos } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          context: { type: "string" },
          agent:   { type: "string" },
        },
        allowPositionals: true,
        strict: false,
      });
      const iiPath = iiPos[0];
      if (!iiPath) {
        console.error("Usage: theorex ingest-image <path> [--context \"text\"] [--agent <id>]");
        process.exit(1);
      }
      const { ingestImage } = await import("../vision/ingest");
      const iiResult = await ingestImage(iiPath, config, {
        userContext: typeof iiValues.context === "string" ? iiValues.context : undefined,
        agentId: typeof iiValues.agent === "string" ? iiValues.agent : "main",
      });
      if (!iiResult) {
        console.error("Vision model unavailable. Set ANTHROPIC_API_KEY or config.visionEndpoint.");
        process.exit(1);
      }
      console.log(`Image ingested: ${iiResult.memory.id}`);
      console.log(`  Description: ${iiResult.memory.description.slice(0, 80)}...`);
      console.log(`  Elements: ${iiResult.memory.elements.slice(0, 5).join(", ")}`);
      console.log(`  +${iiResult.conceptsAdded} concepts, +${iiResult.edgesAdded} edges`);
      break;
    }

    case "ingest-video": {
      // Usage: theorex ingest-video <path> [--context "text"] [--agent <id>]
      const { values: ivValues, positionals: ivPos } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          context: { type: "string" },
          agent:   { type: "string" },
        },
        allowPositionals: true,
        strict: false,
      });
      const ivPath = ivPos[0];
      if (!ivPath) {
        console.error("Usage: theorex ingest-video <path> [--context \"text\"] [--agent <id>]");
        process.exit(1);
      }
      const { ingestVideo } = await import("../vision/ingest-video");
      const ivResult = await ingestVideo(ivPath, config, {
        userContext: typeof ivValues.context === "string" ? ivValues.context : undefined,
        agentId: typeof ivValues.agent === "string" ? ivValues.agent : "main",
      });
      if (!ivResult) {
        console.error("Video ingestion failed. Ensure ffmpeg is installed and ANTHROPIC_API_KEY is set (or config.visionEndpoint).");
        process.exit(1);
      }
      console.log(`Video ingested: ${ivResult.memory.id}`);
      console.log(`  Duration: ${Math.round(ivResult.memory.duration_seconds)}s, ${ivResult.framesProcessed} anchors`);
      console.log(`  Summary: ${ivResult.memory.summary.slice(0, 100)}...`);
      console.log(`  +${ivResult.conceptsAdded} concepts, +${ivResult.edgesAdded} edges`);
      break;
    }

    // Phase 13: Living Code — record an outcome
    case "outcome": {
      // Usage: theorex outcome --agent <id> --decision "text" --result "text" [--success|--fail] [--tags tag1,tag2]
      const { values: ocValues, positionals: ocPos } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent:    { type: "string" },
          decision: { type: "string" },
          result:   { type: "string" },
          success:  { type: "boolean" },
          fail:     { type: "boolean" },
          tags:     { type: "string" },
        },
        allowPositionals: true,
        strict: false,
      });
      const ocAgent = typeof ocValues.agent === "string" ? ocValues.agent : "main";
      const ocDecision = typeof ocValues.decision === "string" ? ocValues.decision : ocPos.join(" ");
      const ocResult = typeof ocValues.result === "string" ? ocValues.result : "";
      if (!ocDecision) {
        console.error("Usage: theorex outcome --agent <id> --decision \"text\" --result \"text\" [--success|--fail] [--tags tag1,tag2]");
        process.exit(1);
      }
      const ocSuccess = ocValues.fail === true ? false : (ocValues.success !== false);
      const ocTags = typeof ocValues.tags === "string" ? ocValues.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      const { buildOutcome, recordOutcome } = await import("../evolve/outcome");
      const ocRecord = buildOutcome({
        agentId: ocAgent,
        decision: ocDecision,
        result: ocResult,
        success: ocSuccess,
        tags: ocTags,
      });
      await recordOutcome(ocRecord, config.outcomesDir ?? "data/outcomes");
      console.log(`Outcome recorded: ${ocRecord.id}`);
      console.log(`  Agent: ${ocAgent} | Success: ${ocSuccess} | Tags: ${ocTags.join(", ") || "(none)"}`);
      break;
    }

    // Phase 13: Living Code — nightly evolution review
    case "evolve-review": {
      // Usage: theorex evolve-review [--agent <id|all>] [--days <n>]
      const { values: erValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent: { type: "string" },
          days:  { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const erAgentArg = typeof erValues.agent === "string" ? erValues.agent : "all";
      const erDays = typeof erValues.days === "string" ? parseInt(erValues.days, 10) : (config.evolveWindowDays ?? 7);
      const outcomesDir = config.outcomesDir ?? "data/outcomes";
      const { reviewOutcomes } = await import("../evolve/review");
      const { refineFromReport } = await import("../evolve/refine");

      // Discover agent IDs: glob ~/.openclaw/agents/*/theorex/axon.json
      let erAgents: string[];
      if (erAgentArg === "all") {
        const { readdir } = await import("node:fs/promises");
        const agentBaseDir = config.agentAxonDir;
        const entries = await readdir(agentBaseDir, { withFileTypes: true }).catch(() => []);
        const discovered = entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
        erAgents = discovered.length > 0 ? discovered : ["main"];
      } else {
        erAgents = [erAgentArg];
      }

      for (const erAgent of erAgents) {
        const erAxonPath = agentAxonPath(erAgent, config.agentAxonDir);
        const erReport = await reviewOutcomes(erAgent, erDays, outcomesDir);
        const erEntry = await refineFromReport(erReport, config, erAxonPath);
        console.log(`Evolution review complete for agent "${erAgent}" (last ${erDays} days)`);
        console.log(`  Outcomes: ${erReport.total_outcomes} | Win rate: ${Math.round(erReport.overall_win_rate * 100)}%`);
        console.log(`  Concepts reinforced: ${erEntry.concepts_reinforced} | Decayed: ${erEntry.concepts_decayed}`);
        if (erReport.insights.length > 0) {
          console.log("\nInsights:");
          for (const insight of erReport.insights) {
            console.log(`  • ${insight}`);
          }
        }
      }

      // Phase 20: GEPA-style trace review — run after pattern analysis
      {
        const { reviewAllFailures } = await import("../evolve/trace-review");
        const trReviewed = await reviewAllFailures(
          erAgentArg,
          config,
          outcomesDir,
        );
        if (trReviewed.length > 0) {
          const written = trReviewed.filter((r) => r.written_to_axon).length;
          console.log(`\nTrace Review (Phase 20): ${trReviewed.length} failure(s) reviewed, ${written} fix(es) written to axon`);
        }
      }
      break;
    }

    // Phase 21: Outcome Archive — move old reviewed outcomes to archive subdir
    case "outcome-archive": {
      // Usage: theorex outcome-archive [--days <n>] [--dry-run]
      const { values: oaValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          days:      { type: "string" },
          "dry-run": { type: "boolean" },
        },
        allowPositionals: false,
        strict: false,
      });
      const oaDays = typeof oaValues.days === "string" ? parseInt(oaValues.days, 10) : 30;
      const oaDryRun = oaValues["dry-run"] === true;
      const oaOutcomesDir = config.outcomesDir ?? "data/outcomes";
      const { archiveOutcomes } = await import("../evolve/outcome");

      if (oaDryRun) {
        // Dry-run: read outcomes and report what would be archived without moving files
        const { readOutcomes } = await import("../evolve/outcome");
        const all = await readOutcomes(oaOutcomesDir);
        const cutoffMs = oaDays * 24 * 60 * 60 * 1000;
        const wouldArchive = all.filter((o) => {
          const reviewed = o.trace_id !== undefined || o.judge_score !== undefined;
          const old = Date.now() - new Date(o.timestamp).getTime() >= cutoffMs;
          return reviewed && old;
        });
        console.log(`Dry-run — would archive ${wouldArchive.length} outcome(s) older than ${oaDays} days`);
        for (const o of wouldArchive) {
          console.log(`  ${o.id.slice(0, 8)}  ${o.timestamp.slice(0, 10)}  ${o.decision.slice(0, 50)}`);
        }
      } else {
        const result = await archiveOutcomes(oaOutcomesDir, oaDays);
        console.log(`Outcome archive complete — archived: ${result.archived}, skipped: ${result.skipped}`);
        if (result.archived > 0) {
          console.log(`  Archive dir: ${result.archiveDir}`);
        }
      }
      break;
    }

    // Phase 13: Living Code — show evolution history
    case "evolve-status": {
      // Usage: theorex evolve-status [--agent <id>] [--n <count>]
      const { values: esValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent: { type: "string" },
          n:     { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const esAgent = typeof esValues.agent === "string" ? esValues.agent : "";
      const esN = typeof esValues.n === "string" ? parseInt(esValues.n, 10) : 5;
      const { readEvolutionLog } = await import("../evolve/refine");
      const esLog = await readEvolutionLog(config.evolutionLogPath ?? "data/evolution.jsonl");
      const filtered = esAgent ? esLog.filter((e) => e.agent_id === esAgent) : esLog;
      const recent = filtered.slice(-esN);
      if (recent.length === 0) {
        console.log("No evolution history yet. Run `theorex evolve-review` to start.");
      } else {
        console.log(`Evolution history (last ${recent.length} entries${esAgent ? ` for agent "${esAgent}"` : ""}):`);
        for (const entry of recent) {
          const date = new Date(entry.timestamp).toLocaleDateString();
          console.log(`\n[${date}] ${entry.agent_id} — ${entry.total_outcomes} outcomes, ${Math.round(entry.overall_win_rate * 100)}% WR`);
          for (const insight of entry.insights) {
            console.log(`  • ${insight}`);
          }
        }
      }
      break;
    }

    // Phase 15.5: Trace stats — show summary of data/traces/
    case "trace-stats": {
      // Usage: theorex trace-stats
      try {
        const { readTraces } = await import("../trace/index");
        const traces = await readTraces();
        const total = traces.length;
        const successes = traces.filter((t) => t.success).length;
        const successRate = total > 0 ? successes / total : 0;
        const byModel: Record<string, number[]> = {};
        for (const t of traces) {
          (byModel[t.model] ??= []).push(t.latency_ms);
        }
        console.log(`Trace Stats — ${total} trace file(s)`);
        console.log(`  Success rate: ${(successRate * 100).toFixed(1)}%`);
        if (Object.keys(byModel).length > 0) {
          console.log("\n  Avg latency by model:");
          for (const [model, latencies] of Object.entries(byModel)) {
            const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            console.log(`    ${model}: ${avg.toFixed(0)}ms`);
          }
        }
      } catch {
        console.error("Module not ready — build Phase 16 first");
        process.exit(1);
      }
      break;
    }

    // Phase 15.5: Route — show routing decision for a query
    case "route": {
      // Usage: theorex route <query>
      const routeQuery = rest.join(" ");
      if (!routeQuery) {
        console.error("Usage: theorex route <query>");
        process.exit(1);
      }
      try {
        const { route, classifyQuery } = await import("../router/heuristic");
        const decision = route({ agent_id: "cli", query: routeQuery, context_pct: 0, query_tokens: routeQuery.split(" ").length });
        console.log(`Routing decision for: "${routeQuery}"`);
        console.log(`  Model:      ${decision.model_name}`);
        console.log(`  Tier:       ${decision.model_tier}`);
        console.log(`  Query type: ${decision.query_type}`);
        console.log(`  Reason:     ${decision.reason}`);
        console.log(`  Confidence: ${decision.confidence.toFixed(2)}`);
      } catch {
        console.error("Module not ready — build Phase 16 first");
        process.exit(1);
      }
      break;
    }

    // Phase 15.5: Matrix build — build confidence matrix from traces
    case "matrix-build": {
      // Usage: theorex matrix-build
      try {
        const { buildMatrix, saveMatrix } = await import("../router/confidence-matrix");
        const matrix = await buildMatrix();
        await saveMatrix(matrix);
        const models = [...new Set(matrix.cells.map((c) => c.model_name))];
        console.log(`Confidence matrix built and saved. ${matrix.cells.length} cell(s).`);
        if (models.length > 0) console.log(`  Models: ${models.join(", ")}`);
      } catch {
        console.error("Module not ready — build Phase 16 first");
        process.exit(1);
      }
      break;
    }

    // Phase 15.5: Matrix show — print confidence matrix as a readable table
    case "matrix-show": {
      // Usage: theorex matrix-show
      try {
        const { loadMatrix } = await import("../router/confidence-matrix");
        const matrix = await loadMatrix();
        if (!matrix || matrix.cells.length === 0) {
          console.log("No confidence matrix found. Run: theorex matrix-build");
          break;
        }
        console.log(`Confidence Matrix (built ${matrix.built_at})\n`);
        const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
        const header = pad("query_type", 14) + pad("model", 20) + pad("success%", 10) + pad("latency", 10) + "samples";
        console.log(header);
        console.log("-".repeat(header.length));
        for (const cell of matrix.cells) {
          const row = pad(cell.query_type, 14) + pad(cell.model_name, 20) +
            pad((cell.success_rate * 100).toFixed(1) + "%", 10) +
            pad(cell.avg_latency_ms.toFixed(0) + "ms", 10) +
            cell.sample_count;
          console.log(row);
        }
      } catch {
        console.error("Module not ready — build Phase 16 first");
        process.exit(1);
      }
      break;
    }

    // Phase 17: Energy check — show power state and dispatch advice
    case "energy-check": {
      // Usage: theorex energy-check
      try {
        const { readPowerState, getDispatchAdvice } = await import("../router/energy");
        const reading = await readPowerState();
        const advice = getDispatchAdvice(reading, "medium");
        console.log(`Source:   ${reading.on_battery ? "Battery" : "AC Power"} (via ${reading.source})`);
        console.log(`Battery:  ${reading.battery_pct !== undefined ? reading.battery_pct + "%" : "N/A"}`);
        console.log(`Large model allowed: ${advice.allow_large_model}`);
        console.log(`Reason:   ${advice.reason}`);
      } catch {
        console.error("Module not ready — build Phase 16 first");
        process.exit(1);
      }
      break;
    }

    // Phase 13 / Gated Learning: policy snapshot — evaluate current policy and save snapshot
    case "policy-snapshot": {
      // Usage: theorex policy-snapshot
      try {
        const { evaluateCurrentPolicy, saveSnapshot } = await import("../evolve/gated-learning");
        const metrics = await evaluateCurrentPolicy();
        const snapshot = await saveSnapshot(metrics);
        console.log(`Policy snapshot saved: v${snapshot.version}`);
        console.log(`  Samples:       ${metrics.sample_count}`);
        console.log(`  Success rate:  ${(metrics.success_rate * 100).toFixed(1)}%`);
        console.log(`  Avg composite: ${metrics.avg_composite_score.toFixed(3)}`);
        console.log(`  Promotions:    ${metrics.promotion_count}`);
      } catch {
        console.error("Module not ready — build Phase 16 first");
        process.exit(1);
      }
      break;
    }

    // Phase 22: Boot-aware — generate context-aware boot context
    case "boot-aware": {
      // Usage: theorex boot-aware [--model <name>] [--agent <id>]
      const { values: baValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          model: { type: "string" },
          agent: { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const baModel = typeof baValues.model === "string" ? baValues.model : undefined;
      const baAgent = typeof baValues.agent === "string" ? baValues.agent : "main";
      try {
        const { buildContextAwareBootContext } = await import("../memory/boot-aware");
        const context = await buildContextAwareBootContext(baAgent, baModel);
        const estTokens = Math.ceil(context.length / 4);
        console.log(`Boot-aware context for agent "${baAgent}"${baModel ? ` (model: ${baModel})` : ""}`);
        console.log(`  Estimated tokens: ${estTokens}`);
        console.log(`  Length:           ${context.length} chars`);
        console.log("\n" + context.slice(0, 500) + (context.length > 500 ? "\n…" : ""));
      } catch {
        console.error("Module not ready — build Phase 16 first");
        process.exit(1);
      }
      break;
    }

    // Phase 16: Parallel Background Processing — dispatch task to local LLM
    case "dispatch": {
      // Usage: theorex dispatch "<task>" [--agent <id>] [--context <pct>] [--outcome-id <id>] [--tier medium|large]
      const { values: dpValues, positionals: dpPos } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent:        { type: "string" },
          context:      { type: "string" },
          "outcome-id": { type: "string" },
          tier:         { type: "string" },
        },
        allowPositionals: true,
        strict: false,
      });
      const dpAgent = typeof dpValues.agent === "string" ? dpValues.agent : "main";
      const dpContextPct = typeof dpValues.context === "string" ? parseFloat(dpValues.context) : 50;
      const dpOutcomeId = typeof dpValues["outcome-id"] === "string" ? dpValues["outcome-id"] : undefined;
      const dpTierRaw = typeof dpValues.tier === "string" ? dpValues.tier : undefined;
      const dpTier = (dpTierRaw === "large" || dpTierRaw === "medium" || dpTierRaw === "small")
        ? dpTierRaw as "large" | "medium" | "small"
        : undefined;
      const dpTask = dpPos.join(" ").trim();
      if (!dpTask) {
        console.error('Usage: theorex dispatch "<task>" [--agent <id>] [--context <pct>] [--outcome-id <id>] [--tier medium|large]');
        process.exit(1);
      }
      const { dispatchIfNeeded } = await import("../dispatch/index");
      const dpResult = await dispatchIfNeeded(dpAgent, dpTask, dpContextPct, {}, dpOutcomeId, dpTier);
      if (!dpResult) {
        console.log(`Context at ${dpContextPct}% — below trigger threshold, dispatch skipped.`);
      } else if (dpResult.success) {
        console.log(`Dispatched to ${dpResult.model_used} (${dpResult.latency_ms}ms)`);
        console.log(`  Written to axon: ${dpResult.written_to_axon}`);
        if (dpOutcomeId) console.log(`  Outcome patched: ${dpOutcomeId}`);
        if (dpResult.trace_id) console.log(`  Trace ID:        ${dpResult.trace_id}`);
        console.log(`\n${dpResult.response.slice(0, 400)}${dpResult.response.length > 400 ? "\n…" : ""}`);
      } else {
        console.error(`Dispatch failed: ${dpResult.error ?? "unknown error"}`);
        process.exit(1);
      }
      break;
    }

    // Phase 18: Formal Agent Roles — list all profiles
    case "roles": {
      // Usage: theorex roles
      const { loadProfiles } = await import("../roles/index");
      const profiles = await loadProfiles();
      const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
      const COL_ID = 16;
      const COL_ROLE = 14;
      const COL_CAPS = 36;
      const COL_MODEL = 20;
      const header =
        pad("agent_id", COL_ID) +
        pad("role", COL_ROLE) +
        pad("capabilities", COL_CAPS) +
        pad("model", COL_MODEL) +
        "active";
      console.log(`Agent Profiles — ${profiles.length} registered\n`);
      console.log(header);
      console.log("-".repeat(header.length + 6));
      for (const p of profiles) {
        const row =
          pad(p.agent_id, COL_ID) +
          pad(p.role, COL_ROLE) +
          pad(p.capabilities.join(", "), COL_CAPS) +
          pad(p.model_preference, COL_MODEL) +
          (p.active ? "yes" : "no");
        console.log(row);
      }
      break;
    }

    // Phase 18: Formal Agent Roles — show which agent handles a query
    case "role-route": {
      // Usage: theorex role-route <query>
      const rrQuery = rest.join(" ").trim();
      if (!rrQuery) {
        console.error("Usage: theorex role-route <query>");
        process.exit(1);
      }
      const { classifyQuery } = await import("../router/heuristic");
      const { loadProfiles, routeToAgent } = await import("../roles/index");
      const profiles = await loadProfiles();
      const queryType = classifyQuery(rrQuery);
      const agent = routeToAgent(queryType, profiles);
      console.log(`Query:      "${rrQuery}"`);
      console.log(`Query type: ${queryType}`);
      if (agent) {
        console.log(`Routed to:  ${agent.agent_id} (${agent.role})`);
        console.log(`Model:      ${agent.model_preference}`);
        console.log(`Caps:       ${agent.capabilities.join(", ")}`);
      } else {
        console.log("Routed to:  (no matching agent)");
      }
      break;
    }

    // Phase 19: MCP server — start HTTP JSON-RPC server
    case "mcp-start": {
      // Usage: theorex mcp-start [--port <n>] [--agent <id>]
      const { values: mcpValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          port:  { type: "string" },
          agent: { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const mcpPort = typeof mcpValues.port === "string" ? parseInt(mcpValues.port, 10) : 18800;
      const mcpAgent = typeof mcpValues.agent === "string" ? mcpValues.agent : "main";
      const { startMcpServer } = await import("../mcp/server");
      const server = startMcpServer({ port: mcpPort, agentId: mcpAgent });
      console.log(`Theorex MCP server listening at http://${server.hostname}:${server.port}/mcp`);
      console.log(`Agent: ${mcpAgent} | POST /mcp for JSON-RPC 2.0`);
      // keep process alive
      await new Promise(() => {});
      break;
    }

    // Phase 19: A2A tasks — list pending tasks for an agent
    case "a2a-tasks": {
      // Usage: theorex a2a-tasks [--agent <id>]
      const { values: a2aValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: false,
        strict: false,
      });
      const a2aAgent = typeof a2aValues.agent === "string" ? a2aValues.agent : "main";
      const { listPendingTasks } = await import("../a2a/tasks");
      const pending = await listPendingTasks(a2aAgent);
      if (pending.length === 0) {
        console.log(`No pending A2A tasks for agent "${a2aAgent}".`);
        break;
      }
      console.log(`Pending A2A tasks for agent "${a2aAgent}" (${pending.length}):\n`);
      const padA2A = (s: string, n: number) => s.padEnd(n).slice(0, n);
      console.log(padA2A("ID", 28) + padA2A("FROM", 16) + padA2A("TYPE", 16) + padA2A("STATUS", 10) + "SUBMITTED");
      console.log("-".repeat(82));
      for (const t of pending) {
        console.log(
          padA2A(t.id, 28) +
          padA2A(t.from_agent, 16) +
          padA2A(t.task_type, 16) +
          padA2A(t.status, 10) +
          t.submitted_at.slice(0, 19).replace("T", " "),
        );
      }
      break;
    }

    // Phase 20: Trace Review — review failed outcomes with LLM diagnosis
    case "trace-review": {
      // Usage: theorex trace-review [--agent <id|all>]
      const { values: trValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: false,
        strict: false,
      });
      const trAgent = typeof trValues.agent === "string" ? trValues.agent : "main";
      const trOutcomesDir = config.outcomesDir ?? "data/outcomes";
      const { reviewAllFailures } = await import("../evolve/trace-review");
      console.log(`Running trace review for agent "${trAgent}"...`);
      const trResults = await reviewAllFailures(trAgent, config, trOutcomesDir);
      if (trResults.length === 0) {
        console.log("No failed outcomes below review threshold. Nothing to review.");
        break;
      }
      const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
      const COL_ID = 12;
      const COL_MODEL = 16;
      const COL_SCORE = 8;
      const COL_AXON = 8;
      console.log(`\nTrace Review Results — ${trResults.length} failure(s)\n`);
      console.log(pad("outcome_id", COL_ID) + pad("model", COL_MODEL) + pad("score", COL_SCORE) + pad("axon", COL_AXON) + "fix_description");
      console.log("-".repeat(COL_ID + COL_MODEL + COL_SCORE + COL_AXON + 40));
      for (const r of trResults) {
        const fixPreview = r.fix_description.slice(0, 60) + (r.fix_description.length > 60 ? "…" : "");
        console.log(
          pad(r.outcome_id.slice(0, 11), COL_ID) +
          pad(r.model_used, COL_MODEL) +
          pad(r.score.toFixed(2), COL_SCORE) +
          pad(r.written_to_axon ? "yes" : "no", COL_AXON) +
          fixPreview,
        );
      }
      const written = trResults.filter((r) => r.written_to_axon).length;
      console.log(`\n${written}/${trResults.length} fixes written to axon.`);
      break;
    }

    // Phase 12: Notify agents of config/pack changes
    case "notify-agents": {
      // Usage: theorex notify-agents --reason "text" [--agents id1,id2]
      const { values: naValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          reason:  { type: "string" },
          agents:  { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const naReason = typeof naValues.reason === "string" ? naValues.reason.trim() : "";
      if (!naReason) {
        console.error('Usage: theorex notify-agents --reason "what changed" [--agents id1,id2]');
        process.exit(1);
      }
      const naAgentIds = typeof naValues.agents === "string"
        ? naValues.agents.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const { notifyAgents } = await import("../family/notify");
      const naSummary = await notifyAgents(naReason, naAgentIds);
      console.log(`Notified ${naSummary.success_count} agent(s) — reason: "${naSummary.reason}"`);
      for (const r of naSummary.notified) {
        const status = r.success ? "✓" : `✗ ${r.error ?? "failed"}`;
        console.log(`  ${r.agent_id}: ${status}`);
      }
      if (naSummary.fail_count > 0) process.exit(1);
      break;
    }

    // Phase 12 extension: set-user-pref — write personal layer for an agent
    case "set-user-pref": {
      // Usage: theorex set-user-pref --agent <id> [--name "Name"] [--tone formal|casual|balanced]
      //          [--length brief|detailed|adaptive] [--note "text"] [--contact "text"]
      const { values: supValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent:   { type: "string" },
          name:    { type: "string" },
          tone:    { type: "string" },
          length:  { type: "string" },
          note:    { type: "string" },
          contact: { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const supAgentId = typeof supValues.agent === "string" ? supValues.agent.trim() : "";
      if (!supAgentId) {
        console.error("Usage: theorex set-user-pref --agent <id> [--name \"Name\"] [--tone formal|casual|balanced] [--length brief|detailed|adaptive] [--note \"text\"] [--contact \"text\"]");
        process.exit(1);
      }
      const { loadPersonalLayer: supLoad, savePersonalLayer: supSave } = await import("../profession/personal");
      const cfg = await loadConfig();
      const existing = await supLoad(supAgentId, cfg.agentAxonDir || undefined) ?? {
        name: supAgentId,
        tone: "balanced" as const,
        response_length: "adaptive" as const,
        notes: [] as string[],
        key_contacts: [] as string[],
        last_seen: new Date().toISOString(),
      };
      const validTones = ["formal", "casual", "balanced"] as const;
      const validLengths = ["brief", "detailed", "adaptive"] as const;
      const newTone = typeof supValues.tone === "string" && validTones.includes(supValues.tone as any)
        ? supValues.tone as typeof existing.tone
        : existing.tone;
      const newLength = typeof supValues.length === "string" && validLengths.includes(supValues.length as any)
        ? supValues.length as typeof existing.response_length
        : existing.response_length;
      const updated = {
        ...existing,
        name: typeof supValues.name === "string" ? supValues.name.trim() : existing.name,
        tone: newTone,
        response_length: newLength,
        notes: typeof supValues.note === "string"
          ? [...existing.notes, supValues.note.trim()].filter(Boolean)
          : existing.notes,
        key_contacts: typeof supValues.contact === "string"
          ? [...existing.key_contacts, supValues.contact.trim()].filter(Boolean)
          : existing.key_contacts,
        last_seen: new Date().toISOString(),
      };
      await supSave(supAgentId, updated, cfg.agentAxonDir || undefined);
      console.log(`Personal layer updated for agent: ${supAgentId}`);
      console.log(`  Name: ${updated.name}`);
      console.log(`  Tone: ${updated.tone}, Length: ${updated.response_length}`);
      console.log(`  Notes: ${updated.notes.length}`);
      console.log(`  Contacts: ${updated.key_contacts.length}`);
      break;
    }

    // Phase 12 extension: show-user-pref — display personal layer for an agent
    case "show-user-pref": {
      // Usage: theorex show-user-pref --agent <id>
      const { values: shpValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: false,
        strict: false,
      });
      const shpAgentId = typeof shpValues.agent === "string" ? shpValues.agent.trim() : "";
      if (!shpAgentId) {
        console.error("Usage: theorex show-user-pref --agent <id>");
        process.exit(1);
      }
      const { loadPersonalLayer: shpLoad, formatPersonalContext: shpFormat } = await import("../profession/personal");
      const shpCfg = await loadConfig();
      const layer = await shpLoad(shpAgentId, shpCfg.agentAxonDir || undefined);
      if (!layer) {
        console.log(`No personal layer found for agent: ${shpAgentId}`);
        console.log(`Create one with: theorex set-user-pref --agent ${shpAgentId} --name "Your Name"`);
      } else {
        console.log(shpFormat(layer));
        console.log(`\nLast seen: ${layer.last_seen}`);
      }
      break;
    }

    case "build-index": {
      // Phase 9.5: Build (or rebuild) the HNSW index from the embedding store
      const embStorePath = config.ragEmbeddingStorePath ?? "data/concept-embeddings.json";
      const hnswPath = config.hnswIndexPath ?? "data/hnsw-index.json";
      const vectors = await loadEmbeddings(embStorePath).catch(() => new Map<string, number[]>());
      if (vectors.size === 0) {
        console.log("No embeddings found — nothing to index. Run theorex scan first to populate embeddings.");
        break;
      }
      console.log(`Building HNSW index from ${vectors.size} embeddings...`);
      const built = await buildAndSaveHNSWIndex(hnswPath, vectors);
      const nodeCount = Object.keys(built.nodes).length;
      console.log(`HNSW index built: ${nodeCount} nodes, maxLevel=${built.maxLevel}, M=${built.M} → saved to ${hnswPath}`);
      break;
    }

    // Phase 23: vault-list — show all registered vaults
    case "vault-list": {
      const { loadVaultRegistry } = await import("../vaults/registry");
      const vaults = await loadVaultRegistry(config.vaultRegistryPath ?? "data/vaults.json");

      console.log(`Vaults (${vaults.length})\n`);
      const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
      const COL_NAME = 12;
      const COL_MEMBERS = 40;
      const COL_DOMAINS = 40;
      const header = pad("name", COL_NAME) + pad("members", COL_MEMBERS) + pad("domains", COL_DOMAINS);
      console.log(header);
      console.log("-".repeat(header.length));
      for (const v of vaults) {
        const members = v.members.join(", ");
        const domains = v.domains.length > 0 ? v.domains.join(", ") : "(all)";
        console.log(pad(v.name, COL_NAME) + pad(members, COL_MEMBERS) + pad(domains, COL_DOMAINS));
      }
      break;
    }

    // Phase 23: vault-create — create or update a vault in the registry
    case "vault-create": {
      const { values: vcValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          name: { type: "string" },
          members: { type: "string" },
          readonly: { type: "string" },
          domains: { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const { loadVaultRegistry, saveVaultRegistry, upsertVault, resolveVaultAxonPath } = await import("../vaults/registry");
      const vaultName = typeof vcValues.name === "string" ? vcValues.name.trim() : "";
      if (!vaultName) {
        console.error("Usage: theorex vault-create --name <name> [--members id1,id2] [--readonly id3] [--domains d1,d2]");
        process.exit(1);
      }
      const members = typeof vcValues.members === "string"
        ? vcValues.members.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const readOnly = typeof vcValues.readonly === "string"
        ? vcValues.readonly.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const domains = typeof vcValues.domains === "string"
        ? vcValues.domains.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const registryPath = config.vaultRegistryPath ?? "data/vaults.json";
      const existing = await loadVaultRegistry(registryPath);
      const newVault = {
        name: vaultName,
        path: resolveVaultAxonPath(vaultName),
        members,
        read_only_members: readOnly,
        domains,
        created_at: new Date().toISOString(),
      };
      const updated = upsertVault(existing, newVault);
      await saveVaultRegistry(updated, registryPath);
      console.log(`Vault '${vaultName}' saved.`);
      console.log(`  Path:     ${newVault.path}`);
      console.log(`  Members:  ${members.join(", ") || "(none)"}`);
      console.log(`  Readonly: ${readOnly.join(", ") || "(none)"}`);
      console.log(`  Domains:  ${domains.join(", ") || "(all)"}`);
      break;
    }

    // Phase 23: vault-promote — promote agent private axon to a named vault
    case "vault-promote": {
      const { values: vpValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          agent: { type: "string" },
          vault: { type: "string" },
        },
        allowPositionals: false,
        strict: false,
      });
      const vpAgentId = typeof vpValues.agent === "string" ? vpValues.agent.trim() : "";
      const vpVaultName = typeof vpValues.vault === "string" ? vpValues.vault.trim() : "";
      if (!vpAgentId || !vpVaultName) {
        console.error("Usage: theorex vault-promote --agent <id> --vault <name>");
        process.exit(1);
      }
      const { loadVaultRegistry, findVault } = await import("../vaults/registry");
      const { promoteToVault } = await import("../vaults/promote");
      const registryPath = config.vaultRegistryPath ?? "data/vaults.json";
      const vaults = await loadVaultRegistry(registryPath);
      const vault = findVault(vpVaultName, vaults);
      if (!vault) {
        console.error(`Vault not found: ${vpVaultName}. Run: theorex vault-list`);
        process.exit(1);
      }
      console.log(`Promoting ${vpAgentId} → vault '${vpVaultName}'...`);
      const result = await promoteToVault(vpAgentId, vault, config);
      if (result.denied) {
        console.error(`Agent '${vpAgentId}' is not a member of vault '${vpVaultName}'.`);
        process.exit(1);
      }
      console.log(`  Promoted:  ${result.promoted} concepts, ${result.edgesPromoted} edges`);
      console.log(`  Skipped:   ${result.skipped} (below threshold)`);
      console.log(`  Filtered:  ${result.filtered} (domain filter)`);
      break;
    }

    // Phase 23: vault-query — show top concepts from a vault
    case "vault-query": {
      const { values: vqValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: {
          vault: { type: "string" },
          top: { type: "string" },
          merge: { type: "boolean" },
        },
        allowPositionals: false,
        strict: false,
      });
      const { loadVaultRegistry, findVault } = await import("../vaults/registry");
      const { queryVault, mergeVaults } = await import("../vaults/query");
      const registryPath = config.vaultRegistryPath ?? "data/vaults.json";
      const vaults = await loadVaultRegistry(registryPath);
      const topN = typeof vqValues.top === "string" ? parseInt(vqValues.top, 10) || 20 : 20;
      const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
      const COL_TIER = 8;
      const COL_FORM = 24;
      const COL_SCORE = 8;
      const COL_AGENT = 20;

      if (vqValues.merge) {
        // Merged view across all vaults
        console.log("Merged vault view\n");
        const merged = await mergeVaults(vaults, config, topN);
        if (merged.length === 0) { console.log("No concepts in any vault yet."); break; }
        const header = pad("tier", COL_TIER) + pad("concept", COL_FORM) + pad("score", COL_SCORE) + pad("vaults/agents", COL_AGENT);
        console.log(header);
        console.log("-".repeat(header.length));
        for (const c of merged) {
          console.log(pad(c.relevance_tier.slice(0, 7), COL_TIER) + pad(c.surface_form, COL_FORM) + pad(c.score.toFixed(3), COL_SCORE) + pad(`${c.vault_name} / ${c.agent_id}`, COL_AGENT));
        }
        break;
      }

      const vqVaultName = typeof vqValues.vault === "string" ? vqValues.vault.trim() : "";
      if (!vqVaultName) {
        console.error("Usage: theorex vault-query --vault <name> [--top N] | --merge");
        process.exit(1);
      }
      const vault = findVault(vqVaultName, vaults);
      if (!vault) {
        console.error(`Vault not found: ${vqVaultName}. Run: theorex vault-list`);
        process.exit(1);
      }
      const concepts = await queryVault(vault, config, topN);
      if (concepts.length === 0) {
        console.log(`Vault '${vqVaultName}' is empty. Run: theorex vault-promote --agent <id> --vault ${vqVaultName}`);
        break;
      }
      console.log(`Vault: ${vqVaultName} — top ${concepts.length} concepts\n`);
      const header = pad("tier", COL_TIER) + pad("concept", COL_FORM) + pad("score", COL_SCORE) + pad("agent", COL_AGENT);
      console.log(header);
      console.log("-".repeat(header.length));
      for (const c of concepts) {
        console.log(pad(c.relevance_tier.slice(0, 7), COL_TIER) + pad(c.surface_form, COL_FORM) + pad(c.score.toFixed(3), COL_SCORE) + pad(c.agent_id, COL_AGENT));
      }
      break;
    }

    // Phase 21: health — show latest health snapshots for all agents
    case "health": {
      const { readAllHealthSnapshots: readAllSnaps } = await import("../health/store");
      const snaps = await readAllSnaps(config.healthDir ?? "data/health");

      if (snaps.length === 0) {
        console.log("No health data yet. Run: theorex health-check");
        break;
      }

      snaps.sort((a, b) => a.agent_id.localeCompare(b.agent_id));

      const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
      const COL_AGENT = 20;
      const COL_STATUS = 12;
      const COL_PING = 10;
      const COL_RATE = 10;
      const COL_LATENCY = 12;
      const COL_TRACES = 8;
      const COL_LAST = 20;

      console.log("Agent Health\n");
      const header =
        pad("agent", COL_AGENT) +
        pad("status", COL_STATUS) +
        pad("ping_ms", COL_PING) +
        pad("success%", COL_RATE) +
        pad("avg_lat_ms", COL_LATENCY) +
        pad("traces", COL_TRACES) +
        pad("last_trace", COL_LAST);
      console.log(header);
      console.log("-".repeat(header.length));

      for (const s of snaps) {
        const statusLabel =
          s.status === "healthy" ? "healthy" :
          s.status === "degraded" ? "degraded [!]" :
          `UNREACHABLE (${s.consecutive_failures}x)`;
        const row =
          pad(s.agent_id, COL_AGENT) +
          pad(statusLabel, COL_STATUS) +
          pad(s.ping_ms !== null ? String(s.ping_ms) : "-", COL_PING) +
          pad(s.success_rate_7d > 0 || s.trace_count_7d > 0 ? `${(s.success_rate_7d * 100).toFixed(0)}%` : "-", COL_RATE) +
          pad(s.avg_latency_ms !== null ? s.avg_latency_ms.toFixed(0) : "-", COL_LATENCY) +
          pad(String(s.trace_count_7d), COL_TRACES) +
          pad(s.last_trace_at ? s.last_trace_at.slice(0, 19).replace("T", " ") : "-", COL_LAST);
        console.log(row);
      }

      const checked = snaps[0]?.timestamp?.slice(0, 19).replace("T", " ") ?? "-";
      console.log(`\nChecked: ${checked}`);
      break;
    }

    // Phase 21: health-check — probe all (or one) agents and write snapshots
    case "health-check": {
      const { values: hcValues } = parseArgs({
        args: Bun.argv.slice(3),
        options: { agent: { type: "string" } },
        allowPositionals: false,
        strict: false,
      });
      const { checkAgent: hcCheckAgent, checkAllAgents: hcCheckAll, AGENT_ENDPOINTS } = await import("../health/monitor");
      const { DEFAULT_AGENT_PROFILES } = await import("../roles/registry");

      const hcConfig = {
        healthDir: config.healthDir ?? "data/health",
        healthProbeTimeoutMs: config.healthProbeTimeoutMs ?? 3000,
        healthWindowDays: config.healthWindowDays ?? 7,
      };

      const targetId = typeof hcValues.agent === "string" ? hcValues.agent.trim() : null;
      const allIds = DEFAULT_AGENT_PROFILES.map((p) => p.agent_id);

      if (targetId) {
        console.log(`Checking agent: ${targetId}...`);
        const snap = await hcCheckAgent(targetId, hcConfig);
        const endpointNote = snap.endpoint ? ` (${snap.endpoint})` : " (trace-only)";
        console.log(`  Status:  ${snap.status}${endpointNote}`);
        console.log(`  Ping:    ${snap.ping_ms !== null ? `${snap.ping_ms}ms` : "n/a"}`);
        console.log(`  Success: ${snap.trace_count_7d > 0 ? `${(snap.success_rate_7d * 100).toFixed(0)}%` : "no data"} (${snap.trace_count_7d} traces/7d)`);
        console.log(`  Latency: ${snap.avg_latency_ms !== null ? `${snap.avg_latency_ms.toFixed(0)}ms` : "n/a"}`);
        if (snap.consecutive_failures > 0) {
          console.log(`  Consecutive failures: ${snap.consecutive_failures}`);
        }
      } else {
        console.log(`Checking ${allIds.length} agents...`);
        const snaps = await hcCheckAll(allIds, hcConfig);
        for (const s of snaps) {
          const indicator = s.status === "healthy" ? "✓" : s.status === "degraded" ? "~" : "✗";
          const endpointNote = AGENT_ENDPOINTS[s.agent_id] ? ` [${AGENT_ENDPOINTS[s.agent_id]}]` : "";
          console.log(`  ${indicator} ${s.agent_id.padEnd(20)} ${s.status}${endpointNote}`);
        }
        console.log(`\nSnapshots saved to: ${hcConfig.healthDir}`);
        console.log("View with: theorex health");
      }
      break;
    }

    default:
      console.error(`Unknown command: ${subcommand ?? "(none)"}`);
      console.error("Usage: theorex <scan|scan-agent --agent <id>|status|ref <keyword>|prune|prune-agent --agent <id>|search <query>|build-index|graduate|flash-write|flush|flash-inject|moment <story>|drift|audit|write --agent <id> <text>|promote --agent <id>|query-shared|ingest --agent <id> <files>|ingest-code --agent <id> <dir>|ingest-image <path>|ingest-video <path>|synthesize --agent <id> <text>|session-summary --agent <id>|boot-inject|context-monitor --session <id>|outcome --agent <id> --decision \"text\" --result \"text\"|evolve-review [--agent <id>]|evolve-status [--agent <id>]|trace-stats|route <query>|matrix-build|matrix-show|energy-check|policy-snapshot|boot-aware [--model <name>] [--agent <id>]|dispatch \"<task>\" [--agent <id>] [--context <pct>]|roles|role-route <query>|mcp-start [--port <n>] [--agent <id>]|a2a-tasks [--agent <id>]|trace-review [--agent <id>]|notify-agents --reason \"text\" [--agents id1,id2]|set-user-pref --agent <id> [--name \"Name\"] [--tone formal|casual|balanced] [--length brief|detailed|adaptive] [--note \"text\"] [--contact \"text\"]|show-user-pref --agent <id>|health|health-check [--agent <id>]|vault-list|vault-create --name <name> [--members id1,id2] [--readonly id3] [--domains d1,d2]|vault-promote --agent <id> --vault <name>|vault-query --vault <name> [--top N] | --merge>");
      process.exit(1);
  }
}
