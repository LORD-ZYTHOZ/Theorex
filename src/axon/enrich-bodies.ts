// src/axon/enrich-bodies.ts — Enrich concepts with null body from their metadata.
// After scan, run enrich_concept_bodies() to populate null body fields
// with 1-2 sentence summaries derived from stored metadata fields.

import { getDb } from "./pg-connection";

/** Generate a 1-2 sentence summary from a concept's metadata fields. */
export function summarizeFromMeta(meta: Record<string, unknown>): string {
  const parts: string[] = [];

  // Surface / label identity
  const label = meta.surface_form as string | undefined;
  const memoryType = meta.memory_type as string | undefined;
  if (label && memoryType && memoryType !== "fact") {
    parts.push(`${label} is a ${memoryType}-type concept.`);
  } else if (label) {
    parts.push(`${label} is a frequently accessed concept.`);
  }

  // Frequency signal
  const freq = typeof meta.frequency_count === "number" ? (meta.frequency_count as number) : 0;
  if (freq > 10) {
    parts.push(`Seen ${freq} times — high frequency.`);
  } else if (freq > 3) {
    parts.push(`Seen ${freq} times — moderate frequency.`);
  }

  // Importance weight
  const weight = typeof meta.importance_weight === "number" ? (meta.importance_weight as number) : 0;
  if (weight >= 0.8) {
    parts.push("High importance weight.");
  } else if (weight >= 0.5) {
    parts.push("Moderate importance weight.");
  }

  // Observation type
  const obsType = meta.observation_type as string | undefined;
  if (obsType && obsType !== "generic") {
    parts.push(`Observation type: ${obsType}.`);
  }

  // Node type
  const nodeType = meta.node_type as string | undefined;
  if (nodeType && nodeType !== "concept") {
    parts.push(`Node type: ${nodeType}.`);
  }

  if (parts.length === 0) {
    return label ? `General concept: ${label}.` : "Concept record with limited metadata.";
  }

  // Cap at 2 sentences
  const first = parts.slice(0, 2).join(" ");
  return first.endsWith(".") ? first : first + ".";
}

/**
 * Scan concepts table for rows with null body, generate summaries from meta,
 * and write them back. Returns count of enriched rows.
 * Idempotent — calling multiple times does not over-write existing body values.
 */
export async function enrich_concept_bodies(agentId?: string, limit = 200): Promise<number> {
  const sql = getDb();

  // Find concepts with null body
  const nullBodyRows = agentId
    ? await sql`
      SELECT id, label, meta, agent_id
      FROM concepts
      WHERE body IS NULL
        AND agent_id = ${agentId}
      LIMIT ${limit}
    `
    : await sql`
      SELECT id, label, meta, agent_id
      FROM concepts
      WHERE body IS NULL
      LIMIT ${limit}
    `;

  if (nullBodyRows.length === 0) return 0;

  let enriched = 0;
  for (const row of nullBodyRows) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    // Include label in meta so summarizeFromMeta has full context
    const enrichedMeta = { ...meta, surface_form: row.label as string };
    const body = summarizeFromMeta(enrichedMeta);

    await sql`UPDATE concepts SET body = ${body} WHERE id = ${row.id} AND body IS NULL`;
    enriched++;
  }

  return enriched;
}

/**
 * Enrich a single concept by ID.
 * Returns the new body text, or null if concept not found or already has body.
 */
export async function enrich_single_concept(conceptId: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, label, meta, body
    FROM concepts
    WHERE id = ${conceptId}
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const row = rows[0];

  if ((row.body as string | null) !== null) return null; // already enriched

  const meta = { ...((row.meta ?? {}) as Record<string, unknown>), surface_form: row.label as string };
  const body = summarizeFromMeta(meta);

  await sql`UPDATE concepts SET body = ${body} WHERE id = ${row.id}`;
  return body;
}