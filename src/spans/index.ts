// src/spans/index.ts
export * from "./types";
export { SpanStore } from "./store";
export { isDoomLoop, levenshteinSimilarity } from "./circuit-breaker";
export { resolveOpenSpans, computeSingularityReward, computeSignalReward, normalizeReward } from "./resolver";
