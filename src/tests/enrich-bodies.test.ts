/**
 * Tests for enrich-bodies.ts — summarizeFromMeta and enrich_concept_bodies.
 * Requires: live Postgres (10.10.0.2:5432, db=theorex)
 */

import { test, expect, describe } from "bun:test";
import { summarizeFromMeta } from "../axon/enrich-bodies";

const SKIP = true; // requires live Postgres — set SKIP=false to run

describe("summarizeFromMeta", () => {
  test("generates summary from meta fields", () => {
    const body = summarizeFromMeta({
      surface_form: "gold_trade",
      memory_type: "episode",
      frequency_count: 25,
      importance_weight: 0.92,
      observation_type: "trade",
      node_type: "concept",
    });
    expect(body).toContain("gold_trade");
    expect(body).toContain("episode");
    expect(body).toContain("25");
    expect(body.length).toBeLessThan(200);
  });

  test("handles empty meta gracefully", () => {
    const body = summarizeFromMeta({});
    expect(body).toBeTruthy();
    expect(body.length).toBeLessThan(100);
  });

  test("caps at 2 sentences", () => {
    const body = summarizeFromMeta({
      surface_form: "x",
      memory_type: "fact",
      frequency_count: 1,
      importance_weight: 0.1,
      observation_type: "",
      node_type: "",
    });
    // Should produce 1-2 sentences, not 3+
    const sentences = body.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(2);
  });
});

// Integration tests skipped unless live Postgres is available
describe("enrich_concept_bodies integration", () => {
  test.skipIf(SKIP)("enriches null body concepts", async () => {
    const { enrich_concept_bodies } = await import("../axon/enrich-bodies");
    // Insert a test concept with null body
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const testLabel = `test-enrich-${Date.now()}`;
    await sql`
      INSERT INTO concepts (label, body, memory_type, agent_id, meta)
      VALUES (${testLabel}, NULL, 'fact'::memory_type, 'test', '{"surface_form":"${testLabel}","frequency_count":5}'::jsonb)
    `;
    const enriched = await enrich_concept_bodies("test", 50);
    expect(enriched).toBeGreaterThanOrEqual(1);
    // Verify body is now non-null
    const rows = await sql`SELECT body FROM concepts WHERE label = ${testLabel}`;
    expect(rows[0].body).toBeTruthy();
    // Cleanup
    await sql`DELETE FROM concepts WHERE label = ${testLabel}`;
  });

  test.skipIf(SKIP)("idempotent — does not overwrite existing bodies", async () => {
    const { enrich_concept_bodies } = await import("../axon/enrich-bodies");
    const { getDb } = await import("../axon/pg-connection");
    const sql = getDb();
    const testLabel = `test-idempotent-${Date.now()}`;
    await sql`
      INSERT INTO concepts (label, body, memory_type, agent_id, meta)
      VALUES (${testLabel}, 'Already has body text', 'fact'::memory_type, 'test', '{}'::jsonb)
    `;
    const enriched = await enrich_concept_bodies("test", 50);
    expect(enriched).toBe(0); // none with null body
    // Cleanup
    await sql`DELETE FROM concepts WHERE label = ${testLabel}`;
  });
});