// src/moments/capture.ts — Capture CLI helper for Moment Nodes (Phase 5).
// Provides three exported functions used by the `theorex moment` subcommand.
//
// INVARIANTS:
//   - captureCodeRefs: try/catch wraps everything — returns [] on any failure
//   - extractConceptIds: pure function — no I/O, filters processText output by knownIds
//   - runMoment: validates story not empty, writes atomic moment file

import { createMoment } from "./store";
import type { MomentNode, CodeRef } from "./store";
import { processText } from "../compose";
import { AxonStore } from "../axon/store";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// captureCodeRefs
// ---------------------------------------------------------------------------

/**
 * Capture changed files from `git diff --name-only HEAD`.
 * Returns [] on ANY failure (non-git dir, empty diff, git not installed).
 *
 * An optional override fn can be injected for testing purposes.
 */
export async function captureCodeRefs(
  gitFn?: () => Promise<string>
): Promise<CodeRef[]> {
  try {
    let stdout: string;
    if (gitFn) {
      stdout = await gitFn();
    } else {
      const result = await Bun.$`git diff --name-only HEAD`.quiet();
      stdout = result.stdout.toString();
    }
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((file) => ({ file, line: 1 }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// extractConceptIds
// ---------------------------------------------------------------------------

/**
 * Extract concept IDs from story text, filtered to only those present in knownIds.
 * Uses processText from the significance pipeline.
 * Returns [] if story is empty or processText returns nothing.
 */
export function extractConceptIds(
  story: string,
  knownIds: Set<number>
): number[] {
  if (!story.trim()) return [];

  const events = processText(story, 1.0, "moment", new Date().toISOString());
  if (events.length === 0) return [];

  const seen = new Set<number>();
  const result: number[] = [];
  for (const event of events) {
    const id = event.concept_id;
    if (knownIds.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// runMoment
// ---------------------------------------------------------------------------

/**
 * Create a MomentNode from a story string and write it atomically to disk.
 * - Loads AxonStore to build known concept IDs
 * - Extracts concept_ids from story text (filtered by known IDs)
 * - Captures code refs from git diff (merged with explicit refs)
 * - Writes moment JSON to momentsDir
 * - Logs `Moment saved: {uuid}` to console
 *
 * @param story        - Human-readable description (must not be empty)
 * @param axonPath     - Path to axon.json
 * @param config       - Config (provides momentsDir default)
 * @param explicitRefs - Explicit CodeRefs from --ref flags (optional)
 * @param momentsDir   - Override for moments directory (optional, defaults to config.momentsDir)
 */
export async function runMoment(
  story: string,
  axonPath: string,
  config: Config,
  explicitRefs: readonly CodeRef[] = [],
  momentsDir?: string
): Promise<void> {
  if (!story.trim()) {
    throw new Error("story must not be empty");
  }

  const targetDir = momentsDir ?? config.momentsDir;

  // Load axon to gather known concept IDs
  const axon = await AxonStore.load(axonPath);
  const knownIds = new Set<number>(
    axon.graph.nodes().map((key) => axon.graph.getNodeAttributes(key).concept_id)
  );

  // Extract concept IDs from story text, filtered by known axon concepts
  const concept_ids = extractConceptIds(story, knownIds);

  // Capture git code refs and merge with explicit refs
  const gitRefs = await captureCodeRefs();
  const allRefs = mergeCodeRefs([...explicitRefs, ...gitRefs]);

  // Build and write the moment node
  const moment: MomentNode = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    story,
    code_refs: allRefs,
    concept_ids,
  };

  await createMoment(moment, targetDir);
  console.log(`Moment saved: ${moment.id}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dedup code refs by file:line — first occurrence wins.
 */
function mergeCodeRefs(refs: readonly CodeRef[]): CodeRef[] {
  const seen = new Set<string>();
  const result: CodeRef[] = [];
  for (const ref of refs) {
    const key = `${ref.file}:${ref.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ file: ref.file, line: ref.line });
    }
  }
  return result;
}
