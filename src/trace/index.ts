// trace/index.ts — Public surface of the trace subsystem.
// Re-exports everything needed to instrument call sites and read stored traces.

export type {
  BusEventType,
  BusEvent,
  BusEventPayloadMap,
  LmInferenceStartPayload,
  LmInferenceEndPayload,
  ToolCallStartPayload,
  ToolCallEndPayload,
  RoutingDecisionPayload,
  OutcomeRecordedPayload,
  TraceRecord,
} from "./bus";

export {
  bus,
  emit,
  on,
  off,
  readTraces,
  readTracesSince,
  DEFAULT_TRACES_DIR,
} from "./bus";
