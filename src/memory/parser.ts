export interface MemorySection {
  readonly heading: string;   // e.g. "## System" (includes "## " prefix)
  readonly rawBody: string;   // everything between this heading and next, INCLUDING leading \n
}

export interface ParsedMemory {
  readonly preamble: string;  // everything before first "## " line
  readonly sections: readonly MemorySection[];
}

/**
 * Parses a MEMORY.md raw string into structured sections.
 *
 * Rules:
 * - Splits on lines starting with "## " (H2 boundary)
 * - Everything before the first "## " line is the preamble
 * - "### " H3 headers inside section bodies are preserved as raw body text (not split)
 * - rawBody includes the leading "\n" that follows the heading line
 *
 * Algorithm:
 * We find all positions in the string where a line starts with "## ".
 * A "line starting with ## " means: either at index 0 the string begins with "## ",
 * or the character at (pos-1) is "\n" and the character at pos is "## ".
 *
 * We collect the indices of each such boundary line's start and use substring
 * slicing to preserve the original bytes exactly — no join/split ambiguity.
 */
export function parseMemory(raw: string): ParsedMemory {
  if (raw === "") {
    return { preamble: "", sections: [] };
  }

  // Find all positions where a line starts with "## "
  const boundaryPositions: number[] = [];

  // Check if the file starts with "## "
  if (raw.startsWith("## ")) {
    boundaryPositions.push(0);
  }

  // Scan for "\n## " patterns
  let searchFrom = 0;
  while (true) {
    const idx = raw.indexOf("\n## ", searchFrom);
    if (idx === -1) break;
    // The boundary line starts at idx + 1 (after the newline)
    boundaryPositions.push(idx + 1);
    searchFrom = idx + 1;
  }

  if (boundaryPositions.length === 0) {
    // No H2 sections — entire content is preamble
    return { preamble: raw, sections: [] };
  }

  const preamble = raw.slice(0, boundaryPositions[0]);
  const sections: MemorySection[] = [];

  for (let i = 0; i < boundaryPositions.length; i++) {
    const sectionStart = boundaryPositions[i];
    const sectionEnd = i + 1 < boundaryPositions.length
      ? boundaryPositions[i + 1]
      : raw.length;

    const sectionContent = raw.slice(sectionStart, sectionEnd);
    // The heading is the first line (up to but not including the first "\n")
    const newlineIdx = sectionContent.indexOf("\n");
    const heading = newlineIdx === -1 ? sectionContent : sectionContent.slice(0, newlineIdx);
    const rawBody = newlineIdx === -1 ? "" : sectionContent.slice(newlineIdx);

    sections.push({ heading, rawBody });
  }

  return { preamble, sections };
}

/**
 * Reconstructs a raw MEMORY.md string from a ParsedMemory.
 *
 * HARD GATE: serializeMemory(parseMemory(raw)) === raw must be byte-identical.
 *
 * The join("") separator is intentional — the preamble ends exactly where the
 * first section begins, and each section's rawBody ends exactly where the next
 * section begins (or at end of file). No separators needed.
 */
export function serializeMemory(parsed: ParsedMemory): string {
  return [
    parsed.preamble,
    ...parsed.sections.map((s) => s.heading + s.rawBody),
  ].join("");
}
