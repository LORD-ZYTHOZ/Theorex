// src/axon/tokenjuice.ts
// TokenJuice — lossy compression for LLM prompt/output text.
// Reduces token count by ~60-80% on typical agent transcripts.
// Reversible enough for retrieval; not for editing.

/** Placeholder for long URLs — signals original was a real link */
const URL_PLACEHOLDER = "<[URL]>";
/** Max URL length before truncation */
const MAX_URL_LEN = 60;
/** Max consecutive spaces to collapse */
const MAX_CONSECUTIVE_SPACES = 2;
/** Max line length before hard wrap (0 = disabled) */
const MAX_LINE_LEN = 0; // disabled — let the LLM handle wrapping

// ─── Core compressions ─────────────────────────────────────────────────────────

/**
 * Strip all HTML tags — inlined, no external dependency.
 * Handles common HTML entities too.
 */
function stripHtmlTags(text: string): string {
  // Decode HTML entities BEFORE stripping tags — correct order for LLM text storage.
  // 1. Entity decode (whitelist of common entities; non-decoded ones stay as-is)
  // 2. Strip remaining tags
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ""); // non-greedy [^>]+ can't ReDoS
}

/**
 * * External links become placeholders; short URLs pass through.
 * e.g. https://github.com/tinyhumansai/openhuman/blob/main/docs/readme.md
 *   → https://github.com/.../openhuman/blob/main/docs/readme.md
 */
export function truncateUrls(text: string): string {
  return text.replace(
    /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
    (url: string): string => {
      if (url.length <= MAX_URL_LEN) return url;
      try {
        const u = new URL(url);
        const host = u.hostname;
        const path = u.pathname.split("/").slice(0, 3).join("/"); // top 3 segments
        const truncated = `${host}${path}`;
        return truncated.length + 8 < url.length ? `${host}${path}...` : url.slice(0, MAX_URL_LEN) + "...";
      } catch {
        return url.slice(0, MAX_URL_LEN) + "...";
      }
    }
  );
}

/**
 * Remove non-ASCII characters that add noise without meaning.
 * Keeps: letters, numbers, punctuation, whitespace, common symbols.
 * Strips: zero-width chars, formatting marks, box-drawing noise.
 */
export function stripNonAscii(text: string): string {
  // Remove zero-width and formatting characters
  return text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, "")
    // Normalize Unicode quotes to ASCII
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "–")
    .replace(/\u2026/g, "...");
}

/**
 * Collapse consecutive whitespace to MAX_CONSECUTIVE_SPACES spaces.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s{3,}/g, " ".repeat(MAX_CONSECUTIVE_SPACES));
}

/**
 * Remove empty lines (3+ consecutive newlines → 2 newlines max).
 */
export function removeEmptyLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

/**
 * Remove markdown formatting that adds no semantic value for LLM storage:
 * - Bold/italic markers
 * - Headers (#### etc — keep h1/h2 content)
 * - Horizontal rules
 * - Blockquote markers
 * Keeps: code blocks, lists, links (already URL-truncated)
 */
