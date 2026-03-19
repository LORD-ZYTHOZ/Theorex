// temporal/context.ts — Build a human-contextual temporal awareness node.
// Phase 14: AI-native time — not a clock for meetings, a gap detector and human-context reader.
// Every interaction carries a timecode. Gap = silence = elapsed human time.
//
// Phase 14b (market sessions): adds active/upcoming trading session awareness.
// Sessions computed in UTC and mapped to human-readable labels.

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

export type MarketSessionName =
  | "sydney"    // 22:00–07:00 UTC
  | "tokyo"     // 00:00–06:00 UTC
  | "london"    // 08:00–17:00 UTC
  | "new_york"; // 13:00–22:00 UTC

export interface MarketSession {
  readonly name: MarketSessionName;
  readonly label: string;       // e.g. "London"
  readonly status: "open" | "overlap"; // open = active, overlap = two sessions active
  readonly opens_in_min: number | null; // null if already open
  readonly closes_in_min: number | null; // null if not open
}

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
  readonly market_sessions: readonly MarketSession[]; // active or upcoming within 2h
}

// ---------------------------------------------------------------------------
// Market session windows (UTC hours)
// ---------------------------------------------------------------------------

interface SessionWindow {
  readonly name: MarketSessionName;
  readonly label: string;
  readonly openUtcHour: number;  // 0–23
  readonly closeUtcHour: number; // 0–23 (if < openUtcHour, wraps midnight)
}

const SESSION_WINDOWS: readonly SessionWindow[] = [
  { name: "sydney",   label: "Sydney",   openUtcHour: 22, closeUtcHour: 7  },
  { name: "tokyo",    label: "Tokyo",    openUtcHour: 0,  closeUtcHour: 6  },
  { name: "london",   label: "London",   openUtcHour: 8,  closeUtcHour: 17 },
  { name: "new_york", label: "New York", openUtcHour: 13, closeUtcHour: 22 },
] as const;

/** Is utcHour inside [openH, closeH) with midnight wrap support? */
function isInWindow(utcHour: number, openH: number, closeH: number): boolean {
  if (openH < closeH) {
    return utcHour >= openH && utcHour < closeH;
  }
  // Wraps midnight: open in evening, closes in morning
  return utcHour >= openH || utcHour < closeH;
}

/** Minutes until openH from current utcHour (0–1439). */
function minutesUntilOpen(utcMinuteOfDay: number, openH: number): number {
  const openMin = openH * 60;
  const diff = openMin - utcMinuteOfDay;
  return diff > 0 ? diff : diff + 1440; // wrap 24h
}

/** Minutes until closeH from current utcHour (0–1439). */
function minutesUntilClose(utcMinuteOfDay: number, closeH: number): number {
  const closeMin = closeH * 60;
  const diff = closeMin - utcMinuteOfDay;
  return diff > 0 ? diff : diff + 1440;
}

/**
 * Compute active and upcoming market sessions from a UTC hour + minute.
 * Returns sessions that are either currently open or open within the next 2 hours.
 */
export function computeMarketSessions(utcHour: number, utcMinute: number = 0): MarketSession[] {
  const utcMinuteOfDay = utcHour * 60 + utcMinute;
  const UPCOMING_WINDOW_MIN = 120; // show sessions opening within 2h

  const active: MarketSession[] = [];
  const openNames = new Set<MarketSessionName>();

  // First pass: identify open sessions
  for (const w of SESSION_WINDOWS) {
    if (isInWindow(utcHour, w.openUtcHour, w.closeUtcHour)) {
      openNames.add(w.name);
    }
  }

  // Second pass: build MarketSession objects
  for (const w of SESSION_WINDOWS) {
    const isOpen = openNames.has(w.name);

    if (isOpen) {
      // Determine if this is an overlap (two sessions open simultaneously)
      // London/NY overlap: 13:00–17:00 UTC is the key volatility window
      const overlapPartner = isOpen && openNames.size > 1;
      active.push({
        name: w.name,
        label: w.label,
        status: overlapPartner ? "overlap" : "open",
        opens_in_min: null,
        closes_in_min: minutesUntilClose(utcMinuteOfDay, w.closeUtcHour),
      });
    } else {
      // Not open — check if opening within 2 hours
      const minsUntil = minutesUntilOpen(utcMinuteOfDay, w.openUtcHour);
      if (minsUntil <= UPCOMING_WINDOW_MIN) {
        active.push({
          name: w.name,
          label: w.label,
          status: "open", // will be open — we call it open for display
          opens_in_min: minsUntil,
          closes_in_min: null,
        });
      }
    }
  }

  return active;
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

  // Market sessions — from current UTC time
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const market_sessions = computeMarketSessions(utcHour, utcMinute);

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
    market_sessions,
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

  // Market sessions — only emit if any are active or upcoming
  if (ctx.market_sessions.length > 0) {
    const sessionParts: string[] = [];
    for (const s of ctx.market_sessions) {
      if (s.opens_in_min !== null) {
        sessionParts.push(`${s.label} opens in ${s.opens_in_min}m`);
      } else if (s.closes_in_min !== null) {
        const tag = s.status === "overlap" ? " [OVERLAP]" : "";
        sessionParts.push(`${s.label} open, closes in ${s.closes_in_min}m${tag}`);
      }
    }
    if (sessionParts.length > 0) {
      lines.push(`Markets: ${sessionParts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}
