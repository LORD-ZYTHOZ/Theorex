import { describe, expect, test } from "bun:test";
import {
  compress,
  stripHtmlTags,
  truncateUrls,
  stripNonAscii,
  collapseWhitespace,
  removeEmptyLines,
  stripMarkdownNoise,
  deduplicateRepeatedBlocks,
  compressToolsCall,
} from "./tokenjuice";

describe("TokenJuice compress", () => {
  test("returns original for empty string", () => {
    const r = compress("");
    expect(r.compressed).toBe("");
    expect(r.stats.ratio).toBe(1);
  });

  test("compresses HTML tags", () => {
    const r = compress("<p>Hello <b>world</b></p>");
    expect(r.compressed).toBe("Hello world");
    expect(r.stats.ratio).toBeLessThan(1);
  });

  test("truncates long URLs", () => {
    const longUrl = "https://github.com/tinyhumansai/openhuman/blob/main/docs/readme.md";
    const r = compress(longUrl);
    expect(r.compressed).toContain("github.com");
    expect(r.compressed.length).toBeLessThan(longUrl.length);
  });

  test("strips zero-width chars", () => {
    const r = compress("Hello\u200B\u200Fworld\uFEFF");
    expect(r.compressed).not.toContain("\u200B");
    expect(r.compressed).not.toContain("\u200F");
    expect(r.compressed).not.toContain("\uFEFF");
  });

  test("collapses consecutive spaces", () => {
    const r = compress("Hello    world");
    expect(r.compressed).not.toContain("    ");
  });

  test("removes empty lines", () => {
    const r = compress("Hello\n\n\n\nworld");
    expect(r.compressed).not.toContain("\n\n\n");
  });

  test("strips markdown bold/italic", () => {
    const r = compress("This is **bold** and *italic*");
    expect(r.compressed).toBe("This is bold and italic");
  });

  test("deduplicates repeated blocks", () => {
    const block = "[ColdStore] PRAGMA busy_timeout = 10000";
    const input = Array(5).fill(block).join("\n");
    const r = compress(input);
    expect(r.stats.bytesSaved).toBeGreaterThan(0);
  });

  test("reports correct stats", () => {
    const input = "<p>Hello world</p>";
    const r = compress(input);
    expect(r.stats.originalLength).toBe(input.length);
    expect(r.stats.compressedLength).toBe(r.compressed.length);
    expect(r.stats.bytesSaved).toBe(input.length - r.compressed.length);
  });
});

describe("stripMarkdownNoise", () => {
  test("keeps h1/h2 content", () => {
    const r = stripMarkdownNoise("# Hello World");
    expect(r).toBe("Hello World");
  });

  test("strips h3+ markers", () => {
    const r = stripMarkdownNoise("### Hello World");
    expect(r).not.toContain("###");
    expect(r).toContain("Hello World");
  });

  test("strips blockquotes", () => {
    const r = stripMarkdownNoise("> quoted text");
    expect(r).not.toContain(">");
  });

  test("strips horizontal rules", () => {
    const r = stripMarkdownNoise("---\ncontent\n---");
    expect(r).not.toContain("---");
  });
});

describe("truncateUrls", () => {
  test("passes through short URLs", () => {
    const url = "https://example.com";
    const r = truncateUrls(url);
    expect(r).toBe(url);
  });

  test("truncates long URLs", () => {
    const long = "https://github.com/tinyhumansai/openhuman/blob/main/docs/readme.md";
    const r = truncateUrls(long);
    expect(r.length).toBeLessThan(long.length);
    expect(r).toContain("github.com");
  });

  test("handles multiple URLs", () => {
    const input =
      "Check https://github.com/tinyhumansai/openhuman/blob/main/docs/readme.md " +
      "and https://github.com/NousResearch/hermes-agent/blob/main/README.md " +
      "for more.";
    const r = truncateUrls(input);
    // Both URLs should be truncated (each > 60 chars)
    expect(r).toContain("github.com");
    expect(r.length).toBeLessThan(input.length);
  });
});

describe("stripNonAscii", () => {
  test("normalizes unicode quotes to ASCII", () => {
    const r = stripNonAscii("\u201Chello\u201D");
    expect(r).toBe('"hello"');
  });

  test("strips zero-width chars", () => {
    const r = stripNonAscii("hello\u200Bworld");
    expect(r).not.toContain("\u200B");
    expect(r).toBe("helloworld");
  });
});

describe("compressToolsCall", () => {
  test("returns original on invalid JSON", () => {
    const r = compressToolsCall("not json");
    expect(r).toBe("not json");
  });

  test("keeps only name and argsHash", () => {
    const input = JSON.stringify([
      { name: "read", arguments: { path: "/tmp/test" } },
      { name: "write", arguments: { content: "hello" } },
    ]);
    const r = JSON.parse(compressToolsCall(input));
    expect(r).toEqual([
      { name: "read", argsHash: expect.any(String) },
      { name: "write", argsHash: expect.any(String) },
    ]);
  });

  test("handles empty array", () => {
    const r = compressToolsCall("[]");
    expect(JSON.parse(r)).toEqual([]);
  });
});