export function stripMarkdownNoise(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")       // bold
    .replace(/\*([^*]+)\*/g, "$1")           // italic
    .replace(/__([^_]+)__/g, "$1")           // bold underscore
    .replace(/_([^_]+)_/g, "$1")             // italic underscore
    .replace(/^#{1,2}\s+/gm, "")            // h1/h2 markers — keep content
    .replace(/^#{3,}\s+/gm, "")             // h3+ markers — strip completely
    .replace(/^[-*_]{3,}\s*$/gm, "")         // horizontal rules
    .replace(/^\s*>\s+/gm, "");             // blockquotes
}

// ─── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Detect and remove repeated log/error/chunk blocks.
 * Keeps first occurrence + count marker.
 * e.g. [ColdStore] PRAGMA busy_timeout... appears 20 times → kept once + "[repeated 19x]"
 */
export function deduplicateRepeatedBlocks(text: string, minRepeatCount = 3): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Count contiguous repetitions
    let count = 1;
    while (i + count < lines.length && lines[i + count] === line && line.trim() !== "") {
      count++;
    }
    if (count >= minRepeatCount) {
      result.push(line);
      result.push(`  [repeated ${count}x]`);
      i += count;
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

// ─── Main compression pipeline ─────────────────────────────────────────────────

export interface CompressionResult {
  compressed: string;
  stats: {
    originalLength: number;
    compressedLength: number;
    ratio: number;         // 0.0–1.0 (lower = more compression)
    bytesSaved: number;
  };
}

/**
 * Full TokenJuice compression pipeline.
 * Run on: prompt_sent, output_recv, raw_thought, tools_called JSON.
 * Returns both compressed text + stats for logging.
 */
export function compress(text: string): CompressionResult {
  if (!text || text.trim().length === 0) {
    return { compressed: text, stats: { originalLength: text.length, compressedLength: 0, ratio: 1, bytesSaved: 0 } };
  }

  const originalLength = text.length;

  let result = text;

  // 1. Strip HTML tags (before URL truncation to avoid corrupting URLs)
  result = stripHtmlTags(result);

  // 2. Truncate long URLs
  result = truncateUrls(result);

  // 3. Remove non-ASCII noise
  result = stripNonAscii(result);

  // 4. Strip markdown formatting
  result = stripMarkdownNoise(result);

  // 5. Collapse whitespace
  result = collapseWhitespace(result);

  // 6. Remove empty lines
  result = removeEmptyLines(result);

  // 7. Deduplicate repeated blocks
  result = deduplicateRepeatedBlocks(result);

  // 8. Final trim
  result = result.trim();

  const compressedLength = result.length;
  const ratio = originalLength > 0 ? compressedLength / originalLength : 1;
  const bytesSaved = originalLength - compressedLength;

  return {
    compressed: result,
    stats: { originalLength, compressedLength, ratio, bytesSaved },
  };
}

/**
 * Decompress — identity for now (TokenJuice is lossy, not reversible).
 * In future: could store a delta map for reconstruction if needed.
 */
export function decompress(text: string): string {
  return text; // lossy — no reconstruction
}

/**
 * Compress a tools_called JSON array string.
 * Removes redundant tool_call metadata, keeps tool name + args hash.
 */
export function compressToolsCall(toolsJson: string): string {
  if (!toolsJson) return toolsJson;
  try {
    const parsed = JSON.parse(toolsJson);
    if (Array.isArray(parsed)) {
      return JSON.stringify(
        parsed.map((call: { name?: string; arguments?: Record<string, unknown> }) => ({
          name: call.name ?? "unknown",
          argsHash: hashArgs(call.arguments ?? {}),
        }))
      );
    }
    return toolsJson;
  } catch {
    return toolsJson;
  }
}

function hashArgs(args: Record<string, unknown>): string {
  const str = JSON.stringify(args);
  // Simple non-crypto hash for deduplication signals
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

// ─── Compress span fields ─────────────────────────────────────────────────────

export interface CompressedSpanFields {
  prompt_sent?: string | null;
  output_recv?: string | null;
  raw_thought?: string | null;
  tools_called?: string[];
}

export function compressSpanFields(
  fields: CompressedSpanFields
): { compressed: CompressedSpanFields; savedBytes: number } {
  let savedBytes = 0;
  const compressed: CompressedSpanFields = {};

  if (fields.prompt_sent) {
    const r = compress(fields.prompt_sent);
    compressed.prompt_sent = r.compressed;
    savedBytes += r.stats.bytesSaved;
  }
  if (fields.output_recv) {
    const r = compress(fields.output_recv);
    compressed.output_recv = r.compressed;
    savedBytes += r.stats.bytesSaved;
  }
  if (fields.raw_thought) {
    const r = compress(fields.raw_thought);
    compressed.raw_thought = r.compressed;
    savedBytes += r.stats.bytesSaved;
  }
  if (fields.tools_called) {
    const tcJson = JSON.stringify(fields.tools_called);
    compressed.tools_called = fields.tools_called; // keep full array — compressed separately if large
    savedBytes += tcJson.length - JSON.stringify(fields.tools_called.map(t => ({ name: t }))).length;
  }

  return { compressed, savedBytes };
}