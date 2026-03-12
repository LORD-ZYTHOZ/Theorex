// src/short-term/graduate.ts — Graduation logic: detect 7+ consecutive active days
// and promote short-term entries to MEMORY.md long-term storage.
//
// Key invariants:
// - NEVER mutate ParsedMemory sections in-place — always create new objects via spread
// - Uses writeMemoryAtomic for atomic MEMORY.md writes (no partial writes)
// - Idempotent: running twice does not create duplicate sections

import { parseMemory, serializeMemory, type ParsedMemory, type MemorySection } from "../memory/parser.ts";
import { readMemory, writeMemoryAtomic } from "../memory/writer.ts";
import type { ShortTermEntry } from "./store.ts";
import { appendAuditEvent } from "../audit/logger";

const GRADUATES_HEADING = "## Short-Term Graduates";

/**
 * Returns true if the given iterable of YYYY-MM-DD date strings contains
 * a run of at least minDays consecutive calendar days.
 *
 * Pure function, no I/O.
 */
export function hasConsecutiveRun(dateStrings: Iterable<string>, minDays: number): boolean {
  const sorted = Array.from(dateStrings).sort();
  if (sorted.length < minDays) return false;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]! + "T00:00:00Z");
    const curr = new Date(sorted[i]! + "T00:00:00Z");
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
    if (diffDays === 1) {
      run++;
    } else {
      run = 1;
    }
    if (run >= minDays) return true;
  }
  return run >= minDays;
}

/**
 * Returns entries whose concept_id has appeared on at least minDays (default 7)
 * consecutive calendar days. Returns the most-recent entry for each qualifying concept.
 */
export async function findGraduateCandidates(
  entries: ShortTermEntry[],
  minDays = 7
): Promise<ShortTermEntry[]> {
  // Group unique dates by concept_id
  const byConceptId = new Map<number, Set<string>>();
  for (const entry of entries) {
    const existing = byConceptId.get(entry.concept_id) ?? new Set<string>();
    existing.add(entry.date);
    byConceptId.set(entry.concept_id, existing);
  }

  const candidates: ShortTermEntry[] = [];
  for (const [conceptId, dates] of byConceptId) {
    if (!hasConsecutiveRun(dates, minDays)) continue;
    // Most-recent entry by ISO timestamp (lexicographic sort is sufficient for ISO 8601)
    const latest = entries
      .filter(e => e.concept_id === conceptId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    if (latest) candidates.push(latest);
  }
  return candidates;
}

/**
 * Writes each candidate as a "### ConceptName" subsection under
 * "## Short-Term Graduates" in the MEMORY.md at memoryPath.
 *
 * Idempotent: if a subsection heading already exists it is skipped.
 * Uses writeMemoryAtomic — never writes a partial file.
 * No-op if candidates is empty.
 */
export async function graduateToLongTerm(
  candidates: ShortTermEntry[],
  memoryPath: string
): Promise<void> {
  if (candidates.length === 0) return;

  const raw = await readMemory(memoryPath);
  const parsed = parseMemory(raw);

  let updated = parsed;
  for (const candidate of candidates) {
    updated = addGraduateSection(updated, candidate);
  }

  await writeMemoryAtomic(memoryPath, serializeMemory(updated));

  for (const candidate of candidates) {
    void appendAuditEvent({
      type: "graduation",
      timestamp: new Date().toISOString(),
      source: "graduate",
      surface_form: candidate.surface_form,
      concept_id: candidate.concept_id,
    }).catch(() => {});
  }
}

/**
 * Immutably adds a graduate subsection for the given entry to ParsedMemory.
 * Returns the same object reference if the subsection already exists (idempotent).
 */
function addGraduateSection(parsed: ParsedMemory, entry: ShortTermEntry): ParsedMemory {
  const subsectionHeading = `### ${entry.surface_form}`;
  const subsectionBody = `\nGraduated from short-term on ${entry.date}. Composite score: ${entry.composite_score.toFixed(3)}. Source weight: ${entry.source_weight}.\n`;

  const existingGraduatesIdx = parsed.sections.findIndex(s => s.heading === GRADUATES_HEADING);

  if (existingGraduatesIdx === -1) {
    // No graduates section yet — create one with this subsection
    const newSection: MemorySection = {
      heading: GRADUATES_HEADING,
      rawBody: `\n${subsectionHeading}${subsectionBody}`,
    };
    return {
      ...parsed,
      sections: [...parsed.sections, newSection],
    };
  }

  // Graduates section exists — check idempotency
  const graduatesSection = parsed.sections[existingGraduatesIdx]!;
  if (graduatesSection.rawBody.includes(subsectionHeading)) {
    return parsed; // Already graduated — no mutation
  }

  // Append new subsection to existing graduates section (immutable update)
  const updatedSection: MemorySection = {
    ...graduatesSection,
    rawBody: graduatesSection.rawBody + `${subsectionHeading}${subsectionBody}`,
  };
  const updatedSections = parsed.sections.map((s, i) =>
    i === existingGraduatesIdx ? updatedSection : s
  );
  return { ...parsed, sections: updatedSections };
}
