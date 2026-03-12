# Deferred Items

## Pre-existing TypeScript strict mode warnings

**Discovered during:** Plan 06 (compose.ts implementation)

Pre-existing TypeScript strict mode errors in earlier test files (not caused by Plan 06 changes):
- `tests/amplify.test.ts` — 17 errors: `noUncheckedIndexedAccess` and `possibly undefined` on array access
- `tests/gate.test.ts` — 9 errors: same pattern
- `tests/identify.test.ts` — 9 errors: same pattern

These existed before Plan 06. They do not affect `bun test` runtime. Fix in a separate cleanup pass if TypeScript strict compliance is required for test files.

**Files:** tests/amplify.test.ts, tests/gate.test.ts, tests/identify.test.ts
**Severity:** Low (test-only, runtime not affected)
