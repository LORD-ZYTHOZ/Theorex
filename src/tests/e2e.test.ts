// tests/e2e.test.ts — End-to-end CLI tests for Theorex.
// Runs actual CLI commands via Bun.spawn and checks output/exit codes.
// Each test group uses an isolated temp directory.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Derive project root from this file's location (src/tests/ → two levels up)
import { join as pathJoin, dirname } from "node:path";
const PROJECT_ROOT = pathJoin(dirname(import.meta.path), "../..");

// Resolve bun executable — works regardless of whether bun is in PATH
const BUN_BIN = process.execPath; // the bun binary running this test suite

// ---------------------------------------------------------------------------
// Helper: spawn CLI and capture stdout, stderr, exit code
// ---------------------------------------------------------------------------

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function cli(args: string[], tmpDir: string): Promise<CliResult> {
  const proc = Bun.spawn([BUN_BIN, "src/cli/index.ts", ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATA_DIR: tmpDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

const TMP_BASE = join(tmpdir(), "theorex-e2e-" + Date.now());

beforeAll(() => mkdir(TMP_BASE, { recursive: true }));
afterAll(() => rm(TMP_BASE, { recursive: true, force: true }));

function makeTmp(suffix: string): string {
  return join(TMP_BASE, suffix);
}

// ---------------------------------------------------------------------------
// Group 1: Routing
// ---------------------------------------------------------------------------

describe("route command", () => {
  test(
    "route 'debug typescript code' → qwen3-32b and large tier",
    async () => {
      const tmp = makeTmp("route-code");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["route", "debug typescript code"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("qwen3-32b");
      expect(result.stdout.toLowerCase()).toContain("large");
    },
    { timeout: 15000 }
  );

  test(
    "route 'find my last trade' → ministral and retrieval",
    async () => {
      const tmp = makeTmp("route-retrieval");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["route", "find my last trade"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("ministral");
      expect(result.stdout.toLowerCase()).toContain("retrieval");
    },
    { timeout: 15000 }
  );

  test(
    "route 'hello world' → medium tier",
    async () => {
      const tmp = makeTmp("route-general");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["route", "hello world"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("medium");
    },
    { timeout: 15000 }
  );

  test(
    "route with no args → exit code 1",
    async () => {
      const tmp = makeTmp("route-noargs");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["route"], tmp);
      expect(result.code).toBe(1);
    },
    { timeout: 15000 }
  );
});

// ---------------------------------------------------------------------------
// Group 2: Energy
// ---------------------------------------------------------------------------

describe("energy-check command", () => {
  test(
    "energy-check exits 0 and contains AC Power or Battery",
    async () => {
      const tmp = makeTmp("energy");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["energy-check"], tmp);
      expect(result.code).toBe(0);
      const out = result.stdout;
      const hasSource = out.includes("AC Power") || out.includes("Battery");
      expect(hasSource).toBe(true);
    },
    { timeout: 15000 }
  );

  test(
    "energy-check output contains 'Large model allowed'",
    async () => {
      const tmp = makeTmp("energy-advice");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["energy-check"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Large model allowed");
    },
    { timeout: 15000 }
  );
});

// ---------------------------------------------------------------------------
// Group 3: Trace + Matrix
// ---------------------------------------------------------------------------

describe("trace-stats command", () => {
  test(
    "trace-stats exits 0 and contains 'Trace Stats'",
    async () => {
      const tmp = makeTmp("trace-stats");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["trace-stats"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Trace Stats");
    },
    { timeout: 15000 }
  );
});

describe("matrix-build command", () => {
  test(
    "matrix-build exits 0 and contains 'Confidence matrix'",
    async () => {
      const tmp = makeTmp("matrix-build");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["matrix-build"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("confidence matrix");
    },
    { timeout: 15000 }
  );
});

describe("matrix-show command", () => {
  test(
    "matrix-show exits 0",
    async () => {
      const tmp = makeTmp("matrix-show");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["matrix-show"], tmp);
      expect(result.code).toBe(0);
    },
    { timeout: 15000 }
  );
});

// ---------------------------------------------------------------------------
// Group 4: Policy
// ---------------------------------------------------------------------------

describe("policy-snapshot command", () => {
  test(
    "policy-snapshot exits 0 and contains 'Policy snapshot saved'",
    async () => {
      const tmp = makeTmp("policy-snap");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["policy-snapshot"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Policy snapshot saved");
    },
    { timeout: 15000 }
  );

  test(
    "second policy-snapshot has higher version number than first",
    async () => {
      const tmp = makeTmp("policy-version");
      await mkdir(tmp, { recursive: true });

      const first = await cli(["policy-snapshot"], tmp);
      expect(first.code).toBe(0);

      const second = await cli(["policy-snapshot"], tmp);
      expect(second.code).toBe(0);

      // Extract version numbers from "Policy snapshot saved: vN"
      const extractVersion = (out: string): number => {
        const match = out.match(/Policy snapshot saved: v(\d+)/);
        return match ? parseInt(match[1]!, 10) : -1;
      };

      const v1 = extractVersion(first.stdout);
      const v2 = extractVersion(second.stdout);

      expect(v1).toBeGreaterThanOrEqual(0);
      expect(v2).toBeGreaterThan(v1);
    },
    { timeout: 30000 }
  );
});

// ---------------------------------------------------------------------------
// Group 5: Dispatch
// ---------------------------------------------------------------------------

describe("dispatch command", () => {
  test(
    "dispatch with context 30 → below trigger threshold (skipped)",
    async () => {
      const tmp = makeTmp("dispatch-low");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["dispatch", "test task", "--context", "30"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("below trigger threshold");
    },
    { timeout: 15000 }
  );

  test(
    "dispatch with context 60 → exits 0 (dispatched) or non-zero (LM Studio not running)",
    async () => {
      const tmp = makeTmp("dispatch-high");
      await mkdir(tmp, { recursive: true });

      // Spawn with a short timeout — LM Studio may hang the connection
      const proc = Bun.spawn(["bun", "src/cli/index.ts", "dispatch", "test task", "--context", "60"], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, DATA_DIR: tmp },
        stdout: "pipe",
        stderr: "pipe",
      });

      // Race: either the process exits within 10s or we kill it
      const timeoutHandle = setTimeout(() => proc.kill(), 10_000);
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timeoutHandle);

      if (code === 0) {
        // LM Studio is running — dispatched successfully
        expect(code).toBe(0);
      } else {
        // LM Studio not running or timed out — either exit 1 with "Dispatch failed"
        // or process killed (143/SIGTERM) — both are valid
        const validFailure =
          (code === 1 && stderr.toLowerCase().includes("dispatch failed")) ||
          code === 143 || // SIGTERM from our kill()
          code > 1;       // any other non-zero signal exit
        expect(validFailure).toBe(true);
      }
    },
    { timeout: 20000 }
  );

  test(
    "dispatch with no task → exit code 1",
    async () => {
      const tmp = makeTmp("dispatch-noargs");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["dispatch"], tmp);
      expect(result.code).toBe(1);
    },
    { timeout: 15000 }
  );
});

// ---------------------------------------------------------------------------
// Group 6: Boot-aware
// ---------------------------------------------------------------------------

describe("boot-aware command", () => {
  test(
    "boot-aware --model ministral-3b --agent main exits 0 and contains 'Boot-aware context'",
    async () => {
      const tmp = makeTmp("boot-aware");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["boot-aware", "--model", "ministral-3b", "--agent", "main"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Boot-aware context");
    },
    { timeout: 15000 }
  );
});

// ---------------------------------------------------------------------------
// Group 7: Write + Scan (existing core)
// ---------------------------------------------------------------------------

describe("write command", () => {
  test(
    "write --agent e2e-test 'hello theorex e2e test' exits 0 and output contains 'Written to'",
    async () => {
      const tmp = makeTmp("write");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["write", "--agent", "e2e-test", "hello theorex e2e test"], tmp);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Written to");
    },
    { timeout: 15000 }
  );
});

describe("scan command", () => {
  test(
    "scan exits 0",
    async () => {
      const tmp = makeTmp("scan");
      await mkdir(tmp, { recursive: true });
      const result = await cli(["scan"], tmp);
      expect(result.code).toBe(0);
    },
    { timeout: 15000 }
  );
});
