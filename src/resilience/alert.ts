// src/resilience/alert.ts — Telegram escalation for critical errors.
// Raw Bot API fetch. Rate-limited per ServiceId (5 min cooldown).
// Never throws — alerting must not crash the system.

import type { ErrorEvent, ServiceId } from "./types";

// ---------------------------------------------------------------------------
// Rate limiter + deduplication — in-memory, resets on process restart (acceptable)
// ---------------------------------------------------------------------------

// Track last sent message hashes to avoid duplicates
const lastSent = new Map<ServiceId, number>();
const lastMessageHashes = new Map<string, boolean>(); // Store hashes of messages
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HASH_SIZE = 1000; // Prevent unbounded growth

function isRateLimitedOrDuplicate(service: ServiceId, messageHash: string): boolean {
  // Check duplicate first — exact content match wins over rate limit
  if (lastMessageHashes.has(messageHash)) return true;

  // Check rate limit
  const last = lastSent.get(service);
  if (last && Date.now() - last < RATE_LIMIT_MS) return true;

  return false;
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

    const text = formatAlertMessage(event);
    const messageHash = JSON.stringify({
      service: event.service,
      agent_id: event.agent_id,
      message: event.message,
    });

    if (isRateLimitedOrDuplicate(event.service, messageHash)) return;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (lastMessageHashes.size >= MAX_HASH_SIZE) lastMessageHashes.clear();
    lastSent.set(event.service, Date.now());
    lastMessageHashes.set(messageHash, true);
  } catch {
    // Alerting must never crash the system
  }
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function resetRateLimiter(): void {
  lastSent.clear();
  lastMessageHashes.clear();
}
