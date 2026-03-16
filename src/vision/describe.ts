// vision/describe.ts — Extract structured description from an image using a vision model (Phase 10).
//
// Priority:
//   1. Anthropic Claude API (if ANTHROPIC_API_KEY is set)
//   2. Local LM Studio multimodal endpoint (if config.visionEndpoint is set)
//
// Both return the same VisualDescription shape — callers are model-agnostic.
//
// INVARIANTS:
//   - Never stores raw pixels — only structured description
//   - Returns null (not throws) on API error so ingest can handle gracefully

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualDescription {
  readonly description: string;          // one-paragraph overview
  readonly elements: readonly string[];  // key visual elements identified
  readonly context: string;              // inferred purpose or use context
  readonly reconstruction_prompt: string; // compact prompt to reason about image later
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mediaTypeFromPath(imagePath: string): ImageMediaType {
  const ext = extname(imagePath).toLowerCase();
  const map: Record<string, ImageMediaType> = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] ?? "image/jpeg";
}

const EXTRACTION_PROMPT = `Analyze this image and respond with ONLY a valid JSON object — no markdown, no explanation:
{
  "description": "one paragraph overview of what this image shows",
  "elements": ["array", "of", "key", "visual", "elements", "or", "subjects"],
  "context": "inferred purpose or context — what is this image about or used for",
  "reconstruction_prompt": "compact prompt (1-2 sentences) to reconstruct or reason about this image later"
}`;

function parseVisionResponse(text: string): VisualDescription | null {
  try {
    // Strip any markdown code fences if model wrapped the JSON
    const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<VisualDescription>;
    if (
      typeof parsed.description !== "string" ||
      !Array.isArray(parsed.elements) ||
      typeof parsed.context !== "string" ||
      typeof parsed.reconstruction_prompt !== "string"
    ) {
      return null;
    }
    return {
      description: parsed.description,
      elements: parsed.elements as string[],
      context: parsed.context,
      reconstruction_prompt: parsed.reconstruction_prompt,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Anthropic Claude API
// ---------------------------------------------------------------------------

async function describeWithAnthropic(
  base64: string,
  mediaType: ImageMediaType,
  model: string,
): Promise<VisualDescription | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const body = {
    model,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        },
        { type: "text", text: EXTRACTION_PROMPT },
      ],
    }],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;

  const data = await response.json() as { content?: { type: string; text: string }[] };
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) return null;

  return parseVisionResponse(textBlock.text);
}

// ---------------------------------------------------------------------------
// Local LM Studio (OpenAI-compat multimodal)
// ---------------------------------------------------------------------------

async function describeWithLMStudio(
  base64: string,
  mediaType: ImageMediaType,
  endpoint: string,
  model: string,
): Promise<VisualDescription | null> {
  const body = {
    model,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
        { type: "text", text: EXTRACTION_PROMPT },
      ],
    }],
  };

  const base = endpoint.replace(/\/$/, "");
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  return parseVisionResponse(content);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a structured description from an image file.
 * Tries Anthropic API first, then local LM Studio.
 * Returns null if both are unavailable or fail.
 */
export async function describeImage(
  imagePath: string,
  config: Config,
): Promise<VisualDescription | null> {
  const bytes = await readFile(imagePath);
  const base64 = bytes.toString("base64");
  const mediaType = mediaTypeFromPath(imagePath);

  // 1. Try Anthropic API
  const anthropicResult = await describeWithAnthropic(base64, mediaType, config.visionModel).catch(() => null);
  if (anthropicResult) return anthropicResult;

  // 2. Try local LM Studio multimodal
  if (config.visionEndpoint) {
    const localResult = await describeWithLMStudio(base64, mediaType, config.visionEndpoint, config.visionModel).catch(() => null);
    if (localResult) return localResult;
  }

  return null;
}
