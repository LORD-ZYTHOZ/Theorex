// flash/inject.ts — Inject ACTIVE-tier context into Claude's conversation at SessionStart.
// HKS-03: reads axon ACTIVE nodes and recent short-term entries; returns formatted string.
// Extended in 05-03 (MOM-04): includes relevant moment nodes (concept_id overlap with ACTIVE-tier).
// Cold start (all lobes empty): returns empty string — never throws.

import { AxonStore } from "../axon/store";
import { readShortTermFiles } from "../short-term/store";
import type { ShortTermEntry } from "../short-term/store";
import { readMoments } from "../moments/store";
import type { MomentNode } from "../moments/store";

const AXON_PATH = "data/axon.json";
const MAX_ACTIVE_NODES = 10;
const MAX_RECENT_ENTRIES = 5;
const MAX_RELEVANT_MOMENTS = 5;

export async function injectContext(
  sessionId: string,
  options?: {
    loadAxon?: () => Promise<AxonStore>;
    readShortTermFiles?: () => Promise<ShortTermEntry[]>;
    readMoments?: () => Promise<MomentNode[]>;
  }
): Promise<string> {
  const _loadAxon = options?.loadAxon ?? (() => AxonStore.load(AXON_PATH));
  const _readShortTermFiles = options?.readShortTermFiles ?? readShortTermFiles;
  const _readMoments = options?.readMoments ?? readMoments;

  const lines: string[] = [];

  // Hoist activeIds so the moments block can access it (set in block 1)
  let activeIds = new Set<number>();

  // 1. ACTIVE-tier axon nodes
  try {
    const axon = await _loadAxon();
    const activeNodes = axon.graph
      .nodes()
      .map((key) => axon.graph.getNodeAttributes(key))
      .filter((attrs) => attrs.relevance_tier === "ACTIVE");

    // Populate activeIds for moments block
    activeIds = new Set(activeNodes.map((n) => n.concept_id));

    if (activeNodes.length > 0) {
      lines.push("=== THEOREX ACTIVE CONTEXT ===");
      for (const node of activeNodes.slice(0, MAX_ACTIVE_NODES)) {
        lines.push(
          `${node.surface_form} [${node.relevance_tier}/${node.sentiment_tier}]`
        );
      }
    }
  } catch {
    // Cold start or missing/corrupt axon.json — no output, never throw
  }

  // 2. Recent short-term entries (most recent N by timestamp)
  try {
    const entries = await _readShortTermFiles();
    if (entries.length > 0) {
      const recent = entries
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, MAX_RECENT_ENTRIES);
      if (lines.length === 0) {
        lines.push("=== THEOREX ACTIVE CONTEXT ===");
      }
      lines.push("--- Recent short-term ---");
      for (const entry of recent) {
        lines.push(
          `${entry.surface_form} (score: ${entry.composite_score.toFixed(2)})`
        );
      }
    }
  } catch {
    // No short-term data available — no output
  }

  // 3. Relevant moment nodes (concept_id overlap with ACTIVE-tier)
  try {
    const allMoments = await _readMoments();
    const relevant = allMoments.filter((m) =>
      m.concept_ids.some((id) => activeIds.has(id))
    );
    if (relevant.length > 0) {
      if (lines.length === 0) lines.push("=== THEOREX ACTIVE CONTEXT ===");
      lines.push("--- Relevant moments ---");
      for (const m of relevant.slice(0, MAX_RELEVANT_MOMENTS)) {
        lines.push(`${m.timestamp.slice(0, 10)}  ${m.story.slice(0, 200)}`);
      }
    }
  } catch {
    // No moments data — no output, never throw
  }

  return lines.join("\n");
}
