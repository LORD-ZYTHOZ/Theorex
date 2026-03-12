import { test, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync, readFileSync } from "node:fs";
import { appendAuditEvent, AuditEvent } from "../../src/audit/logger";

function tmpPath(): string {
  return `/tmp/test-audit-${randomUUID()}/events.jsonl`;
}

let testPath: string;

beforeEach(() => {
  testPath = tmpPath();
});

afterEach(() => {
  // Clean up tmp directories
  try {
    const dir = testPath.replace(/\/[^/]+$/, "");
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const tierChangeEvent: AuditEvent = {
  type: "tier_change",
  timestamp: new Date("2024-01-01T00:00:00.000Z").toISOString(),
  source: "scan",
  concept_id: 42,
  surface_form: "machine learning",
  from: "MILD",
  to: "ACTIVE",
};

const sentimentFlipEvent: AuditEvent = {
  type: "sentiment_flip",
  timestamp: new Date("2024-01-01T01:00:00.000Z").toISOString(),
  source: "scan",
  concept_id: 7,
  surface_form: "javascript",
  from: "NEUTRAL",
  to: "PREFERRED",
};

const graduationEvent: AuditEvent = {
  type: "graduation",
  timestamp: new Date("2024-01-01T02:00:00.000Z").toISOString(),
  source: "graduate",
  surface_form: "typescript",
  concept_id: 99,
};

const pruneEvent: AuditEvent = {
  type: "prune",
  timestamp: new Date("2024-01-01T03:00:00.000Z").toISOString(),
  source: "prune",
  concept_id: 5,
  surface_form: "old concept",
};

const momentCaptureEvent: AuditEvent = {
  type: "moment_capture",
  timestamp: new Date("2024-01-01T04:00:00.000Z").toISOString(),
  source: "moment",
  moment_id: "abc-123",
  story_preview: "First 60 chars of the story preview text here for testing",
  concept_ids: [1, 2, 3],
};

test("appendAuditEvent writes a valid JSON line followed by \\n to the file", async () => {
  await appendAuditEvent(tierChangeEvent, testPath);
  const content = readFileSync(testPath, "utf-8");
  expect(content).toEndWith("\n");
  const parsed = JSON.parse(content.trim());
  expect(parsed.type).toBe("tier_change");
  expect(parsed.concept_id).toBe(42);
});

test("two sequential calls produce two lines (no overwrite)", async () => {
  await appendAuditEvent(tierChangeEvent, testPath);
  await appendAuditEvent(sentimentFlipEvent, testPath);
  const content = readFileSync(testPath, "utf-8");
  const lines = content.trim().split("\n");
  expect(lines).toHaveLength(2);
  const first = JSON.parse(lines[0]);
  const second = JSON.parse(lines[1]);
  expect(first.type).toBe("tier_change");
  expect(second.type).toBe("sentiment_flip");
});

test("appendAuditEvent creates the directory if absent", async () => {
  const deepPath = `/tmp/test-audit-${randomUUID()}/nested/deeply/events.jsonl`;
  try {
    await appendAuditEvent(tierChangeEvent, deepPath);
    const content = readFileSync(deepPath, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("tier_change");
  } finally {
    const topDir = deepPath.split("/").slice(0, 4).join("/");
    rmSync(topDir, { recursive: true, force: true });
  }
});

test("all five AuditEventType variants serialize round-trip correctly", async () => {
  const events: AuditEvent[] = [
    tierChangeEvent,
    sentimentFlipEvent,
    graduationEvent,
    pruneEvent,
    momentCaptureEvent,
  ];

  for (const event of events) {
    const path = tmpPath();
    try {
      await appendAuditEvent(event, path);
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.type).toBe(event.type);
    } finally {
      const dir = path.replace(/\/[^/]+$/, "");
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
