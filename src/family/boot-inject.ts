// family/boot-inject.ts — Inject shared concept context into agent boot prompts.
// Phase 6 of Theorex: promotes hot concepts from shared graph into session prompts.

import type { Config } from "../cli/index.js";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { AxonStore } from "../axon/store.js";
import { resolvedSharedAxonPath } from "./paths.js";
import { pgNotify, PostgresStore } from "../axon/postgres-store.js";
import { isPostgresEnabled } from "../axon/postgres-store.js";
import { getDb } from "../axon/pg-connection.js";

export const DEFAULT_OUTPUT_PATH = resolve(
  process.env.THEOREX_SHARED_CONTEXT ??
    "/Users/eoh/.openclaw/workspace/theorex/SHARED_CONTEXT.md"
);

export interface BootEntry {
  conceptId: string;
  surface_form: string;
  score: number;
  agent: string;
  relevance_tier: string;
  updatedAt: string;
  body: string | null;
}

export interface BootInjectResult {
  outputPath: string;
  activeConcepts: number;
  totalConcepts: number;
  agentCount: number;
  duration_ms: number;
  source: "postgres" | "file";
}

// ---------------------------------------------------------------------------
// Postgres path (THEOREX_STORAGE=postgres)
// ---------------------------------------------------------------------------

async function collectFromPostgres(top: number | undefined): Promise<{
  entries: BootEntry[];
  totalConcepts: number;
}> {
  // Count total concepts in Postgres
  const totalResult = await getDb() `SELECT COUNT(*)::int as cnt FROM concepts`;
  const totalConcepts = totalResult[0]?.cnt ?? 0;

  // Query all ACTIVE/MILD tier concepts with their meta fields
  const rows = await getDb()`
    SELECT
      id,
      label AS surface_form,
      agent_id,
      memory_type,
      body,
      created_at,
      updated_at,
      COALESCE(
        (meta->>'importance_weight')::numeric,
        (meta->>'frequency_count')::numeric,
        0
      ) AS score,
      COALESCE(meta->>'relevance_tier', 'ACTIVE') AS relevance_tier
    FROM concepts
    WHERE meta->>'relevance_tier' IN ('ACTIVE', 'MILD')
    ORDER BY score DESC
    LIMIT 5000
  `;

  const entries: BootEntry[] = rows.map((row: Record<string, unknown>) => ({
    conceptId: row.id as string,
    surface_form: row.surface_form as string,
    score: Number(row.score),
    agent: row.agent_id as string,
    relevance_tier: row.relevance_tier as string,
    updatedAt: (row.updated_at as string) ?? "",
    body: (row.body as string | null) ?? null,
  }));

  return { entries, totalConcepts };
}

// ---------------------------------------------------------------------------
// File path (shared-axon.json)
// ---------------------------------------------------------------------------

