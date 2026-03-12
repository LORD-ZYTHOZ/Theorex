import { AuditEvent, AuditEventType, EVENTS_PATH } from "./logger";

export interface AuditFilter {
  type?: AuditEventType;
  sinceMs?: number; // milliseconds since epoch; events before this are excluded
}

export async function readAuditEvents(
  path: string = EVENTS_PATH,
  filter: AuditFilter = {},
): Promise<AuditEvent[]> {
  const text = await Bun.file(path).text().catch(() => "");

  const events: AuditEvent[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: AuditEvent;
    try {
      parsed = JSON.parse(trimmed) as AuditEvent;
    } catch {
      // skip malformed lines
      continue;
    }

    if (filter.type !== undefined && parsed.type !== filter.type) {
      continue;
    }

    if (filter.sinceMs !== undefined) {
      const eventMs = new Date(parsed.timestamp).getTime();
      if (eventMs < filter.sinceMs) {
        continue;
      }
    }

    events.push(parsed);
  }

  return events;
}
