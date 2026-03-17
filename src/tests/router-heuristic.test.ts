// tests/router-heuristic.test.ts — Phase 16 HeuristicRouter tests.
// Covers: route() priority ordering, classifyQuery(), buildFallbackChain().

import { describe, test, expect } from "bun:test";

import {
  route,
  classifyQuery,
  buildFallbackChain,
  type RoutingInput,
} from "../router/heuristic";

// ---------------------------------------------------------------------------
// route() — priority-ordered heuristic checks
// ---------------------------------------------------------------------------

describe("route() — urgent flag", () => {
  test("urgent=true routes to small tier with ministral-3b", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "what is the capital of France",
      context_pct: 10,
      query_tokens: 10,
      urgent: true,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("small");
    expect(decision.model_name).toBe("ministral-3b");
    expect(decision.reason).toContain("urgent");
  });

  test("urgent=true beats context_pct=90 — small wins", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "summarise this document",
      context_pct: 90,
      query_tokens: 50,
      urgent: true,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("small");
  });
});

describe("route() — context pressure", () => {
  test("context_pct=60 routes to large tier with qwen3-32b", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hello",
      context_pct: 60,
      query_tokens: 5,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("large");
    expect(decision.model_name).toBe("qwen3-32b");
    expect(decision.reason).toContain("60");
  });

  test("context_pct=50 (boundary) routes to large tier", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hi",
      context_pct: 50,
      query_tokens: 2,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("large");
  });

  test("context_pct=49 does not trigger context pressure rule", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hi",
      context_pct: 49,
      query_tokens: 2,
    };
    const decision = route(input);
    // No urgent, no context pressure, no long tokens, no code/math/retrieval
    expect(decision.model_tier).toBe("medium");
  });
});

describe("route() — long query tokens", () => {
  test("query_tokens=600 routes to large tier", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hello",
      context_pct: 10,
      query_tokens: 600,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("large");
    expect(decision.reason).toContain("600");
  });

  test("query_tokens=501 routes to large tier", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hi",
      context_pct: 5,
      query_tokens: 501,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("large");
  });

  test("query_tokens=500 (boundary, not > 500) does not trigger", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hi",
      context_pct: 5,
      query_tokens: 500,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("medium");
  });
});

describe("route() — keyword classification", () => {
  test("query containing 'debug' and 'typescript' routes to large (code)", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "debug this typescript function",
      context_pct: 10,
      query_tokens: 10,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("large");
    expect(decision.query_type).toBe("code");
  });

  test("query containing 'recall' routes to medium (retrieval)", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "recall my last trade setup",
      context_pct: 10,
      query_tokens: 10,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("medium");
    expect(decision.query_type).toBe("retrieval");
  });

  test("simple greeting defaults to medium", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hello",
      context_pct: 10,
      query_tokens: 3,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("medium");
    expect(decision.query_type).toBe("general");
  });
});

// ---------------------------------------------------------------------------
// classifyQuery()
// ---------------------------------------------------------------------------

describe("classifyQuery()", () => {
  test("'debug this typescript function' → code", () => {
    expect(classifyQuery("debug this typescript function")).toBe("code");
  });

  test("'recall my last trade setup' → retrieval", () => {
    expect(classifyQuery("recall my last trade setup")).toBe("retrieval");
  });

  test("'hello' → general", () => {
    expect(classifyQuery("hello")).toBe("general");
  });

  test("'calculate the moving average formula' → math", () => {
    expect(classifyQuery("calculate the moving average formula")).toBe("math");
  });

  test("very long query (>200 chars) with no keyword signal → synthesis", () => {
    const longQuery = "please ".repeat(30) + "help me think through this situation carefully";
    expect(classifyQuery(longQuery)).toBe("synthesis");
  });
});

// ---------------------------------------------------------------------------
// buildFallbackChain()
// ---------------------------------------------------------------------------

describe("buildFallbackChain()", () => {
  test("primary=large → fallbacks=[medium, small], last_resort=claude-api", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "debug this code",
      context_pct: 10,
      query_tokens: 10,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("large");

    const chain = buildFallbackChain(decision);
    expect(chain.primary).toBe("large");
    expect(chain.fallbacks).toEqual(["medium", "small"]);
    expect(chain.last_resort).toBe("claude-api");
  });

  test("primary=medium → fallbacks contain small and large", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "hello",
      context_pct: 10,
      query_tokens: 3,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("medium");

    const chain = buildFallbackChain(decision);
    expect(chain.primary).toBe("medium");
    expect(chain.fallbacks).toContain("small");
    expect(chain.fallbacks).toContain("large");
    expect(chain.last_resort).toBe("claude-api");
  });

  test("primary=small → fallbacks contain medium and large", () => {
    const input: RoutingInput = {
      agent_id: "main",
      query: "urgent ping",
      context_pct: 5,
      query_tokens: 2,
      urgent: true,
    };
    const decision = route(input);
    expect(decision.model_tier).toBe("small");

    const chain = buildFallbackChain(decision);
    expect(chain.primary).toBe("small");
    expect(chain.fallbacks).toContain("medium");
    expect(chain.fallbacks).toContain("large");
    expect(chain.last_resort).toBe("claude-api");
  });
});
