---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-03-11T12:54:40.018Z"
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 30
  completed_plans: 30
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** An AI that knows what matters right now because its memory is alive, decays intelligently, and cross-pollinates relevance across a living concept web.
**Current focus:** Phase 8 COMPLETE — 08-04 executed. CLI commands `theorex drift` and `theorex audit` wired. runStatus extended with drift summary line. 12 new tests in cli-drift.test.ts. All DRF-01 through DRF-08 + CLI-08, CLI-09 requirements satisfied.

## Current Position

Phase: 8 of 8 (Drift Detection) — COMPLETE (4/4 plans)
Plan: 08-04 executed successfully (4 of 4 plans)
Status: Full drift detection system complete. CLI: drift command (computeDriftScore + classifyTrend), audit command (readAuditEvents with filters), status command (extended with drift summary). 401 tests pass.
Last activity: 2026-03-11 — Executed 08-04. CLI wiring complete. Phase 8 done.

Progress: [██████████] 100% (All 8 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 11
- Average duration: 2 min
- Total execution time: 0.36 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 0 (Significance Engine) | 6 | 16 min | 3 min |
| 1 (Long-Term Lobe) | 5 | 11 min | 2 min |

**Recent Trend:**
- Last 10 plans: 00-02 (2 min), 00-03 (2 min), 00-04 (2 min), 00-05 (3 min), 00-06 (5 min), 01-01 (2 min), 01-02 (3 min), 01-03 (2 min), 01-04 (3 min), 01-05 (3 min)
- Trend: stable

*Updated after each plan completion*
| Phase 00 P06 | 2 | 3 files | 5 min |
| Phase 01 P01 | 2 | 2 files | 2 min |
| Phase 01 P02 | 2 | 5 files | 3 min |
| Phase 01 P03 | 2 | 5 files | 2 min |
| Phase 01 P04 | 2 | 5 files | 3 min |
| Phase 01-long-term-lobe P05 | 3 | 2 tasks | 3 files |
| Phase 01-long-term-lobe P06 | 4 | 2 tasks | 2 files |
| Phase 02-short-term-lobe P01 | 2 | 2 tasks | 3 files |
| Phase 02-short-term-lobe P02 | 2 | 2 tasks | 4 files |
| Phase 02-short-term-lobe P04 | 2 | 2 tasks | 2 files |
| Phase 02-short-term-lobe P03 | 3 | 2 tasks | 6 files |
| Phase 02-short-term-lobe P05 | 3 | 2 tasks | 3 files |
| Phase 03-flash-hooks P01 | 2 | 2 tasks | 2 files |
| Phase 03-flash-hooks P02 | 2 | 2 tasks | 4 files |
| Phase 03-flash-hooks P03 | 3 | 3 tasks | 6 files |
| Phase 04-rag-bootstrap P01 | 3 | 1 task | 6 files |
| Phase 04-rag-bootstrap P03 | 5 | 2 tasks | 3 files |
| Phase 05 P01 | 2 | 2 tasks | 2 files |
| Phase 05 P02 | 2 | 2 tasks | 3 files |
| Phase 05 P03 | 5 | 2 tasks | 5 files |
| Phase 08-drift-detection P01 | 8 | 2 tasks | 4 files |
| Phase 08-drift-detection P02 | 4 | 2 tasks | 2 files |
| Phase 08-drift-detection P03 | 15 | 2 tasks | 7 files |
| Phase 08-drift-detection P04 | 8 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 0]: Significance engine built first — all downstream phases inherit its data model. Source weight field and node type field must be defined here even though consumed later.
- [Phase 0]: Importance gate is a hard prerequisite step, not a weighted factor. Frequency counting must never run before gate PASS.
- [Phase 0]: ConceptEvent field names use snake_case (matching CONTEXT.md locked spec); intermediate pipeline types use camelCase to distinguish pipeline-internal from final API shapes.
- [Phase 0]: GatedConcept.gatePass typed as literal `true` (not boolean) — encodes the gate invariant in the type system; structurally impossible to assign a failed concept to GatedConcept.
- [Phase 0/Plan 01]: compromise v14 alias API confirmed — use `nlp.extend({ words: { abbr: "TagName" } })` (Strategy C). Strategy A (callback form) does not persist to global lexicon.
- [Phase 0/Plan 01]: `normalize({ acronyms: true })` does NOT expand abbreviations — alias resolution requires Map lookup before hashing. synonyms.ts must implement resolveAlias() separately.
- [Phase 0/Plan 04]: wyhash output must be masked to 53 bits before Number() conversion — raw 64-bit values exceed MAX_SAFE_INTEGER, causing silent precision loss. Use `hash & BigInt(Number.MAX_SAFE_INTEGER)`.
- [Phase 0/Plan 04]: resolveAlias() must be called before hashing in assignIds() — this is the only mechanism ensuring "ml" and "machine learning" collapse to the same conceptId.
- [Phase 1]: MEMORY.md round-trip fidelity is a hard gate — byte-identical test must pass before any other phase writes to long-term storage.
- [Phase 4]: ONNX Bun compatibility spike is the hard gate before Phase 4 implementation begins.
- [Phase 6]: Cross-domain attenuation algorithm research spike required before Phase 6 implementation.
- [Phase 7]: Cognee ECL overlap check required before Phase 7 AST ingestion code is written.
- [Phase 00]: compromise .json() is phrase-level: tags must be collected from terms[], not top-level entry
- [Phase 00]: nouns().toSingular() required for plural singularization — .normalize({plurals:true}) does not singularize
- [Phase 0/Plan 05]: Formula for frequency amplifier is 1+Math.log(n) not 1+Math.log1p(n) — spec text was wrong, but expected values f(1)=1.0/f(10)=3.302/f(1000)=7.908 require natural log ln(n)
- [Phase 0/Plan 05]: Rule 1 short-word rejection has important-tag exception — concepts with Acronym/Person/etc. bypass length check (e.g. "ML" acronym passes despite 2 chars)
- [Phase 0/Plan 06]: compromise groups adjacent repeated nouns into multi-word phrases (isMultiWord=true) which pass Rule 4 — gate rejection tests use single-word stop-concept inputs, not repeated-word inputs
- [Phase 0/Plan 06]: attachMetadata() maps camelCase ScoredConcept to snake_case ConceptEvent at pipeline boundary — composite_score computed here, not inside amplifier
- [Phase 1/Plan 01]: Graphology coerces numeric node keys to strings internally — hasNode(123) and hasNode("123") are equivalent; store invariant is verified via nodes()[0] type check
- [Phase 1/Plan 02]: Parser uses index-based substring slicing (indexOf("\n## ") + slice()) not line-split+join — preserves exact bytes for byte-identical round-trip; rawBody includes leading \n after heading
- [Phase 1/Plan 02]: serializeMemory uses join("") not join("\n") — inter-section newlines are already within rawBody, no separator needed
- [Phase 1/Plan 02]: HARD GATE passed: byte-identical round-trip verified on real MEMORY.md (8399 bytes)
- [Phase 1/Plan 03]: frequencyScore uses Math.log(1+n)/Math.log(101) — base 101 so count=100 → exactly 1.0
- [Phase 1/Plan 03]: ScoringConfig = Pick<Config, halfLifeDays|activeThreshold|mildThreshold> — scorer has no full Config dependency
- [Phase 1/Plan 03]: propagateSentiment nudges importance_weight only — neighbor sentiment_tier unchanged (SNT-04 invariant)
- [Phase 1/Plan 03]: neighbors collected into array before mutation loop — forEachNeighbor with graph mutations is unsafe in graphology
- [Phase 1/Plan 04]: Collect node/edge keys into arrays before mutation loop — forEachNode/forEachEdge with concurrent graph mutations is unsafe in Graphology (extends plan 03 pattern to scan/prune)
- [Phase 1/Plan 04]: Archive-before-drop is the prune invariant: JSONL write must succeed before any graph.dropNode() call (LTM-05 data loss prevention)
- [Phase 1/Plan 04]: freqScore(1) = log(2)/log(101) ≈ 0.1505; fresh node with count=5 scores ~0.534 (MILD not ACTIVE); need count≥14 to reach ACTIVE tier
- [Phase 1/Plan 04]: Edge decay uses strength × exp(-LN2/halfLifeDays × daysSinceCoOccurrence) — same formula as recency decay, applied to edge strength field
- [Phase 01-long-term-lobe]: import.meta.main guard enables src/cli/index.ts to export handlers AND run as CLI entrypoint — no separate handler module needed
- [Phase 01-long-term-lobe]: CLI pattern: export named handler functions, dispatch in import.meta.main block — all four CLI commands follow this
- [Phase 01-long-term-lobe]: REL-03 lazy correction is display-only — axon.json relevance_tier stays stale in storage; only the rendered value is corrected via compositeScore+classifyTier at read time
- [Phase 02-short-term-lobe]: appendFile from node:fs/promises is mandatory for JSONL appends — Bun.write silently replaces file content
- [Phase 02-short-term-lobe]: rotateStm uses string date comparison (dateStr < cutoffStr) — YYYY-MM-DD lexicographic order is chronological, no Date parsing needed
- [Phase 02-short-term-lobe]: Short-term store: one JSONL file per day named YYYY-MM-DD.jsonl in data/short-term/, 14-day cutoff is exclusive boundary
- [Phase 02-short-term-lobe/Plan 02]: wink-bm25-text-search requires minimum 3 docs for consolidation — buildBm25Index pads with empty sentinel docs when entries.length < 3
- [Phase 02-short-term-lobe/Plan 02]: createRequire(import.meta.url) pattern confirmed for CJS interop in Bun 1.3.10 ESM modules
- [Phase 02-short-term-lobe/Plan 02]: wink uniqueId = integer index passed to addDoc; bm25Search maps it back via entries[uniqueId].id
- [Phase 02-short-term-lobe/Plan 02]: fldWeights: { surface_form: 3 } boosts surface_form matches 3x in BM25 scoring
- [Phase 02-short-term-lobe]: hasConsecutiveRun resets run counter to 1 on gap — current day is start of new run
- [Phase 02-short-term-lobe]: Idempotency check uses rawBody.includes(subsectionHeading) — reliable for fixed-format headings
- [Phase 02-short-term-lobe]: embedText returns null for ALL failure modes (timeout, 4xx/5xx, network error) — hybridSearch interprets null as BM25-only fallback
- [Phase 02-short-term-lobe]: cosineSimilarity uses reduce() not Math.hypot spread — spread fails for >1000 dimensions due to JS call stack limits
- [Phase 02-short-term-lobe]: AbortController timeout mock requires signal.addEventListener('abort') in bun:test — mock ignores signal.aborted automatically
- [Phase 02-short-term-lobe]: CLI-05/CLI-06: runSearch+runGraduate follow Phase 1 handler pattern; MEMORY_PATH constant added; rotateStm called on each invocation; search dispatch uses rest.join(' ') from positionals
- [Phase 03-flash-hooks/Plan 01]: enforceRingBuffer applies ring cap first (50 events), then token ceiling trim — order matters; minimum 1 event always retained even if over 4000-token limit
- [Phase 03-flash-hooks/Plan 01]: readFlash uses node:fs/promises for ENOENT code inspection; writeFlash uses tmpdir+rename atomic pattern (consistent with Phase 1 LTM-04)
- [Phase 03-flash-hooks/Plan 01]: estimateTokens = Math.ceil(JSON.stringify(events).length / 4) — character-based token approximation per plan spec
- [Phase 03-flash-hooks]: flushFlash always calls writeFlash to clear flash buffer even when zero events pass threshold (FLH-05 invariant: flush = clear)
- [Phase 03-flash-hooks]: injectContext wraps axon and short-term reads in independent try/catch blocks — partial data still produces output
- [Phase 03-flash-hooks]: concept_id=0 used as sentinel in ShortTermEntry from flush — flash events are tool-use records with no concept mapping
- [Phase 03-flash-hooks/Plan 03]: empty tool_name + empty tool_input → textToScore=" {}" → processText returns [] → significance_score=0 (verified; single-char tool names like "x" score 1.0)
- [Phase 03-flash-hooks/Plan 03]: PostToolUse uses async:true in settings.json AND & in shell as belt-and-suspenders for non-blocking
- [Phase 03-flash-hooks/Plan 03]: flush alias added alongside flash-flush as SessionEnd /exit bug workaround (Claude Code bug #17885)
- [Phase 04/Plan 01]: ONNX spike PASSED via WASM backend in Bun 1.3.10 — no forced env.backends config needed in Plan 02; default pipeline() call works
- [Phase 04/Plan 01]: Bun 1.3.10 crashes with SIGABRT (exit 133) after WASM test teardown — C++ exception in cleanup, not a test failure; test assertions all pass before crash
- [Phase 04/Plan 02]: AxonEdgeAttrs backward-compatible extension — organic mergeEdge gets seeded=false, seed_created_at=''; upsert path preserves existing seeded fields immutably
- [Phase 04/Plan 02]: mergeNodeWithBootstrap checks isNew BEFORE calling mergeNode — setImmediate fires only for truly new concepts (not upserts)
- [Phase 04/Plan 02]: seedEdges guards each mergeEdge with hasNode() + skips LESS-tier targets — prevents graph pollution from pruned/irrelevant nodes
- [Phase 04/Plan 02]: findKNN edgeWeight = clamp(0.1 + (similarity - minSimilarity) * 0.2, 0.1, 0.2) — weak initial signal strengthened by organic co-occurrence over time
- [Phase 04/Plan 02]: embedding-store.ts is stateless (no in-memory cache) — reads fresh from disk on each call; safe for multi-process access
- [Phase 04-03]: shouldDissolveSeeded is a pure function (no I/O) — enables direct unit testing without graph setup
- [Phase 04-03]: dissolveSeededEdges collects ALL edge keys before mutation — follows Phase 1 Graphology safety invariant extended to dissolution pass
- [Phase 04-03]: deleteEmbedding awaited after graph.dropNode in prune loop — embedding store lifecycle tied to node lifecycle, ENOENT handled gracefully
- [Phase 05-01]: MomentNode all fields readonly; createMoment uses Bun.write(tmp)+rename atomic pattern; MOMENTS_DIR=data/moments provides structural immunity to pruneAxon/scanAxon
- [Phase 05-02]: searchMoments uses fldWeights: { story: 3 } with bm25Params k1=1.2 b=0.75; sentinel padding applied when moments.length < 3; moment results in CLI wrapped in try/catch (non-fatal)
- [Phase 05-03]: captureCodeRefs accepts optional gitFn override for unit-test isolation — avoids real Bun.$ shell calls in tests
- [Phase 05-03]: activeIds hoisted as let before first try/catch in injectContext so moments block can access ACTIVE concept set independently
- [Phase 05-03]: processText called with positional args (text, sourceWeight, nodeType, timestamp) — plan interface block showed object form but actual compose.ts API uses positionals
- [Phase 08-drift-detection]: appendFile from node:fs/promises mandated for audit JSONL — Bun.write silently replaces file content (extends Phase 2 decision)
- [Phase 08-drift-detection]: logger.ts imports only node: builtins — one-way dependency enforced structurally (axon imports audit, never reverse)
- [Phase 08-drift-detection]: reader.ts uses Bun.file().text().catch(() => '') for ENOENT tolerance — consistent with existing codebase pattern
- [Phase 08-drift-detection]: detectSentimentFlips tracks only to field (outcome) per in-window event — from field reflects prior state predating the window
- [Phase 08-drift-detection]: scorer.ts defines local minimal AuditEvent type alias — preserves zero-I/O invariant and allows parallel plan execution
- [Phase 08-03]: void appendAuditEvent(...).catch(() => {}) is the universal fire-and-forget pattern — audit write failure must never propagate to mutation site callers
- [Phase 08-03]: config.eventsPath ?? "data/events.jsonl" nullish coalescing in scan/prune — partial test configs omit eventsPath, fallback prevents undefined path errors
- [Phase 08-03]: oldTier/oldSentiment captured before mutation — required for correct no-op guard; cannot compare against already-mutated value
- [Phase 08-03]: propagateSentiment and graduateToLongTerm use default EVENTS_PATH (no config param override) — consistent with their existing API signatures
- [Phase 08-04]: parseArgs re-parse uses Bun.argv.slice(2).filter(a => a !== subcommand) for audit flags — top-level parseArgs discards option values for undeclared options; --type value ends up as positional in rest[]
- [Phase 08-04]: AuditEvent cast via (events as unknown as readonly ScorerEvent[]) — logger.ts union types lack [key: string]: unknown index signature; double-cast avoids unsafe any while satisfying scorer.ts local type
- [Phase 08-04]: runStatus drift summary in independent try/catch after moments block — DRF-07: drift failure must never affect status table output
- [Phase 08-04]: runAudit --since parsed as YYYY-MM-DD + T00:00:00.000Z — UTC midnight interpretation prevents local-timezone ambiguity

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 3]: Claude Code hooks have known bugs (subdirectory firing, JSON stdout contamination). Requires integration test in non-Theorex directories before touching global Claude Code config.
- [Phase 6]: Cross-domain propagation attenuation algorithm has no reference implementation — novel territory. Highest-risk undefined algorithm in the system.

## Session Continuity

Last session: 2026-03-11
Stopped at: Completed 08-04 — CLI wiring complete. runDrift + runAudit added to src/cli/index.ts. runStatus extended with drift summary. 12 tests in cli-drift.test.ts. 401 tests pass. All DRF-01..DRF-08 + CLI-08 + CLI-09 satisfied. Phase 8 complete. Project milestone v1.0 DONE.
Resume file: None
