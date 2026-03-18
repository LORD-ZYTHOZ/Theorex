// tests/roles.test.ts — Phase 18: Formal Agent Roles tests.
// Covers: getProfile, getCapableAgents, routeToAgent.

import { describe, test, expect } from "bun:test";

import {
  DEFAULT_AGENT_PROFILES,
  getProfile,
  getCapableAgents,
  routeToAgent,
  type AgentProfile,
  type Capability,
  type QueryType,
} from "../roles/registry";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXTURE_PROFILES: readonly AgentProfile[] = [
  {
    agent_id: "main",
    role: "orchestrator",
    capabilities: ["synthesize", "review", "route"],
    preferred_query_types: ["synthesis", "general"],
    model_preference: "claude-sonnet",
    description: "Test orchestrator",
    active: true,
  },
  {
    agent_id: "qwen-sage",
    role: "operative",
    capabilities: ["analyze", "retrieve", "suggest"],
    preferred_query_types: ["retrieval", "code", "math"],
    model_preference: "qwen3-32b",
    description: "Test code/math operative",
    active: true,
  },
  {
    agent_id: "secretarius",
    role: "operative",
    capabilities: ["monitor", "retrieve"],
    preferred_query_types: ["retrieval", "general"],
    model_preference: "ministral-3b",
    description: "Test monitor operative",
    active: true,
  },
  {
    agent_id: "inactive-agent",
    role: "operative",
    capabilities: ["code", "analyze"],
    preferred_query_types: ["code"],
    model_preference: "some-model",
    description: "Inactive operative — should never be selected",
    active: false,
  },
];

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

