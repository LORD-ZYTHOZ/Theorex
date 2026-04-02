# Stage 7: Production Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Theorex's Postgres backend for production — RLS isolation, automated backups, flash event persistence, partition management, connection resilience, and removal of file-based fallback.

**Architecture:** All changes target the existing Postgres-backed store at `src/axon/postgres-store.ts` and the flash pipeline at `src/flash/`. RLS policies use `agent_id` column for row-level isolation. A new `scripts/` backup script runs via launchd on M1. Connection resilience wraps `getDb()` with retry + circuit breaker.

**Tech Stack:** Bun 1.3+, Bun.SQL (native Postgres), PostgreSQL 15 with pgvector

---

### Task 1: RLS Policies for Agent Data Isolation

**Files:**
- Create: `scripts/apply-rls.ts`
- Test: `src/tests/rls-policies.test.ts`

- [ ] **Step 1: Write RLS migration script**

`scripts/apply-rls.ts` — applies RLS policies to concepts, profiles, session_summaries, agent_tasks tables. Uses a `theorex_agent` session variable (`SET LOCAL theorex.current_agent_id = 'xxx'`) for policy evaluation.

- [ ] **Step 2: Add `setAgentContext()` to PostgresStore**

Before each query batch, call `SET LOCAL theorex.current_agent_id` so RLS policies filter correctly. Add to constructor flow.

- [ ] **Step 3: Write tests verifying agent isolation**

Test that agent A cannot read agent B's concepts after RLS is enabled.

- [ ] **Step 4: Run migration on live DB**
- [ ] **Step 5: Commit**

---

### Task 2: pg_dump Backup Script

**Files:**
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/com.theorex.backup.plist` (launchd)

- [ ] **Step 1: Write backup shell script** — pg_dump with gzip, 7-day retention, stored at `~/backups/theorex/`
- [ ] **Step 2: Write launchd plist** — daily at 03:00 AEST
- [ ] **Step 3: Test backup + restore cycle**
- [ ] **Step 4: Commit**

---

### Task 3: Wire Flash Flush to Postgres

**Files:**
- Modify: `src/flash/flush.ts`
- Modify: `src/axon/postgres-store.ts` (add `insertFlashEvent`)
- Test: `src/tests/flash-postgres.test.ts`

- [ ] **Step 1: Add `insertFlashEvent()` to PostgresStore**

Maps FlashEvent to flash_events table (event_type=tool_name, agent=agentId, payload=full event JSON, created_at=timestamp).

- [ ] **Step 2: Modify `flushFlash()` to write to Postgres**

After writing to short-term JSONL, also insert each significant event into flash_events.

- [ ] **Step 3: Write tests**
- [ ] **Step 4: Commit**

---

### Task 4: Partition Auto-Rotation

**Files:**
- Create: `scripts/rotate-partitions.ts`

- [ ] **Step 1: Write rotation script** — creates next month's partition if missing, drops partitions older than 90 days
- [ ] **Step 2: Wire into backup script** (run after backup)
- [ ] **Step 3: Test with dry-run mode**
- [ ] **Step 4: Commit**

---

### Task 5: Remove File-Based Storage Fallback

**Files:**
- Modify: `src/mcp/server.ts` — remove AxonStore branch
- Modify: `src/cli/index.ts` — remove AxonStore branch
- Modify: `src/flash/inject.ts` — remove AxonStore usage
- Delete: `src/axon/store.ts`, `src/axon/cold.ts`, `src/axon/decompress.ts` (keep for reference in git)
- Modify: `src/axon/postgres-store.ts` — remove `isPostgresEnabled()` export

- [ ] **Step 1: Audit all `isPostgresEnabled()` call sites**
- [ ] **Step 2: Remove conditional branches, make Postgres the only path**
- [ ] **Step 3: Remove AxonStore imports from production code** (keep test files)
- [ ] **Step 4: Run full test suite**
- [ ] **Step 5: Commit**

---

### Task 6: Connection Resilience

**Files:**
- Modify: `src/axon/postgres-store.ts`
- Test: `src/tests/pg-resilience.test.ts`

- [ ] **Step 1: Add retry wrapper** — exponential backoff (3 attempts, 100/200/400ms) around `getDb()` connection
- [ ] **Step 2: Add circuit breaker** — after 5 consecutive failures in 60s, open circuit for 30s, then half-open (1 probe)
- [ ] **Step 3: Write tests for retry and circuit breaker states**
- [ ] **Step 4: Commit**
