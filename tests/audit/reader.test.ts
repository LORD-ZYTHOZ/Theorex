import { test, expect, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { readAuditEvents, AuditFilter } from "../../src/audit/reader";
import { AuditEvent } from "../../src/audit/logger";

function tmpPath(): string {
  return `/tmp/test-audit-reader-${randomUUID()}/events.jsonl`;
}

const paths: string[] = [];

function makePath(): string {
  const p = tmpPath();
  paths.push(p);
  return p;
}

afterEach(() => {
  for (const p of paths) {
    const dir = p.replace(/\/[^/]+$/, "");
    rmSync(dir, { recursive: true, force: true });
  }
  paths.length = 0;
});

function writeEvents(path: string, events: AuditEvent[]): void {
  const dir = path.replace(/\/[^/]+$/, "");
  mkdirSync(dir, { recursive: true });
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path, content, "utf-8");
}

const earlyEvent: AuditEvent = {
  type: "tier_change",
  timestamp: new Date("2024-01-01T00:00:00.000Z").toISOString(),
  source: "scan",
  concept_id: 1,
  surface_form: "python",
  from: "LESS",
  to: "MILD",
};

const lateEvent: AuditEvent = {
  type: "tier_change",
  timestamp: new Date("2024-06-01T00:00:00.000Z").toISOString(),
  source: "scan",
  concept_id: 2,
  surface_form: "rust",
  from: "MILD",
  to: "ACTIVE",
};

const sentimentEvent: AuditEvent = {
  type: "sentiment_flip",
  timestamp: new Date("2024-03-01T00:00:00.000Z").toISOString(),
  source: "scan",
  concept_id: 3,
  surface_form: "javascript",
  from: "NEUTRAL",
  to: "PREFERRED",
};

test("readAuditEvents returns [] when file does not exist (ENOENT)", async () => {
  const p = makePath();
  const result = await readAuditEvents(p);
  expect(result).toEqual([]);
});

test("readAuditEvents returns all events from a valid JSONL file", async () => {
  const p = makePath();
  writeEvents(p, [earlyEvent, lateEvent, sentimentEvent]);
  const result = await readAuditEvents(p);
  expect(result).toHaveLength(3);
});

test("readAuditEvents skips malformed lines", async () => {
  const p = makePath();
  const dir = p.replace(/\/[^/]+$/, "");
  mkdirSync(dir, { recursive: true });
  // Write: valid, invalid, valid
  writeFileSync(
    p,
    [JSON.stringify(earlyEvent), "NOT_VALID_JSON{{{", JSON.stringify(lateEvent)].join("\n") +
      "\n",
    "utf-8",
  );
  const result = await readAuditEvents(p);
  expect(result).toHaveLength(2);
});

test("filter.type='tier_change' returns only tier_change events", async () => {
  const p = makePath();
  writeEvents(p, [earlyEvent, sentimentEvent, lateEvent]);
  const filter: AuditFilter = { type: "tier_change" };
  const result = await readAuditEvents(p, filter);
  expect(result).toHaveLength(2);
  for (const e of result) {
    expect(e.type).toBe("tier_change");
  }
});

test("filter.sinceMs excludes events with timestamp before sinceMs", async () => {
  const p = makePath();
  writeEvents(p, [earlyEvent, sentimentEvent, lateEvent]);
  // sinceMs = April 1 2024 — should exclude earlyEvent (Jan) and sentimentEvent (Mar), keep lateEvent (Jun)
  const sinceMs = new Date("2024-04-01T00:00:00.000Z").getTime();
  const filter: AuditFilter = { sinceMs };
  const result = await readAuditEvents(p, filter);
  expect(result).toHaveLength(1);
  expect(result[0].surface_form).toBe("rust");
});

test("filter.sinceMs includes events with timestamp after sinceMs", async () => {
  const p = makePath();
  writeEvents(p, [earlyEvent, sentimentEvent, lateEvent]);
  // sinceMs = Dec 31 2023 — all three events are after this
  const sinceMs = new Date("2023-12-31T00:00:00.000Z").getTime();
  const filter: AuditFilter = { sinceMs };
  const result = await readAuditEvents(p, filter);
  expect(result).toHaveLength(3);
});
