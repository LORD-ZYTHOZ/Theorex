import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type AuditEventType =
  | "tier_change"
  | "sentiment_flip"
  | "graduation"
  | "prune"
  | "moment_capture"
  | "outcome_record"
  | "agent_health_change";

interface BaseAuditEvent {
  readonly timestamp: string; // ISO 8601
  readonly source: string; // "scan" | "prune" | "ref" | "graduate" | "moment" | "cli"
}

interface TierChangeEvent extends BaseAuditEvent {
  readonly type: "tier_change";
  readonly concept_id: number;
  readonly surface_form: string;
  readonly from: "ACTIVE" | "MILD" | "LESS" | "SLEEPING";
  readonly to: "ACTIVE" | "MILD" | "LESS" | "SLEEPING";
}

interface SentimentFlipEvent extends BaseAuditEvent {
  readonly type: "sentiment_flip";
  readonly concept_id: number;
  readonly surface_form: string;
  readonly from: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
  readonly to: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
}

interface GraduationEvent extends BaseAuditEvent {
  readonly type: "graduation";
  readonly surface_form: string;
  readonly concept_id: number;
}

interface PruneEvent extends BaseAuditEvent {
  readonly type: "prune";
  readonly concept_id: number;
  readonly surface_form: string;
}

interface MomentCaptureEvent extends BaseAuditEvent {
  readonly type: "moment_capture";
  readonly moment_id: string;
  readonly story_preview: string; // first 60 chars of story
  readonly concept_ids: readonly number[];
}

interface OutcomeRecordEvent extends BaseAuditEvent {
  readonly type: "outcome_record";
  readonly outcome_id: string;
  readonly agent_id: string;
  readonly success: boolean;
  readonly decision_preview: string; // first 60 chars of decision
}

interface AgentHealthChangeEvent extends BaseAuditEvent {
  readonly type: "agent_health_change";
  readonly agent_id: string;
  readonly from: "healthy" | "degraded" | "unreachable";
  readonly to: "healthy" | "degraded" | "unreachable";
  readonly endpoint: string;
}

export type AuditEvent =
  | TierChangeEvent
  | SentimentFlipEvent
  | GraduationEvent
  | PruneEvent
  | MomentCaptureEvent
  | OutcomeRecordEvent
  | AgentHealthChangeEvent;

export const EVENTS_PATH = "data/events.jsonl";

export async function appendAuditEvent(
  event: AuditEvent,
  path: string = EVENTS_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(event) + "\n");
}
