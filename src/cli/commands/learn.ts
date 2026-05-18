// commands/learn.ts — CLI for Nova's learning system.
// Usage:
//   theorex learn --agent secretarius --event escalation --context "m1 unreachable" --pattern "bridge0 is more reliable than Tailscale" --outcome positive
//   theorex learn --query --agent meridian --context "RISK_OFF"
//   theorex learn --summary

import { write_learning, get_learnings, get_relevant_learnings, get_learning_summary, ensure_learnings_table } from "../../axon/learnings";
import type { EventType, Outcome } from "../axon/learnings";

interface LearnOptions {
  agent?: string;
  event?: string;
  context?: string;
  pattern?: string;
  outcome?: string;
  confidence?: number;
  meta?: string;
  query?: boolean;
  summary?: boolean;
  list?: boolean;
}

export async function runLearnCLI(args: LearnOptions): Promise<void> {
  // Ensure table exists
  await ensure_learnings_table();

  if (args.summary) {
    const summary = await get_learning_summary();
    console.log("\n=== Nova Learning Summary ===\n");
    for (const [agent, stats] of Object.entries(summary)) {
      console.log(`${agent}:`);
      console.log(`  Total learnings: ${stats.total}`);
      console.log(`  Positive: ${stats.positive} | Negative: ${stats.negative} | Neutral: ${stats.neutral}`);
      console.log(`  Avg confidence: ${(stats.avg_confidence * 100).toFixed(1)}%`);
      console.log();
    }
    return;
  }

  if (args.query) {
    const agent = args.agent ?? "nova";
    const kw = args.context ?? "";
    const learnings = await get_relevant_learnings(agent, kw, 20);

    if (learnings.length === 0) {
      console.log(`No learnings found for ${agent}${kw ? " matching: " + kw : ""}`);
      return;
    }

    console.log(`\n=== Learnings: ${agent}${kw ? " | context: " + kw : ""} ===\n`);
    for (const l of learnings) {
      const confidence_pct = (l.confidence * 100).toFixed(0);
      const date = l.created_at ? new Date(l.created_at).toLocaleDateString() : "unknown";
      console.log(`[${date}] ${l.outcome.toUpperCase()} (${confidence_pct}) — ${l.event_type}`);
      console.log(`  Context: ${l.context}`);
      console.log(`  Pattern: ${l.pattern}`);
      console.log();
    }
    return;
  }

  // Write a new learning
  if (!args.agent || !args.event || !args.context || !args.pattern || !args.outcome) {
    console.error("Missing required flags: --agent --event --context --pattern --outcome");
    console.error("Usage: theorex learn --agent <id> --event <type> --context \"<text>\" --pattern \"<text>\" --outcome <positive|negative|neutral>");
    process.exit(1);
  }

  let meta: Record<string, unknown> = {};
  if (args.meta) {
    try {
      meta = JSON.parse(args.meta);
    } catch {
      console.error("--meta must be valid JSON");
      process.exit(1);
    }
  }

  const id = await write_learning({
    agent: args.agent,
    event_type: args.event as EventType,
    context: args.context,
    pattern: args.pattern,
    outcome: args.outcome as Outcome,
    confidence: args.confidence ?? 0.5,
    meta,
  });

  console.log(`✓ Learning recorded [${id}] — ${args.agent}/${args.event}: ${args.pattern.substring(0, 60)}...`);
}