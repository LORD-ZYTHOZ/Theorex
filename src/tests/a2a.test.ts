// tests/a2a.test.ts — Phase 19 A2A task protocol tests.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createTask,
  updateTaskStatus,
  saveTask,
  loadTask,
  listPendingTasks,
} from "../a2a/tasks";
import type { A2ATask } from "../a2a/tasks";

const TMP = join(tmpdir(), "theorex-a2a-test-" + Date.now());
const A2A_DIR = join(TMP, "a2a");

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(() => rm(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe("createTask", () => {
  test("produces a valid task with submitted status", () => {
    const task = createTask("agent-a", "agent-b", "summarize", { text: "hello" });
    expect(task.id).toBeString();
    expect(task.id.startsWith("a2a-")).toBe(true);
    expect(task.from_agent).toBe("agent-a");
    expect(task.to_agent).toBe("agent-b");
    expect(task.task_type).toBe("summarize");
    expect(task.payload).toEqual({ text: "hello" });
    expect(task.status).toBe("submitted");
    expect(new Date(task.submitted_at).getFullYear()).toBeGreaterThan(2020);
    expect(task.submitted_at).toBe(task.updated_at);
  });

  test("produces unique IDs for concurrent calls", () => {
    const t1 = createTask("a", "b", "x", {});
    const t2 = createTask("a", "b", "x", {});
    expect(t1.id).not.toBe(t2.id);
  });

  test("payload is stored as-is", () => {
    const payload = { nested: { value: 42 }, arr: [1, 2, 3] };
    const task = createTask("a", "b", "test", payload);
    expect(task.payload).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------

describe("updateTaskStatus", () => {
  test("returns a new task with updated status", () => {
    const original = createTask("a", "b", "analyze", { q: "test" });
    const updated = updateTaskStatus(original, "working");
    expect(updated.status).toBe("working");
    expect(updated.id).toBe(original.id);
    expect(updated.from_agent).toBe(original.from_agent);
    expect(updated.to_agent).toBe(original.to_agent);
  });

  test("does not mutate the original task", () => {
    const original = createTask("a", "b", "analyze", {});
    const updated = updateTaskStatus(original, "working");
    expect(original.status).toBe("submitted");
    expect(updated.status).toBe("working");
  });

  test("attaches result on completed", () => {
    const original = createTask("a", "b", "fetch", {});
    const result = { data: "some result" };
    const completed = updateTaskStatus(original, "completed", result);
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual(result);
    expect(completed.error).toBeUndefined();
  });

  test("attaches error on failed", () => {
    const original = createTask("a", "b", "fetch", {});
    const failed = updateTaskStatus(original, "failed", undefined, "timeout");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("timeout");
    expect(failed.result).toBeUndefined();
  });

  test("updated_at is newer than or equal to submitted_at", () => {
    const original = createTask("a", "b", "t", {});
    const updated = updateTaskStatus(original, "working");
    expect(new Date(updated.updated_at) >= new Date(original.submitted_at)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// saveTask + loadTask
// ---------------------------------------------------------------------------

describe("saveTask / loadTask", () => {
  test("round-trip: saved task can be loaded back", async () => {
    const task = createTask("agent-x", "agent-y", "classify", { input: "foo" });
    await saveTask(task, A2A_DIR);
    const loaded = await loadTask(task.id, A2A_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(task.id);
    expect(loaded!.from_agent).toBe("agent-x");
    expect(loaded!.status).toBe("submitted");
    expect(loaded!.payload).toEqual({ input: "foo" });
  });

  test("loadTask returns null for missing ID", async () => {
    const result = await loadTask("nonexistent-id-xyz", A2A_DIR);
    expect(result).toBeNull();
  });

  test("saving updated task overwrites the original", async () => {
    const task = createTask("a", "b", "work", {});
    await saveTask(task, A2A_DIR);
    const working = updateTaskStatus(task, "working");
    await saveTask(working, A2A_DIR);
    const loaded = await loadTask(task.id, A2A_DIR);
    expect(loaded!.status).toBe("working");
  });

  test("creates directory if it does not exist", async () => {
    const newDir = join(TMP, "a2a-new-" + Date.now());
    const task = createTask("a", "b", "t", {});
    await saveTask(task, newDir);
    const loaded = await loadTask(task.id, newDir);
    expect(loaded).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listPendingTasks
// ---------------------------------------------------------------------------

describe("listPendingTasks", () => {
  test("returns submitted and working tasks for the target agent", async () => {
    const dir = join(TMP, "a2a-list-" + Date.now());
    const t1 = createTask("sender", "receiver", "ping", {});
    const t2 = updateTaskStatus(createTask("sender", "receiver", "compute", {}), "working");
    const t3 = updateTaskStatus(createTask("sender", "receiver", "done", {}), "completed");
    const t4 = createTask("sender", "other-agent", "ping", {}); // different to_agent
    await Promise.all([
      saveTask(t1, dir),
      saveTask(t2, dir),
      saveTask(t3, dir),
      saveTask(t4, dir),
    ]);

    const pending = await listPendingTasks("receiver", dir);
    expect(pending.length).toBe(2);
    const statuses = pending.map((t) => t.status);
    expect(statuses).toContain("submitted");
    expect(statuses).toContain("working");
    // completed task must not appear
    expect(pending.find((t) => t.status === "completed")).toBeUndefined();
    // other agent's task must not appear
    expect(pending.find((t) => t.to_agent === "other-agent")).toBeUndefined();
  });

  test("returns empty array when no pending tasks exist", async () => {
    const dir = join(TMP, "a2a-empty-" + Date.now());
    const pending = await listPendingTasks("nobody", dir);
    expect(pending).toEqual([]);
  });

  test("returns empty array when directory does not exist", async () => {
    const pending = await listPendingTasks("ghost", join(TMP, "does-not-exist"));
    expect(pending).toEqual([]);
  });

  test("results are sorted by submitted_at ascending", async () => {
    const dir = join(TMP, "a2a-sorted-" + Date.now());
    // Create tasks with slight delay to ensure distinct timestamps
    const t1 = createTask("a", "target", "first", {});
    await new Promise((r) => setTimeout(r, 2));
    const t2 = createTask("a", "target", "second", {});
    await saveTask(t2, dir);
    await saveTask(t1, dir);

    const pending = await listPendingTasks("target", dir);
    expect(pending.length).toBe(2);
    expect(pending[0]!.task_type).toBe("first");
    expect(pending[1]!.task_type).toBe("second");
  });
});