describe("getProfile()", () => {
  test("returns profile for known agent_id", () => {
    const profile = getProfile("main", FIXTURE_PROFILES);
    expect(profile).not.toBeNull();
    expect(profile?.agent_id).toBe("main");
    expect(profile?.role).toBe("orchestrator");
  });

  test("returns profile for operative agent_id", () => {
    const profile = getProfile("qwen-sage", FIXTURE_PROFILES);
    expect(profile).not.toBeNull();
    expect(profile?.role).toBe("operative");
    expect(profile?.model_preference).toBe("qwen3-32b");
  });

  test("returns null for unknown agent_id", () => {
    const profile = getProfile("does-not-exist", FIXTURE_PROFILES);
    expect(profile).toBeNull();
  });

  test("returns null for empty agent_id string", () => {
    const profile = getProfile("", FIXTURE_PROFILES);
    expect(profile).toBeNull();
  });

  test("works against DEFAULT_AGENT_PROFILES without explicit profiles arg", () => {
    const profile = getProfile("main");
    expect(profile).not.toBeNull();
    expect(profile?.agent_id).toBe("main");
  });

  test("returns inactive profile when present (getProfile is not filtered by active)", () => {
    const profile = getProfile("inactive-agent", FIXTURE_PROFILES);
    expect(profile).not.toBeNull();
    expect(profile?.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCapableAgents
// ---------------------------------------------------------------------------

describe("getCapableAgents()", () => {
  test("synthesize capability returns only main (orchestrator)", () => {
    const agents = getCapableAgents("synthesize", FIXTURE_PROFILES);
    expect(agents.length).toBe(1);
    expect(agents[0]?.agent_id).toBe("main");
  });

  test("retrieve capability returns both qwen-sage and secretarius", () => {
    const agents = getCapableAgents("retrieve", FIXTURE_PROFILES);
    const ids = agents.map((a) => a.agent_id);
    expect(ids).toContain("qwen-sage");
    expect(ids).toContain("secretarius");
    expect(ids.length).toBe(2);
  });

  test("monitor capability returns only secretarius", () => {
    const agents = getCapableAgents("monitor", FIXTURE_PROFILES);
    expect(agents.length).toBe(1);
    expect(agents[0]?.agent_id).toBe("secretarius");
  });

  test("inactive agents are excluded even if they have the capability", () => {
    const agents = getCapableAgents("code", FIXTURE_PROFILES);
    const ids = agents.map((a) => a.agent_id);
    expect(ids).not.toContain("inactive-agent");
  });

  test("unknown capability returns empty array", () => {
    const agents = getCapableAgents("trade" as Capability, FIXTURE_PROFILES);
    // trade is not in any fixture profile capabilities
    expect(agents.length).toBe(0);
  });

  test("works against DEFAULT_AGENT_PROFILES without explicit profiles arg", () => {
    const agents = getCapableAgents("synthesize");
    expect(agents.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// routeToAgent
// ---------------------------------------------------------------------------

describe("routeToAgent()", () => {
  test("code query routes to qwen-sage (operative with code in preferred_query_types)", () => {
    const agent = routeToAgent("code", FIXTURE_PROFILES);
    expect(agent).not.toBeNull();
    expect(agent?.agent_id).toBe("qwen-sage");
    expect(agent?.role).toBe("operative");
  });

  test("math query routes to qwen-sage (operative with math in preferred_query_types)", () => {
    const agent = routeToAgent("math", FIXTURE_PROFILES);
    expect(agent).not.toBeNull();
    expect(agent?.agent_id).toBe("qwen-sage");
  });

  test("retrieval query routes to an operative (qwen-sage or secretarius, not main)", () => {
    const agent = routeToAgent("retrieval", FIXTURE_PROFILES);
    expect(agent).not.toBeNull();
    expect(agent?.role).toBe("operative");
    // First operative match in array order is qwen-sage (has "retrieval" in preferred_query_types)
    expect(agent?.agent_id).toBe("qwen-sage");
  });

  test("synthesis query falls back to orchestrator (no operative prefers synthesis)", () => {
    const agent = routeToAgent("synthesis", FIXTURE_PROFILES);
    expect(agent).not.toBeNull();
    expect(agent?.role).toBe("orchestrator");
    expect(agent?.agent_id).toBe("main");
  });

  test("general query: secretarius (operative) prefers general, so routes there before main", () => {
    const agent = routeToAgent("general", FIXTURE_PROFILES);
    expect(agent).not.toBeNull();
    // secretarius is an operative that has "general" in preferred_query_types
    expect(agent?.role).toBe("operative");
    expect(agent?.agent_id).toBe("secretarius");
  });

  test("inactive agents are never selected", () => {
    const profilsOnlyInactive: readonly AgentProfile[] = [
      { ...FIXTURE_PROFILES[3]!, active: false }, // inactive-agent with code
    ];
    const agent = routeToAgent("code", profilsOnlyInactive);
    expect(agent).toBeNull();
  });

  test("falls back to first active orchestrator when no operative matches", () => {
    const onlyOrchestrator: readonly AgentProfile[] = [
      {
        agent_id: "main",
        role: "orchestrator",
        capabilities: ["synthesize"],
        preferred_query_types: ["synthesis"],
        model_preference: "claude-sonnet",
        description: "Orchestrator only",
        active: true,
      },
    ];
    const agent = routeToAgent("code", onlyOrchestrator);
    expect(agent).not.toBeNull();
    expect(agent?.agent_id).toBe("main");
    expect(agent?.role).toBe("orchestrator");
  });

  test("returns null when profiles list is empty", () => {
    const agent = routeToAgent("code", []);
    expect(agent).toBeNull();
  });

  test("works against DEFAULT_AGENT_PROFILES without explicit profiles arg", () => {
    const agent = routeToAgent("code");
    expect(agent).not.toBeNull();
    // qwen-sage has code in its preferred_query_types in DEFAULT_AGENT_PROFILES
    expect(agent?.agent_id).toBe("qwen-sage");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_AGENT_PROFILES — shape validation
// ---------------------------------------------------------------------------

describe("DEFAULT_AGENT_PROFILES", () => {
  test("contains expected agent profiles", () => {
    const ids = DEFAULT_AGENT_PROFILES.map((p) => p.agent_id);
    expect(ids).toContain("main");
    expect(ids).toContain("qwen-sage");
    expect(ids).toContain("secretarius");
    expect(ids).toContain("m4-engineer");
    expect(ids).toContain("claude-code-agent");
    expect(DEFAULT_AGENT_PROFILES.length).toBe(5);
  });

  test("all profiles have required fields", () => {
    for (const p of DEFAULT_AGENT_PROFILES) {
      expect(typeof p.agent_id).toBe("string");
      expect(p.agent_id.length).toBeGreaterThan(0);
      expect(["orchestrator", "operative"]).toContain(p.role);
      expect(Array.isArray(p.capabilities)).toBe(true);
      expect(Array.isArray(p.preferred_query_types)).toBe(true);
      expect(typeof p.model_preference).toBe("string");
      expect(typeof p.description).toBe("string");
      expect(typeof p.active).toBe("boolean");
    }
  });

  test("exactly one orchestrator", () => {
    const orchestrators = DEFAULT_AGENT_PROFILES.filter((p) => p.role === "orchestrator");
    expect(orchestrators.length).toBe(1);
    expect(orchestrators[0]?.agent_id).toBe("main");
  });

  test("all default profiles are active", () => {
    expect(DEFAULT_AGENT_PROFILES.every((p) => p.active)).toBe(true);
  });
});
