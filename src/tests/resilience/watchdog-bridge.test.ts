import { test, expect, describe } from "bun:test";
import { parseWatchdogEvent, toErrorEvent } from "../../resilience/watchdog-bridge";

describe("watchdog-bridge", () => {
  test("parses panic event as critical", () => {
    const event = parseWatchdogEvent({
      type: "panic",
      uuid: "ABC-123",
      message: "Kernel panic detected",
      timestamp: "2026-03-29T18:00:00Z",
    });
    expect(event.type).toBe("panic");
    expect(event.severity).toBe("critical");
  });

  test("parses oc_mismatch event as critical", () => {
    const event = parseWatchdogEvent({
      type: "oc_mismatch",
      expected_hash: "abc123",
      current_hash: "def456",
      timestamp: "2026-03-29T18:00:00Z",
    });
    expect(event.type).toBe("oc_mismatch");
    expect(event.severity).toBe("critical");
  });

  test("parses thermal event as high", () => {
    const event = parseWatchdogEvent({
      type: "thermal",
      e_residency: 95,
      p_residency: 2,
      cpu_active: 30,
      duration_s: 120,
      timestamp: "2026-03-29T18:00:00Z",
    });
    expect(event.type).toBe("thermal");
    expect(event.severity).toBe("high");
  });

  test("converts to ErrorEvent with hades agent_id", () => {
    const watchdog = parseWatchdogEvent({
      type: "panic",
      uuid: "ABC-123",
      message: "Kernel panic detected",
      timestamp: "2026-03-29T18:00:00Z",
    });
    const error = toErrorEvent(watchdog);
    expect(error.service).toBe("watchdog:panic");
    expect(error.severity).toBe("critical");
    expect(error.agent_id).toBe("hades");
    expect(error.category).toBe("permanent");
    expect(error.id).toBeTruthy();
  });

  test("defaults unknown type to medium severity", () => {
    const event = parseWatchdogEvent({
      type: "unknown_thing",
      timestamp: "2026-03-29T18:00:00Z",
    });
    expect(event.severity).toBe("medium");
  });
});
