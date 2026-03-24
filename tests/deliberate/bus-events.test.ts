// tests/deliberate/bus-events.test.ts — Verify deliberation events on EventBus.
// Follows the same pattern as src/tests/trace-bus.test.ts.

import { describe, test, expect } from "bun:test";
import { bus, type BusEvent } from "../../src/trace/bus";

describe("deliberation bus events", () => {
  test("DELIBERATION_START listener receives correct payload", () => {
    const received: BusEvent[] = [];
    const listener = (e: BusEvent) => received.push(e);

    bus.on("DELIBERATION_START", listener as (e: BusEvent<"DELIBERATION_START">) => void);

    bus.emit("DELIBERATION_START", {
      date: "2026-03-24",
      session: "london",
    });

    expect(received.length).toBe(1);
    expect(received[0]!.type).toBe("DELIBERATION_START");
    const payload = received[0]!.payload as { date: string; session: string };
    expect(payload.date).toBe("2026-03-24");
    expect(payload.session).toBe("london");

    bus.off("DELIBERATION_START", listener as (e: BusEvent<"DELIBERATION_START">) => void);
  });

  test("DELIBERATION_ROUND listener receives round number and perspective", () => {
    const received: BusEvent[] = [];
    const listener = (e: BusEvent) => received.push(e);

    bus.on("DELIBERATION_ROUND", listener as (e: BusEvent<"DELIBERATION_ROUND">) => void);

    bus.emit("DELIBERATION_ROUND", {
      date: "2026-03-24",
      session: "asian",
      round: 1,
      perspective: "singularity",
    });

    expect(received.length).toBe(1);
    expect(received[0]!.type).toBe("DELIBERATION_ROUND");
    const payload = received[0]!.payload as { round: number; perspective: string };
    expect(payload.round).toBe(1);
    expect(payload.perspective).toBe("singularity");

    bus.off("DELIBERATION_ROUND", listener as (e: BusEvent<"DELIBERATION_ROUND">) => void);
  });

  test("DELIBERATION_COMPLETE listener receives status and latency", () => {
    const received: BusEvent[] = [];
    const listener = (e: BusEvent) => received.push(e);

    bus.on("DELIBERATION_COMPLETE", listener as (e: BusEvent<"DELIBERATION_COMPLETE">) => void);

    bus.emit("DELIBERATION_COMPLETE", {
      date: "2026-03-24",
      session: "new_york",
      status: "complete",
      latency_ms: 5000,
      perspectives_collected: 3,
    });

    expect(received.length).toBe(1);
    expect(received[0]!.type).toBe("DELIBERATION_COMPLETE");
    const payload = received[0]!.payload as { status: string; latency_ms: number };
    expect(payload.status).toBe("complete");
    expect(payload.latency_ms).toBe(5000);

    bus.off("DELIBERATION_COMPLETE", listener as (e: BusEvent<"DELIBERATION_COMPLETE">) => void);
  });

  test("DELIBERATION_START event has valid ISO 8601 timestamp", () => {
    const received: BusEvent[] = [];
    const listener = (e: BusEvent) => received.push(e);

    bus.on("DELIBERATION_START", listener as (e: BusEvent<"DELIBERATION_START">) => void);

    bus.emit("DELIBERATION_START", {
      date: "2026-03-24",
      session: "off_hours",
    });

    expect(received.length).toBe(1);
    expect(new Date(received[0]!.timestamp).getFullYear()).toBeGreaterThan(2020);

    bus.off("DELIBERATION_START", listener as (e: BusEvent<"DELIBERATION_START">) => void);
  });
});
