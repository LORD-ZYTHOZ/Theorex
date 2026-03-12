// code/ingest.ts — Walk a directory, parse source files, write code symbols to axon.
// Phase 7: Code Reading
//
// Strategy:
//   1. Recursively find TS/JS files under the target directory.
//   2. Parse each file → symbols (nodes) + calls (edges).
//   3. Create ConceptEvents directly for each symbol (bypass NLP pipeline).
//   4. mergeNode per symbol, mergeEdge per call where both ends are known.

import { readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { parseFile } from "./parse";
import { AxonStore } from "../axon/store";
import { agentAxonPath, sourceWeightForAgent } from "../family/paths";
import type { ConceptEvent } from "../types";
import type { Config } from "../config";

// 53-bit mask — same as identify.ts — keeps IDs within MAX_SAFE_INTEGER.
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/** Derive a stable concept_id from a symbol name using the same hash as identify.ts. */
function hashName(name: string): number {
  return Number(Bun.hash.wyhash(name.toLowerCase().trim(), 0n) & MAX_SAFE_BIGINT);
}

/** Build a synthetic ConceptEvent for a code symbol (bypasses NLP pipeline). */
function codeEvent(name: string, sourceWeight: number, timestamp: string): ConceptEvent {
  return {
    concept_id: hashName(name),
    surface_form: name,
    importance_score: 1.0,
    frequency_count: 1,
    composite_score: sourceWeight,
    source_weight: sourceWeight,
    node_type: "code_function",
    timestamp,
  };
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", "coverage"]);

/** Recursively collect all code files under a directory. */
async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(current, entry.name));
        }
      } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) {
        results.push(join(current, entry.name));
      }
    }
  }

  await walk(dir);
  return results;
}

export interface CodeIngestResult {
  readonly agentId: string;
  readonly axonPath: string;
  readonly filesProcessed: number;
  readonly symbolsAdded: number;
  readonly edgesAdded: number;
}

/**
 * Ingest a codebase directory into an agent's private axon.
 * Symbols → nodes (code_function type), calls → edges.
 */
export async function ingestCode(
  agentId: string,
  targetDir: string,
  config: Config,
  nowMs: number = Date.now(),
): Promise<CodeIngestResult> {
  const sourceWeight = sourceWeightForAgent(agentId);
  const timestamp = new Date(nowMs).toISOString();

  // Resolve target dir
  let resolvedDir = targetDir;
  try {
    const s = await stat(targetDir);
    if (!s.isDirectory()) {
      throw new Error(`Not a directory: ${targetDir}`);
    }
  } catch (e) {
    throw new Error(`Cannot access directory: ${targetDir} — ${e}`);
  }

  const files = await collectFiles(resolvedDir);
  console.log(`  [code] Found ${files.length} source file(s) in ${targetDir}`);

  // Load agent axon
  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  await mkdir(dirname(axonPath), { recursive: true });
  const store = await AxonStore.load(axonPath);

  const nodesBefore = store.graph.order;
  const edgesBefore = store.graph.size;

  // Pass 1: parse all files and collect symbol→id map (for edge resolution)
  const symbolIdMap = new Map<string, number>(); // name → concept_id
  const allCalls: Array<{ caller: string; callee: string }> = [];

  for (const filePath of files) {
    const ext = filePath.slice(filePath.lastIndexOf("."));
    const result = ext === ".py"
      ? await parsePython(filePath, resolvedDir)
      : ext === ".go"
      ? await parseGo(filePath, resolvedDir)
      : await parseFile(filePath, resolvedDir);

    for (const sym of result.symbols) {
      const event = codeEvent(sym.name, sourceWeight, timestamp);
      symbolIdMap.set(sym.name, event.concept_id);
      // Also index bare method name for call resolution (e.g. "AxonStore.mergeNode" → "mergeNode")
      const dotIdx = sym.name.lastIndexOf(".");
      if (dotIdx !== -1) {
        const shortName = sym.name.slice(dotIdx + 1);
        if (!symbolIdMap.has(shortName)) {
          symbolIdMap.set(shortName, event.concept_id);
        }
      }
      store.mergeNode(event, agentId, sym.kind);
    }

    for (const call of result.calls) {
      allCalls.push({ caller: call.callerName, callee: call.calleeName });
    }
  }

  // Pass 2: merge edges where both endpoints are known symbols
  for (const { caller, callee } of allCalls) {
    const callerId = symbolIdMap.get(caller);
    const calleeId = symbolIdMap.get(callee);
    if (callerId !== undefined && calleeId !== undefined && callerId !== calleeId) {
      try {
        store.mergeEdge(callerId, calleeId, timestamp);
      } catch {
        // Nodes might not exist if symbol was filtered — safe to skip
      }
    }
  }

  await store.save(axonPath);

  return {
    agentId,
    axonPath,
    filesProcessed: files.length,
    symbolsAdded: store.graph.order - nodesBefore,
    edgesAdded: store.graph.size - edgesBefore,
  };
}
