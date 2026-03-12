// family/ingest.ts — Ingest markdown files into an agent's private axon.
// Phase 6: AI Family Shared Layer — Semantic Memory
//
// Chunks files by H2 section (## heading) so co-occurrence edges are meaningful:
// concepts within the same section are related; concepts across sections are not.
//
// Falls back to whole-file processing if no H2 sections found.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { writeToAgent } from "./write";
import type { Config } from "../config";

/**
 * Strip markdown syntax from text before NLP processing.
 * Removes headings, bold/italic, backticks, bullets, tables, URLs.
 * Preserves the actual words so NLP extracts concepts cleanly.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")           // ## headings
    .replace(/\*\*(.+?)\*\*/g, "$1")        // **bold**
    .replace(/\*(.+?)\*/g, "$1")            // *italic*
    .replace(/`{1,3}[^`]*`{1,3}/g, "")     // `code` and ```blocks```
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [link](url) → link text
    .replace(/^[-*+]\s+/gm, "")            // - bullet points
    .replace(/^\d+\.\s+/gm, "")            // 1. numbered lists
    .replace(/^\|.+\|$/gm, "")             // | table rows |
    .replace(/^[-|:\s]+$/gm, "")           // table dividers
    .replace(/_(.+?)_/g, "$1")             // _italic_
    .replace(/~~(.+?)~~/g, "$1")           // ~~strikethrough~~
    .replace(/https?:\/\/\S+/g, "")        // URLs
    .replace(/\([^)]{0,40}\)/g, "")        // parentheticals like (200g protein / 2500 cal)
    .replace(/[|<>{}[\]]/g, "")            // remaining special chars
    .replace(/:\s*$/gm, "")               // trailing colons (section labels like "Health:")
    .replace(/[)]+/g, "")                  // orphaned closing parens like "cal)."
    .replace(/:\s*\n/g, "\n")             // trailing colons before newline
    .replace(/:\s*$/gm, "")              // trailing colons at end of line
    .replace(/\n+/g, ". ")               // newlines → sentence boundary for NLP
    .replace(/\.\s*\.\s*/g, ". ")        // collapse double periods
    .replace(/\s{2,}/g, " ")               // collapse multiple spaces
    .trim();
}

export interface IngestResult {
  readonly agentId: string;
  readonly filesProcessed: number;
  readonly sectionsProcessed: number;
  readonly conceptsAdded: number;
  readonly edgesAdded: number;
}

/**
 * Split markdown text into sections by H2 headings (## ...).
 * Each section includes its heading text as context.
 * If no H2 headings found, returns the whole text as one chunk.
 */
export function chunkBySection(text: string): readonly string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ") && current.length > 0) {
      const chunk = current.join("\n").trim();
      if (chunk) sections.push(chunk);
      current = [line];
    } else {
      current.push(line);
    }
  }

  const last = current.join("\n").trim();
  if (last) sections.push(last);

  return sections.length > 0 ? sections : [text.trim()];
}

/**
 * Ingest one or more markdown files into an agent's private axon.
 * Each file is chunked by H2 section — concepts within a section get
 * co-occurrence edges; concepts across sections do not.
 */
export async function ingestFiles(
  agentId: string,
  filePaths: readonly string[],
  config: Config,
  nowMs: number = Date.now(),
): Promise<IngestResult> {
  let sectionsProcessed = 0;
  let totalConceptsAdded = 0;
  let totalEdgesAdded = 0;
  let filesProcessed = 0;

  for (const filePath of filePaths) {
    let text: string;
    try {
      text = await readFile(filePath, "utf-8");
    } catch {
      console.warn(`  [ingest] Skipping unreadable file: ${filePath}`);
      continue;
    }

    const sections = chunkBySection(text);
    console.log(`  [ingest] ${basename(filePath)} — ${sections.length} section(s)`);

    for (const section of sections) {
      if (!section.trim()) continue;
      const result = await writeToAgent(agentId, stripMarkdown(section), config, nowMs);
      totalConceptsAdded += result.conceptsAdded;
      totalEdgesAdded += result.edgesAdded;
      sectionsProcessed++;
    }

    filesProcessed++;
  }

  return {
    agentId,
    filesProcessed,
    sectionsProcessed,
    conceptsAdded: totalConceptsAdded,
    edgesAdded: totalEdgesAdded,
  };
}
