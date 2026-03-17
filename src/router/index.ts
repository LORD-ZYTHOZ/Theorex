// router/index.ts — re-exports for the HeuristicRouter and ConfidenceMatrix modules.
export type {
  QueryType,
  ModelTier,
  RoutingInput,
  RoutingDecision,
  FallbackChain,
} from "./heuristic.ts";

export {
  classifyQuery,
  route,
  buildFallbackChain,
} from "./heuristic.ts";

export type {
  MatrixCell,
  ConfidenceMatrix,
  DataDrivenDecision,
} from "./confidence-matrix.ts";

export {
  buildMatrix,
  saveMatrix,
  loadMatrix,
  queryMatrix,
  compositeScore,
} from "./confidence-matrix.ts";
