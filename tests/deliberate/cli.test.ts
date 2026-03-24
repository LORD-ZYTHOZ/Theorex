// deliberate/cli.test.ts — Tests for deliberate CLI arg parsing.

import { test, expect, describe } from "bun:test";
import { parseDeliberateArgs } from "../../src/deliberate/cli";

describe("parseDeliberateArgs", () => {
  // --- Session name mapping ---

  test("maps --session LDN to london", () => {
    const result = parseDeliberateArgs(["--session", "LDN", "--date", "2026-03-24"]);
    expect(result.session).toBe("london");
    expect(result.date).toBe("2026-03-24");
  });

  test("maps --session NY to new_york", () => {
    const result = parseDeliberateArgs(["--session", "NY", "--date", "2026-03-24"]);
    expect(result.session).toBe("new_york");
  });

  test("maps --session ASIA to asian", () => {
    const result = parseDeliberateArgs(["--session", "ASIA", "--date", "2026-03-24"]);
    expect(result.session).toBe("asian");
  });

  test("maps --session OFF to off_hours", () => {
    const result = parseDeliberateArgs(["--session", "OFF", "--date", "2026-03-24"]);
    expect(result.session).toBe("off_hours");
  });

  test("accepts lowercase session names directly", () => {
    const result = parseDeliberateArgs(["--session", "london", "--date", "2026-03-24"]);
    expect(result.session).toBe("london");
  });

  // --- Flags ---

  test("parses --latest flag", () => {
    const result = parseDeliberateArgs(["--latest"]);
    expect(result.latest).toBe(true);
  });

  test("parses --force flag", () => {
    const result = parseDeliberateArgs(["--session", "LDN", "--date", "2026-03-24", "--force"]);
    expect(result.force).toBe(true);
  });

  test("--force defaults to false when omitted", () => {
    const result = parseDeliberateArgs(["--latest"]);
    expect(result.force).toBe(false);
  });

  test("--latest defaults to false when omitted", () => {
    const result = parseDeliberateArgs(["--session", "LDN", "--date", "2026-03-24"]);
    expect(result.latest).toBe(false);
  });

  // --- Combined flags ---

  test("parses --latest with --force", () => {
    const result = parseDeliberateArgs(["--latest", "--force"]);
    expect(result.latest).toBe(true);
    expect(result.force).toBe(true);
  });

  // --- Validation errors ---

  test("throws if neither --latest nor --session + --date provided", () => {
    expect(() => parseDeliberateArgs([])).toThrow();
  });

  test("throws if --session provided without --date", () => {
    expect(() => parseDeliberateArgs(["--session", "LDN"])).toThrow();
  });

  test("throws if --date provided without --session", () => {
    expect(() => parseDeliberateArgs(["--date", "2026-03-24"])).toThrow();
  });

  test("throws for unknown session name", () => {
    expect(() => parseDeliberateArgs(["--session", "MOON", "--date", "2026-03-24"])).toThrow();
  });
});
