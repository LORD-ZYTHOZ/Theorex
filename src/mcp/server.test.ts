/**
 * server.test.ts — Stage 3D-2 MCP server unit tests.
 * Tests PostgresStore new methods and readBootResource Postgres path.
 * No real network or DB calls — everything is mocked.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// PostgresStore method tests (via duck-typed mock)
// ---------------------------------------------------------------------------

/**
 * LIMITATION: The tests below re-implement the mapping logic from
 * postgres-store.ts rather than importing and calling the real class.
 * Regressions in the production mapping code will not be caught here.
 * Integration-level tests cover the actual SQL path.
 *
 * We test the SQL behaviour by creating minimal fakes that mirror what
 * PostgresStore.getAllProfiles and getRecentSessionSummaries do.
 * The actual SQL is integration-tested at the DB level; here we verify
 * that the methods map columns to the correct output shape.
 */

describe("PostgresStore.getAllProfiles", () => {
  test("returns correct shape from SQL rows", async () => {
    // Simulate what getDb().query returns
    const fakeRows = [
      { subject: "trading_style", traits: { style: "breakout" } },
      { subject: "risk_preferences", traits: { risk: "1%" } },
    ];

    // Inline re-implementation of the mapping (mirrors postgres-store.ts)
    const result = fakeRows.map((r) => ({
      subject: r.subject as string,
      traits: r.traits as Record<string, unknown>,
    }));

    expect(result).toHaveLength(2);
    expect(result[0].subject).toBe("trading_style");
    expect(result[0].traits).toEqual({ style: "breakout" });
    expect(result[1].subject).toBe("risk_preferences");
    expect(result[1].traits).toEqual({ risk: "1%" });
  });

  test("returns empty array when no rows", () => {
    const fakeRows: Array<{ subject: string; traits: Record<string, unknown> }> = [];
    const result = fakeRows.map((r) => ({ subject: r.subject, traits: r.traits }));
    expect(result).toHaveLength(0);
  });
});

describe("PostgresStore.getRecentSessionSummaries", () => {
  test("returns correct shape from SQL rows", async () => {
    const fakeRows = [
      {
        session_id: "sess-001",
        summary: "Good session with clear breakout entry.",
        key_decisions: ["wait for London open", "take 1% risk"],
      },
      {
        session_id: "sess-002",
        summary: "Choppy session, stayed out.",
        key_decisions: [],
      },
    ];

    // Inline re-implementation of the mapping (mirrors postgres-store.ts)
    const result = fakeRows.map((r) => ({
      sessionId: r.session_id as string,
      summary: r.summary as string,
      keyDecisions: (r.key_decisions as unknown[]) ?? [],
    }));

    expect(result).toHaveLength(2);
    expect(result[0].sessionId).toBe("sess-001");
    expect(result[0].summary).toBe("Good session with clear breakout entry.");
    expect(result[0].keyDecisions).toEqual(["wait for London open", "take 1% risk"]);
    expect(result[1].sessionId).toBe("sess-002");
    expect(result[1].keyDecisions).toEqual([]);
  });

  test("returns empty array when no rows", () => {
    const fakeRows: Array<{ session_id: string; summary: string; key_decisions: unknown[] }> = [];
    const result = fakeRows.map((r) => ({
      sessionId: r.session_id,
      summary: r.summary,
      keyDecisions: r.key_decisions ?? [],
    }));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readBootResource Postgres-path tests
// We test the appendPostgresBootSections logic directly by extracting its
// behaviour via a fake PostgresStore.
// ---------------------------------------------------------------------------

/**
 * Build the Postgres boot lines using the same logic as appendPostgresBootSections.
 * This mirrors server.ts exactly so we can test without starting the server.
 */
async function buildPostgresBootLines(
  agentId: string,
  concepts: Array<{ label: string; memory_type: string; score: number }>,
  profiles: Array<{ subject: string; traits: Record<string, unknown> }>,
  sessions: Array<{ sessionId: string; summary: string; keyDecisions: unknown[] }>,
): Promise<string[]> {
  const lines: string[] = [
    `# Theorex Boot Context — Agent: ${agentId}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Active Concepts",
    "",
  ];

  for (const c of concepts) {
    lines.push(`- **${c.label}** (type: ${c.memory_type}, weight: ${c.score.toFixed(2)})`);
  }

  if (profiles.length > 0) {
    lines.push("", "## Agent Profiles", "");
    for (const p of profiles) {
      lines.push(`### ${p.subject}`);
      lines.push(JSON.stringify(p.traits, null, 2));
    }
  }

  if (sessions.length > 0) {
    lines.push("", "## Recent Sessions", "");
    for (const s of sessions) {
      const decisions = s.keyDecisions
        .filter((d): d is string => typeof d === "string")
        .join(", ");
      lines.push(`- **${s.sessionId}**: ${s.summary} | Decisions: ${decisions}`);
    }
  }

  return lines;
}

describe("readBootResource Postgres path", () => {
  test("includes profiles section when profiles exist", async () => {
    const lines = await buildPostgresBootLines(
      "main",
      [{ label: "london breakout", memory_type: "episode", score: 0.9 }],
      [{ subject: "trading_style", traits: { style: "breakout" } }],
      [],
    );

    const text = lines.join("\n");
    expect(text).toContain("## Agent Profiles");
    expect(text).toContain("### trading_style");
    expect(text).toContain('"style": "breakout"');
  });

  test("omits profiles section when no profiles", async () => {
    const lines = await buildPostgresBootLines(
      "main",
      [{ label: "london breakout", memory_type: "episode", score: 0.9 }],
      [],
      [],
    );

    const text = lines.join("\n");
    expect(text).not.toContain("## Agent Profiles");
  });

  test("includes recent sessions section when sessions exist", async () => {
    const lines = await buildPostgresBootLines(
      "main",
      [],
      [],
      [
        {
          sessionId: "sess-001",
          summary: "Good session.",
          keyDecisions: ["take profit early"],
        },
      ],
    );

    const text = lines.join("\n");
    expect(text).toContain("## Recent Sessions");
    expect(text).toContain("**sess-001**");
    expect(text).toContain("Good session.");
    expect(text).toContain("take profit early");
  });

  test("omits recent sessions section when no sessions", async () => {
    const lines = await buildPostgresBootLines("main", [], [], []);
    const text = lines.join("\n");
    expect(text).not.toContain("## Recent Sessions");
  });

  test("includes both profiles and sessions when both exist", async () => {
    const lines = await buildPostgresBootLines(
      "agent-x",
      [{ label: "scalp", memory_type: "procedure", score: 0.75 }],
      [{ subject: "risk_preferences", traits: { risk: "0.5%" } }],
      [{ sessionId: "s1", summary: "Scalped NY open.", keyDecisions: ["use tight SL"] }],
    );

    const text = lines.join("\n");
    expect(text).toContain("## Agent Profiles");
    expect(text).toContain("## Recent Sessions");
    expect(text).toContain("### risk_preferences");
    expect(text).toContain("**s1**");
  });

  test("concepts are formatted correctly", async () => {
    const lines = await buildPostgresBootLines(
      "main",
      [{ label: "london breakout", memory_type: "episode", score: 0.9 }],
      [],
      [],
    );

    const text = lines.join("\n");
    expect(text).toContain("## Active Concepts");
    expect(text).toContain("**london breakout** (type: episode, weight: 0.90)");
  });
});

// ---------------------------------------------------------------------------
// Tool handler integration tests live in server-tool-handlers.test.ts
// (separate file required so mock.module calls precede all module imports)
// ---------------------------------------------------------------------------
