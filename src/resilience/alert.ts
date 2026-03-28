// src/resilience/alert.ts — Telegram escalation for critical errors.
// Raw Bot API fetch. Rate-limited per ServiceId (5 min cooldown).
// Never throws — alerting must not crash the system.

import type { ErrorEvent, ServiceId } from "./types";

// ---------------------------------------------------------------------------
// Rate limiter — in-memory, resets on process restart (acceptable)
// ---------------------------------------------------------------------------

const lastSent = new Map<ServiceId, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function isRateLimited(service: ServiceId): boolean {
  const last = lastSent.get(service);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_MS;
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

export function formatAlertMessage(event: ErrorEvent): string {
  return [
    `⚠️ CRITICAL: ${event.service} down`,
    `Agent: ${event.agent_id}`,
    `Message: ${event.message}`,
    `Time: ${event.timestamp}`,
    event.context && Object.keys(event.context).length > 0
      ? `Context: ${JSON.stringify(event.context)}`
      : null,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Send alert
// ---------------------------------------------------------------------------

export async function alertCritical(event: ErrorEvent): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) return; // silently skip if not configured

    if (isRateLimited(event.service)) return;

    const text = formatAlertMessage(event);

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    lastSent.set(event.service, Date.now());
  } catch {
    // Alerting must never crash the system
  }
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function resetRateLimiter(): void {
  lastSent.clear();
}
