// temporal/context.ts — Build a human-contextual temporal awareness node.
// Phase 14: AI-native time — not a clock for meetings, a gap detector and human-context reader.
// Every interaction carries a timecode. Gap = silence = elapsed human time.

import { loadTemporalRecord, saveTemporalRecord } from "./store";
import type { TemporalRecord } from "./store";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeOfDay = "dawn" | "morning" | "afternoon" | "evening" | "night" | "late_night";

export type GapType =
  | "first_session"   // no prior interaction recorded
  | "continuous"      // < 5 minutes — same thought stream
  | "short_break"     // 5–60 minutes — stepped away briefly
  | "long_break"      // 1–5 hours — multi-hour gap
  | "sleep"           // 5–14 hours — human likely slept
  | "days"            // 1–7 days
  | "weeks";          // > 7 days

export type WorkContext =
  | "early_morning"   // 05:00–08:59
  | "work_hours"      // 09:00–17:59
  | "after_hours"     // 18:00–21:59
  | "late_night";     // 22:00–04:59

export interface TemporalContext {
  readonly current_time: string;       // ISO 8601
  readonly timezone: string;           // IANA e.g. "Australia/Sydney"
  readonly utc_offset_minutes: number; // e.g. -660 for UTC+11 (JS convention: negative = ahead)
  readonly location: string;           // from config e.g. "Sydney"
  readonly day_of_week: string;        // "Monday"
  readonly date: string;               // "2026-03-16"
  readonly hour: number;               // local hour 0–23
  readonly time_of_day: TimeOfDay;
  readonly work_context: WorkContext;
  readonly gap_ms: number | null;      // ms since last interaction, null = first session
  readonly gap_human: string;          // human-readable e.g. "8h 45m" or "first session"
  readonly gap_type: GapType;
  readonly session_count: number;      // total sessions including this one
  readonly reorientation_needed: boolean; // true if gap >= long_break
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function classifyTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8)  return "dawn";
  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 20) return "evening";
  if (hour >= 20 && hour < 23) return "night";
  return "late_night"; // 23:00–04:59
}

function classifyWorkContext(hour: number, dayOfWeek: string): WorkContext {
  const isWeekend = dayOfWeek === "Saturday" || dayOfWeek === "Sunday";
  if (isWeekend || hour < 5 || hour >= 22) return "late_night";
  if (hour >= 5 && hour < 9) return "early_morning";
  if (hour >= 9 && hour < 18) return "work_hours";
  if (hour >= 18 && hour < 22) return "after_hours";
  return "late_night";
}

function classifyGap(gapMs: number | null): GapType {
  if (gapMs === null) return "first_session";
  const minutes = gapMs / 60_000;
  if (minutes < 5) return "continuous";
  if (minutes < 60) return "short_break";
  const hours = minutes / 60;
  if (hours < 5) return "long_break";
  if (hours < 14) return "sleep";
  const days = hours / 24;
  if (days < 7) return "days";
  return "weeks";
}

function formatGapHuman(gapMs: number | null): string {
  if (gapMs === null) return "first session";
  const totalSecs = Math.floor(gapMs / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const totalMins = Math.floor(totalSecs / 60);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build a TemporalContext for the current moment.
 * Loads prior record, computes gap, then saves updated record.
 * Errors during save are swallowed — context is still returned.
 */
export async function buildTemporalContext(config: Config): Promise<TemporalContext> {
  const now = new Date();
  const nowMs = now.getTime();
  const currentIso = now.toISOString();

  // Timezone from Intl (IANA format)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // UTC offset in minutes (JS: getTimezoneOffset() returns negative for UTC+ zones)
  const utcOffsetMinutes = now.getTimezoneOffset();

  // Local time components
  const localDate = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  }).formatToParts(now);

  const getPart = (type: string) => localDate.find((p) => p.type === type)?.value ?? "";

  const dayOfWeek = getPart("weekday");
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const dateStr = `${year}-${month}-${day}`;
  const hour = parseInt(getPart("hour"), 10);

  // Gap detection
  let priorRecord: TemporalRecord | null = null;
  try {
    priorRecord = await loadTemporalRecord(config.temporalStorePath);
  } catch {
    // First session or unreadable — treat as null
  }

  const gapMs = priorRecord ? nowMs - new Date(priorRecord.last_interaction).getTime() : null;
  const gapType = classifyGap(gapMs);
  const sessionCount = (priorRecord?.session_count ?? 0) + 1;

  // Save updated record (non-blocking — errors swallowed)
  const newRecord: TemporalRecord = {
    last_interaction: currentIso,
    session_count: sessionCount,
  };
  saveTemporalRecord(config.temporalStorePath, newRecord).catch(() => {});

  return {
    current_time: currentIso,
    timezone,
    utc_offset_minutes: utcOffsetMinutes,
    location: config.location,
    day_of_week: dayOfWeek,
    date: dateStr,
    hour,
    time_of_day: classifyTimeOfDay(hour),
    work_context: classifyWorkContext(hour, dayOfWeek),
    gap_ms: gapMs,
    gap_human: formatGapHuman(gapMs),
    gap_type: gapType,
    session_count: sessionCount,
    reorientation_needed: gapType === "long_break" || gapType === "sleep" || gapType === "days" || gapType === "weeks",
  };
}

/**
 * Format TemporalContext as injection text for boot context.
 * Human-readable but AI-optimised — annotated, not a calendar.
 */
export function formatTemporalContext(ctx: TemporalContext): string {
  const lines: string[] = [];

  // JS getTimezoneOffset() returns negative for UTC+ zones (e.g. UTC+11 → -660).
  // Invert: negative offset_minutes means we are AHEAD of UTC → display "+"
  const utcSign = ctx.utc_offset_minutes < 0 ? "+" : "-";
  const utcAbs = Math.abs(ctx.utc_offset_minutes);
  const utcHours = Math.floor(utcAbs / 60);
  const utcLabel = `UTC${utcSign}${utcHours}`;

  const locationPart = ctx.location ? ` | ${ctx.location}` : "";

  lines.push("=== THEOREX TEMPORAL CONTEXT ===");
  lines.push(`Time: ${ctx.day_of_week} ${ctx.date} ${String(ctx.hour).padStart(2, "0")}:xx ${ctx.timezone} (${utcLabel}) — ${ctx.time_of_day}${locationPart}`);
  lines.push(`Gap: ${ctx.gap_human} since last interaction [${ctx.gap_type}]`);
  lines.push(`Session: #${ctx.session_count} | Work context: ${ctx.work_context}`);

  if (ctx.reorientation_needed) {
    lines.push("Note: Significant time has passed — reorient before diving in.");
  }

  if (ctx.gap_type === "sleep") {
    lines.push("Human likely slept. New day energy. Don't assume mid-thought continuity.");
  } else if (ctx.gap_type === "days") {
    lines.push("Days have passed. World may have changed. Verify assumptions.");
  } else if (ctx.gap_type === "weeks") {
    lines.push("Weeks since last session. Full context reset recommended.");
  } else if (ctx.gap_type === "continuous") {
    lines.push("Continuous session — same thought stream.");
  }

  if (ctx.work_context === "late_night") {
    lines.push("Late night session — keep responses tight, respect their time.");
  } else if (ctx.work_context === "after_hours") {
    lines.push("After hours — personal/project time, not work time.");
  }

  return lines.join("\n");
}
