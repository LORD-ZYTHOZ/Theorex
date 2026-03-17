// dispatch/index.ts — Public surface of the Phase 16 dispatch subsystem.
// Re-exports all types and functions needed by callers and the CLI.

export type {
  DispatchTask,
  DispatchResult,
  DispatchConfig,
} from "./worker.ts";

export {
  dispatch,
  dispatchIfNeeded,
} from "./worker.ts";
