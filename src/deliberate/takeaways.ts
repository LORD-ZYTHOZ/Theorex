// deliberate/takeaways.ts — Extracts structured takeaways from orchestrator JSON output.

/** A single validated takeaway from the orchestrator response. */
export interface Takeaway {
  readonly insight: string;
  readonly test_condition: string | null;
  readonly engines_involved: ReadonlyArray<string>;
  readonly confidence: number;
}

const MIN_CONFIDENCE = 0.3;

/**
 * Parse orchestrator JSON response and extract validated takeaways.
 * Returns an empty array on malformed JSON, missing fields, or absent key.
 * Filters out entries below the minimum confidence threshold (0.3).
 */
export function extractTakeaways(
  orchestratorResponse: string,
): ReadonlyArray<Takeaway> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(orchestratorResponse);
  } catch {
    return [];
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("takeaways" in parsed)
  ) {
    return [];
  }

  const raw = (parsed as Record<string, unknown>).takeaways;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<ReadonlyArray<Takeaway>>((acc, item) => {
    if (!isValidTakeaway(item)) {
      return acc;
    }
    if (item.confidence < MIN_CONFIDENCE) {
      return acc;
    }
    const takeaway: Takeaway = {
      insight: item.insight,
      test_condition:
        typeof item.test_condition === "string" ? item.test_condition : null,
      engines_involved: Object.freeze([...item.engines_involved]),
      confidence: item.confidence,
    };
    return [...acc, takeaway];
  }, []);
}

/** Type guard: validates a raw value has the required takeaway shape. */
function isValidTakeaway(
  value: unknown,
): value is {
  insight: string;
  test_condition: string | null;
  engines_involved: string[];
  confidence: number;
} {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.insight !== "string") {
    return false;
  }
  if (!Array.isArray(obj.engines_involved)) {
    return false;
  }
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    return false;
  }
  return true;
}
