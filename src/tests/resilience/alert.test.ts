import { describe, test, expect, beforeEach, mock } from "bun:test";
import { alertCritical, formatAlertMessage, resetRateLimiter } from "../../resilience/alert";
import type { ErrorEvent } from "../../resilience/types";

const makeEvent = (service: string, overrides?: Partial<ErrorEvent>): ErrorEvent => ({
  id: crypto.randomUUID(),
  service,
  category: "transient",
  severity: "critical",
  message: "all providers down",
  context: { affected: ["dispatch"] },
  timestamp: new Date().toISOString(),
  agent_id: "main",
  ...overrides,
});

describe("formatAlertMessage", () => {
  test("includes service name and message", () => {
    const msg = formatAlertMessage(makeEvent("lmstudio:8082"));
    expect(msg).toContain("lmstudio:8082");
    expect(msg).toContain("all providers down");
  });

  test("includes agent_id", () => {
    const msg = formatAlertMessage(makeEvent("grok", { agent_id: "horizon" }));
    expect(msg).toContain("horizon");
  });
});

describe("alertCritical", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  test("calls fetch with Telegram Bot API URL", async () => {
    const originalFetch = globalThis.fetch;
    let fetchedUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetchedUrl = typeof url === "string" ? url : url.toString();
      return new Response("ok");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    await alertCritical(makeEvent("lmstudio:8082"));
    expect(fetchedUrl).toContain("api.telegram.org/bottest-token/sendMessage");

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("rate-limits: second call within 5min is skipped", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response("ok");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    await alertCritical(makeEvent("same-svc"));
    await alertCritical(makeEvent("same-svc")); // should be rate-limited

    expect(callCount).toBe(1);

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("different services are rate-limited independently", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response("ok");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    await alertCritical(makeEvent("svc-a"));
    await alertCritical(makeEvent("svc-b"));

    expect(callCount).toBe(2);

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("does not throw when fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("network error");
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";

    // Should not throw
    await alertCritical(makeEvent("fail-svc"));

    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("skips silently when env vars missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    // Should not throw
    await alertCritical(makeEvent("no-env-svc"));
  });
});
