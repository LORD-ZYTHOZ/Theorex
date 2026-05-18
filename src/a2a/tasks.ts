// a2a/tasks.ts — A2A (Agent-to-Agent) task lifecycle protocol.
// Phase 19: immutable task records with atomic file persistence.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { rename } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type A2ATaskStatus = "submitted" | "working" | "completed" | "failed";

export interface A2ATask {
  readonly id: string;
  readonly submitted_at: string;
  readonly updated_at: string;
  readonly from_agent: string;
  readonly to_agent: string;
  readonly task_type: string;
  readonly payload: Record<string, unknown>;
  readonly status: A2ATaskStatus;
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Default data directory
// ---------------------------------------------------------------------------

const DEFAULT_A2A_DIR = "data/a2a";

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

export function createTask(
  from: string,
  to: string,
  type: string,
  payload: Record<string, unknown>,
): A2ATask {
  const now = new Date().toISOString();
  const id = `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    submitted_at: now,
    updated_at: now,
    from_agent: from,
    to_agent: to,
    task_type: type,
    payload,
    status: "submitted",
  };
}

// ---------------------------------------------------------------------------
// updateTaskStatus — immutable update
// ---------------------------------------------------------------------------

export function updateTaskStatus(
  task: A2ATask,
  status: A2ATaskStatus,
  result?: Record<string, unknown>,
  error?: string,
): A2ATask {
  return {
    ...task,
    status,
    updated_at: new Date().toISOString(),
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

// ---------------------------------------------------------------------------
// saveTask — atomic write via tmp + rename
// ---------------------------------------------------------------------------

export async function saveTask(task: A2ATask, dir = DEFAULT_A2A_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${task.id}.json`);
  const tmp = path + ".tmp";
  await Bun.write(tmp, JSON.stringify(task, null, 2));
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// loadTask
// ---------------------------------------------------------------------------

export async function loadTask(id: string, dir = DEFAULT_A2A_DIR): Promise<A2ATask | null> {
  const path = join(dir, `${id}.json`);
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) return null;
  try {
    return (await file.json()) as A2ATask;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// listPendingTasks — tasks for agentId with status submitted or working
// ---------------------------------------------------------------------------

export async function listPendingTasks(
  agentId: string,
  dir = DEFAULT_A2A_DIR,
): Promise<readonly A2ATask[]> {
  const glob = new Bun.Glob("*.json");
  const tasks: A2ATask[] = [];

  try {
    for await (const filename of glob.scan({ cwd: dir, onlyFiles: true })) {
      try {
        const file = Bun.file(join(dir, filename));
        const task = (await file.json()) as A2ATask;
        if (
          task.to_agent === agentId &&
          (task.status === "submitted" || task.status === "working")
        ) {
          tasks.push(task);
        }
      } catch {
        // skip malformed task files
      }
    }
  } catch {
    // dir does not exist — return empty
    return [];
  }

  return tasks.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
}
