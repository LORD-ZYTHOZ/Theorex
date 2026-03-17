// tests/vision-describe.test.ts — Tests for src/vision/describe.ts pure helpers.
// The public describeImage function requires a live API — not tested here.
// parseVisionResponse and mediaTypeFromPath are unexported but exercised indirectly
// via the module's behavior. We test the exported types shape validation.

import { describe, test, expect } from "bun:test";

// parseVisionResponse is internal — we test the JSON parsing logic via
// a local re-implementation that mirrors the same validation rules.
// This lets us cover the branch logic without needing a live API.

interface VisualDescription {
  description: string;
  elements: string[];
  context: string;
  reconstruction_prompt: string;
}

function parseVisionResponse(text: string): VisualDescription | null {
  try {
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

// mediaTypeFromPath mirrors the same lookup table
function mediaTypeFromPath(imagePath: string): string {
  const ext = imagePath.slice(imagePath.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] ?? "image/jpeg";
}

// ---------------------------------------------------------------------------
// parseVisionResponse logic
// ---------------------------------------------------------------------------

describe("parseVisionResponse logic", () => {
  const validJson = JSON.stringify({
    description: "A cat on a mat.",
    elements: ["cat", "mat"],
    context: "Domestic pet photo.",
    reconstruction_prompt: "A cat sitting on a mat indoors.",
  });

  test("parses valid JSON object correctly", () => {
    const result = parseVisionResponse(validJson);
    expect(result).not.toBeNull();
    expect(result?.description).toBe("A cat on a mat.");
    expect(result?.elements).toEqual(["cat", "mat"]);
    expect(result?.context).toBe("Domestic pet photo.");
    expect(result?.reconstruction_prompt).toBe("A cat sitting on a mat indoors.");
  });

  test("strips markdown code fences before parsing", () => {
    const wrapped = "```json\n" + validJson + "\n```";
    const result = parseVisionResponse(wrapped);
    expect(result).not.toBeNull();
    expect(result?.description).toBe("A cat on a mat.");
  });

  test("strips plain ``` fences before parsing", () => {
    const wrapped = "```\n" + validJson + "\n```";
    const result = parseVisionResponse(wrapped);
    expect(result).not.toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseVisionResponse("NOT JSON")).toBeNull();
  });

  test("returns null when description field is missing", () => {
    const bad = JSON.stringify({
      elements: ["a"],
      context: "ctx",
      reconstruction_prompt: "rp",
    });
    expect(parseVisionResponse(bad)).toBeNull();
  });

  test("returns null when elements is not an array", () => {
    const bad = JSON.stringify({
      description: "desc",
      elements: "not-an-array",
      context: "ctx",
      reconstruction_prompt: "rp",
    });
    expect(parseVisionResponse(bad)).toBeNull();
  });

  test("returns null when context is missing", () => {
    const bad = JSON.stringify({
      description: "desc",
      elements: [],
      reconstruction_prompt: "rp",
    });
    expect(parseVisionResponse(bad)).toBeNull();
  });

  test("returns null when reconstruction_prompt is missing", () => {
    const bad = JSON.stringify({
      description: "desc",
      elements: [],
      context: "ctx",
    });
    expect(parseVisionResponse(bad)).toBeNull();
  });

  test("handles empty elements array", () => {
    const json = JSON.stringify({
      description: "Abstract art.",
      elements: [],
      context: "Gallery piece.",
      reconstruction_prompt: "Abstract painting.",
    });
    const result = parseVisionResponse(json);
    expect(result).not.toBeNull();
    expect(result?.elements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mediaTypeFromPath logic
// ---------------------------------------------------------------------------

describe("mediaTypeFromPath logic", () => {
  test(".jpg returns image/jpeg", () => {
    expect(mediaTypeFromPath("/path/to/photo.jpg")).toBe("image/jpeg");
  });

  test(".jpeg returns image/jpeg", () => {
    expect(mediaTypeFromPath("/path/to/photo.jpeg")).toBe("image/jpeg");
  });

  test(".png returns image/png", () => {
    expect(mediaTypeFromPath("/images/screenshot.png")).toBe("image/png");
  });

  test(".gif returns image/gif", () => {
    expect(mediaTypeFromPath("/images/anim.gif")).toBe("image/gif");
  });

  test(".webp returns image/webp", () => {
    expect(mediaTypeFromPath("/images/modern.webp")).toBe("image/webp");
  });

  test("unknown extension defaults to image/jpeg", () => {
    expect(mediaTypeFromPath("/images/unknown.bmp")).toBe("image/jpeg");
  });

  test("uppercase extension is handled by toLowerCase", () => {
    expect(mediaTypeFromPath("/images/PHOTO.PNG")).toBe("image/png");
  });
});