async function collectFromFile(
  sharedPath: string,
  coldStorePath: string | undefined,
  top: number | undefined,
): Promise<{
  entries: BootEntry[];
  totalConcepts: number;
}> {
  const store = await AxonStore.load(sharedPath);
  if (coldStorePath) store.openCold(coldStorePath);

  const totalConcepts = store.graph.order;
  const sharedGraph = store.graph;
  const entries: BootEntry[] = [];

  for (const conceptId of sharedGraph.nodes()) {
    const attrs = sharedGraph.getNodeAttributes(conceptId) ?? {};
    const tier = attrs.relevance_tier ?? attrs.tier ?? "ACTIVE";
    if (tier !== "ACTIVE" && tier !== "MILD") continue;

    entries.push({
      conceptId,
      surface_form: attrs.surface_form ?? conceptId,
      score: attrs.importance_weight ?? attrs.frequency_count ?? 0,
      agent: attrs.agent_id ?? attrs.agent ?? "unknown",
      relevance_tier: tier,
      updatedAt: attrs.last_seen ?? attrs.updatedAt ?? "",
      body: (attrs.body ?? null) as string | null,
    });
  }

  entries.sort((a, b) => b.score - a.score);
  return { entries, totalConcepts };
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export async function generateBootContext(
  config: Config,
  outputPath: string = DEFAULT_OUTPUT_PATH,
  top: number | undefined,
  nowMs: number = Date.now(),
  depth: "summary" | "full" = "summary",
): Promise<BootInjectResult> {
  // Choose data source
  const source: "postgres" | "file" = isPostgresEnabled() ? "postgres" : "file";
  let entries: BootEntry[];
  let totalConcepts: number;

  if (source === "postgres") {
    ({ entries, totalConcepts } = await collectFromPostgres(top));
  } else {
    const sharedPath = resolvedSharedAxonPath(config.sharedAxonPath);
    ({ entries, totalConcepts } = await collectFromFile(
      sharedPath,
      config.coldStorePath,
      top,
    ));
  }

  // Group by agent
  const activeByAgent = new Map<string, BootEntry[]>();
  for (const entry of entries) {
    if (!activeByAgent.has(entry.agent)) {
      activeByAgent.set(entry.agent, []);
    }
    activeByAgent.get(entry.agent)!.push(entry);
  }

  const PER_AGENT_CAP = top != null && activeByAgent.size > 0
    ? Math.ceil(top / activeByAgent.size)
    : Infinity;

  // Build output lines
  const lines: string[] = [
    "# Theorex Shared Context — Fleet Brain",
    "",
    `Generated: ${new Date(nowMs).toISOString()}`,
    `Total concepts: ${totalConcepts} | Active: ${entries.length} | Agents: ${activeByAgent.size}`,
    `Top-N per agent: ${top ?? "all"} | Depth: ${depth} | Source: ${source}`,
    "",
    "## Active Concepts by Agent",
    "",
  ];

  if (activeByAgent.size === 0) {
    lines.push("No active shared concepts.");
  }

  for (const [agent, agentEntries] of activeByAgent.entries()) {
    const sorted = [...agentEntries].sort((a, b) => b.score - a.score);
    const capped = sorted.slice(0, PER_AGENT_CAP);
    lines.push(`## ${agent} (${capped.length} concepts)`);

    // Priority sections: identity, wins, losses (high signal for boot)
    const wins = capped.filter((e) =>
      e.surface_form.toLowerCase().includes("win") ||
      e.surface_form.toLowerCase().includes("gain") ||
      e.surface_form.toLowerCase().includes("profit")
    );
    const losses = capped.filter((e) =>
      e.surface_form.toLowerCase().includes("loss") ||
      e.surface_form.toLowerCase().includes("drawdown") ||
      e.surface_form.toLowerCase().includes("max_dd")
    );
    const identity = capped.filter((e) =>
      e.surface_form.toLowerCase().includes("identity") ||
      e.surface_form.toLowerCase().includes("role") ||
      e.surface_form.toLowerCase().includes("who")
    );

    if (wins.length) lines.push(`### Wins: ${wins.map((e) => e.surface_form).join(", ")}`);
    if (losses.length) lines.push(`### Losses: ${losses.map((e) => e.surface_form).join(", ")}`);
    if (identity.length) lines.push(`### Identity: ${identity.map((e) => e.surface_form).join(", ")}`);

    lines.push("");
    lines.push("### All Concepts:");
    for (const entry of capped) {
      const age = entry.updatedAt
        ? `${Math.round((nowMs - new Date(entry.updatedAt).getTime()) / 86400000)}d ago`
        : "unknown";
      const body = depth === "full" && entry.body
        ? `\n  > ${entry.body.slice(0, 200)}${entry.body.length > 200 ? "…" : ""}`
        : "";
      lines.push(
        `- **${entry.surface_form}** \`${entry.conceptId}\` | score: ${entry.score.toFixed(3)} | ${age} | tier: ${entry.relevance_tier}${body}`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Generated by Theorex boot-inject at ${new Date(nowMs).toISOString()}_`);

  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, lines.join("\n"), "utf-8");

  return {
    outputPath,
    activeConcepts: entries.length,
    totalConcepts,
    agentCount: activeByAgent.size,
    duration_ms: Date.now() - nowMs,
    source,
  };
}

export async function runBootInject(
  config: Config,
  outputPath?: string,
  top?: number,
  depth: "summary" | "full" = "summary",
): Promise<void> {
  const result = await generateBootContext(config, outputPath, top, Date.now(), depth);
  const src = result.source === "postgres" ? "Postgres" : "shared-axon.json";
  console.log(
    `[boot-inject] ${src}: ${result.activeConcepts} active concepts → ${result.outputPath} (depth: ${depth})`
  );
  pgNotify("boot_inject_complete", {
    concepts: result.activeConcepts,
    agent_count: result.agentCount,
    output_path: result.outputPath,
    duration_ms: result.duration_ms,
    depth,
    source: result.source,
    fired_at: new Date().toISOString(),
  }).catch(() => {/* best-effort */});
}