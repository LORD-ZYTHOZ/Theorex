---
phase: 01-long-term-lobe
plan: "01"
subsystem: axon-store
tags: [graphology, graph, persistence, tdd, atomic-write]
dependency_graph:
  requires: [src/types.ts (ConceptEvent)]
  provides: [src/axon/store.ts (AxonStore, AxonNodeAttrs, AxonEdgeAttrs)]
  affects: [all upstream phases that write through AxonStore, all downstream phases that read from it]
tech_stack:
  added: [graphology UndirectedGraph]
  patterns: [atomic rename (Bun.write + node:fs/promises rename), TDD RED-GREEN]
key_files:
  created:
    - src/axon/store.ts
    - tests/axon/store.test.ts
  modified: []
decisions:
  - "Graphology coerces numeric node keys to strings internally — test updated to verify stored key type rather than asserting hasNode(numeric) is false"
  - "addNode used on first-call path for explicit attribute initialization (mergeNode is used for subsequent upserts via hasNode guard)"
metrics:
  duration: "2 min"
  completed: "2026-03-10"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
requirements_satisfied: [AXN-01, AXN-02, AXN-03, AXN-05, AXN-06, SNT-01]
---

# Phase 01 Plan 01: AxonStore — Graphology-backed concept web store Summary

**One-liner:** Typed Graphology UndirectedGraph persistence layer with atomic JSON writes, safe upsert semantics, and NEUTRAL-default sentiment tiers.

## What Was Built

`src/axon/store.ts` — the foundational graph data layer for Theorex long-term memory. AxonStore wraps `UndirectedGraph<AxonNodeAttrs, AxonEdgeAttrs>` and provides:

- `mergeNode(event: ConceptEvent): string` — upserts node from significance pipeline output; new nodes start `sentiment_tier: "NEUTRAL"`, `relevance_tier: "ACTIVE"`; existing nodes increment `frequency_count` and update `last_seen`
- `mergeEdge(idA, idB, timestamp): void` — upserts co-occurrence edge; first call sets `strength: 0.1, co_occurrence_count: 1`; subsequent calls add `0.05` to strength (clamped at `1.0`)
- `async save(path): Promise<void>` — atomic write via `path + ".tmp"` + `node:fs/promises rename` (same directory, avoids EXDEV)
- `static async load(path): Promise<AxonStore>` — returns empty store on ENOENT, typed `UndirectedGraph.from` on success
- `get graph()` — read-only accessor for iteration

## Test Results

```
10 pass, 0 fail
Ran 10 tests across 1 file. [11ms]
```

Tests cover: empty store, mergeNode attr initialization, key coercion to string, frequency increment + last_seen update, edge first-call attrs, edge strengthening, edge strength clamping at 1.0, save+load round-trip, ENOENT graceful empty return, string key type verification.

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for AxonStore | d7f205a | tests/axon/store.test.ts |
| 2 (GREEN) | AxonStore implementation | e35dfdb | src/axon/store.ts, tests/axon/store.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect test assertion for numeric key lookup**

- **Found during:** Task 2 (GREEN) — test 10 failed
- **Issue:** Test asserted `graph.hasNode(123)` returns `false` — but Graphology coerces numeric arguments to strings internally, so `hasNode(123)` and `hasNode("123")` are equivalent
- **Fix:** Replaced assertion with `store.graph.nodes()[0] === "123"` and `typeof nodes[0] === "string"` — verifies the invariant (keys stored as strings) without contradicting Graphology's internal coercion behavior
- **Files modified:** tests/axon/store.test.ts
- **Commit:** e35dfdb

## Self-Check

Files created:
- src/axon/store.ts — FOUND
- tests/axon/store.test.ts — FOUND

Commits:
- d7f205a (RED tests) — FOUND
- e35dfdb (GREEN implementation) — FOUND
