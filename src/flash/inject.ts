// flash/inject.ts — Inject ACTIVE-tier context into Claude's conversation at SessionStart.
// HKS-03: reads axon ACTIVE nodes and recent short-term entries; returns formatted string.
// Extended in 05-03 (MOM-04): includes relevant moment nodes (concept_id overlap with ACTIVE-tier).
// Extended in Phase 14: prepends temporal context (gap detection, time of day, location).
// Cold start (all lobes empty): returns empty string — never throws.

import { AxonStore } from "../axon/store";
import { readShortTermFiles, rotateStm } from "../short-term/store";
import type { ShortTermEntry } from "../short-term/store";
import { readMoments } from "../moments/store";
import type { MomentNode } from "../moments/store";
import { buildTemporalContext, formatTemporalContext } from "../temporal/context";
import { loadConfig, type Config } from "../config";
import { loadProfessionPack, formatPackContext } from "../profession/loader";
import { loadPersonalLayer, formatPersonalContext } from "../profession/personal";
import { writeToAgent } from "../family/write";
import { readActiveLessons } from "../evolve/lesson";
import { buildSessionBrief, formatSessionBrief } from "../evolve/session-brief";

const MAX_ACTIVE_NODES = 10;
const MAX_RECENT_ENTRIES = 5;
const MAX_RELEVANT_MOMENTS = 5;

export async function injectContext(
  sessionId: string,
  options?: {
    loadAxon?: () => Promise<AxonStore>;
    readShortTermFiles?: () => Promise<ShortTermEntry[]>;
    readMoments?: () => Promise<MomentNode[]>;
    loadConfig?: () => Promise<Config | null>;
  }
): Promise<string> {
  const _loadAxon = options?.loadAxon ?? (async () => {
    const cfg = await loadConfig().catch(() => null);
    return AxonStore.load(cfg?.axonPath ?? "data/axon.json");
  });
  const _readShortTermFiles = options?.readShortTermFiles ?? (async () => {
    await rotateStm().catch(() => {}); // prune stale entries before reading
    return readShortTermFiles();
  });
  const _readMoments = options?.readMoments ?? readMoments;
  const _loadConfig = options?.loadConfig ?? (() => loadConfig().catch(() => null));

  const lines: string[] = [];

  // Load config once — shared by all context blocks
  const config = await _loadConfig();

  // 0. Temporal context — Phase 14
  try {
    if (config) {
      const temporal = await buildTemporalContext(config);
      const temporalText = formatTemporalContext(temporal);
      lines.push(temporalText);

      // Write gap observation to agent axon on significant gaps — the brain remembers time.
      // This lets temporal patterns accumulate: "user comes back after sleep", "long absence", etc.
      if (temporal.reorientation_needed && config.temporalAgentId) {
        const gapObservation = `Session #${temporal.session_count} started after ${temporal.gap_human} gap [${temporal.gap_type}]. ${temporal.date} ${temporal.time_of_day} (${temporal.work_context}).`;
        writeToAgent(config.temporalAgentId, gapObservation, config, Date.now(), "change").catch(() => {});
      }
    }
  } catch {
    // Temporal failure is non-fatal — session continues without time context
  }

  // 0b. Profession pack boot context — Phase 12 (business mode only)
  try {
    if (config?.deploymentMode === "business" && config.professionPack) {
      const pack = await loadProfessionPack(
        config.professionPack,
        config.professionPacksDir || undefined,
      );
      if (pack) {
        lines.push(formatPackContext(pack));
      }
    }
  } catch {
    // Pack load failure is non-fatal
  }

  // 0c. Personal layer — Phase 12 extension (business mode only)
  try {
    if (config?.deploymentMode === "business" && config.temporalAgentId) {
      const layer = await loadPersonalLayer(
        config.temporalAgentId,
        config.agentAxonDir || undefined,
      );
      if (layer) {
        lines.push(formatPersonalContext(layer));
      }
    }
  } catch {
    // Personal layer load failure is non-fatal
  }

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

  // 4. Session brief — active lessons from the learning loop (Stage 6C)
  try {
    const domain = config?.deploymentMode === "business" ? "trading" : "coding";
    const lessons = await readActiveLessons(undefined, { domain });
    if (lessons.length > 0) {
      const brief = buildSessionBrief(lessons, { domain, maxLessons: 5 });
      const briefText = formatSessionBrief(brief);
      if (brief.lessons.length > 0) {
        lines.push("");
        lines.push(briefText);
      }
    }
  } catch {
    // Lesson load failure is non-fatal
  }

  return lines.join("\n");
}
