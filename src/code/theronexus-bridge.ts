// code/theronexus-bridge.ts — Phase 7.5: Theronexus Integration
// Coordinates with the external Theronexus CLI (npx gitnexus) to build a structural
// code index alongside Theorex's semantic AST index.
//
// Theronexus license: PolyForm Noncommercial 1.0.0 — NOT embedded here.
// This module only shells out to it as an external tool.
// npm package name: gitnexus (published as gitnexus@latest)
//
// What this does:
//   1. Check if Theronexus is available on $PATH / via npx
//   2. Run `theronexus analyze <dir>` to build / refresh the .gitnexus/ index
//   3. Check .gitnexus/ was created and return metadata
//   4. Write a "theronexus_indexed" observation node into the agent's axon
//      so Theorex remembers that this directory has structural intelligence attached.

import { join } from "node:path";
import { stat, readdir } from "node:fs/promises";
import { AxonStore } from "../axon/store";
import { agentAxonPath, sourceWeightForAgent } from "../family/paths";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TheronexusStatus =
  | "indexed"     // Theronexus ran and .gitnexus/ was created
  | "refreshed"   // .gitnexus/ already existed, Theronexus refreshed it
  | "unavailable" // npx gitnexus not found
  | "failed";     // Theronexus ran but exited non-zero

export interface TheronexusResult {
  readonly status: TheronexusStatus;
  readonly dir: string;
  readonly indexDir: string;        // path to .gitnexus/ dir
  readonly durationMs: number;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function isIndexNonEmpty(indexDir: string): Promise<boolean> {
  try {
    const entries = await readdir(indexDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Run Theronexus analyze
// ---------------------------------------------------------------------------

/**
 * Run `npx gitnexus@latest analyze <dir>` as a subprocess.
 * (npm package is published as gitnexus — the tool is branded Theronexus)
 * Returns the exit code, or -1 if the process could not be spawned.
 */
async function runTheronexusAnalyze(
  dir: string,
  timeoutMs: number = 120_000,
): Promise<{ exitCode: number; stderr: string }> {
  try {
    const proc = Bun.spawn(
      ["npx", "-y", "gitnexus@latest", "analyze", dir],
      {
        cwd: dir,
        stderr: "pipe",
        stdout: "ignore",
        env: { ...process.env },
      },
    );

    const timer = setTimeout(() => proc.kill(), timeoutMs);

    let stderr = "";
    if (proc.stderr) {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value);
      }
    }

    const exitCode = await proc.exited;
    clearTimeout(timer);
    return { exitCode, stderr };
  } catch {
    return { exitCode: -1, stderr: "spawn failed" };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a directory with Theronexus and write a marker node into the agent's axon.
 *
 * The marker node records that this directory has a Theronexus structural index,
 * so Theorex knows to route code-structure queries through the Theronexus MCP tools.
 */
export async function analyzeWithTheronexus(
  agentId: string,
  dir: string,
  config: Config,
  nowMs: number = Date.now(),
  analyzeTimeoutMs: number = 120_000,
): Promise<TheronexusResult> {
  const indexDir = join(dir, ".gitnexus");
  const alreadyIndexed = await dirExists(indexDir) && await isIndexNonEmpty(indexDir);
  const start = Date.now();

  const { exitCode, stderr } = await runTheronexusAnalyze(dir, analyzeTimeoutMs);
  const durationMs = Date.now() - start;

  let status: TheronexusStatus;
  let message: string;

  if (exitCode === -1) {
    status = "unavailable";
    message = "Theronexus not available — install Node 18+ or run: npm i -g gitnexus";
  } else if (exitCode !== 0) {
    status = "failed";
    message = `Theronexus analyze exited ${exitCode}: ${stderr.slice(0, 200)}`;
  } else {
    status = alreadyIndexed ? "refreshed" : "indexed";
    message = `${status}: .gitnexus/ created in ${durationMs}ms`;
  }

  await writeTheronexusMarker(agentId, dir, status, config, nowMs);

  return { status, dir, indexDir, durationMs, message };
}

// ---------------------------------------------------------------------------
// Axon marker node
// ---------------------------------------------------------------------------

/**
 * Write (or update) a "theronexus_indexed" marker node into the agent's axon.
 *
 * Node surface_form: "theronexus:<basename(dir)>"
 * observation_type: "theronexus_indexed" | "theronexus_failed"
 * node_type: "code_function"
 *
 * This allows `theorex search theronexus` or `theorex status` to show which
 * repos have structural intelligence available.
 */
async function writeTheronexusMarker(
  agentId: string,
  dir: string,
  status: TheronexusStatus,
  config: Config,
  nowMs: number,
): Promise<void> {
  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  await mkdir(dirname(axonPath), { recursive: true });

  const store = await AxonStore.load(axonPath);
  const sourceWeight = sourceWeightForAgent(agentId);
  const timestamp = new Date(nowMs).toISOString();
  const baseName = dir.split("/").filter(Boolean).pop() ?? dir;
  const surfaceForm = `theronexus:${baseName}`;
  const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
  const conceptId = Number(Bun.hash.wyhash(surfaceForm.toLowerCase(), 0n) & MAX_SAFE_BIGINT);

  const observationType = status === "unavailable" || status === "failed"
    ? "theronexus_failed"
    : "theronexus_indexed";

  store.mergeNode(
    {
      concept_id: conceptId,
      surface_form: surfaceForm,
      importance_score: 0.9,
      frequency_count: 1,
      composite_score: sourceWeight,
      source_weight: sourceWeight,
      node_type: "code_function",
      timestamp,
    },
    agentId,
    observationType,
  );

  await store.save(axonPath);
}
