// deliberate/types.ts — Deliberation channel type definitions.
// Defines the data structures for multi-perspective trading session analysis.
// Each trading session (asian/london/new_york/off_hours) produces a SessionPacket
// containing reports from Singularity, Divergent, and Horizon perspectives.

// ---------------------------------------------------------------------------
// Session & status enums
// ---------------------------------------------------------------------------

export type TradingSession = "asian" | "london" | "new_york" | "off_hours";

export type DeliberationStatus = "pending" | "in_progress" | "complete" | "error";

// ---------------------------------------------------------------------------
// Trade record (matches Singularity latent_trades.jsonl format)
// ---------------------------------------------------------------------------

export interface TradeRecord {
  readonly id: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly entry_price: number;
  readonly exit_price: number;
  readonly pnl: number;
  readonly entry_time: string; // ISO 8601
  readonly exit_time: string;  // ISO 8601
  readonly hold_time_ms: number;
  readonly strategy?: string;
}

// ---------------------------------------------------------------------------
// Perspective reports
// ---------------------------------------------------------------------------

/** Singularity: closed-trade performance for a session window. */
export interface SingularityReport {
  readonly source: "singularity";
  readonly total_trades: number;
  readonly winning_trades: number;
  readonly losing_trades: number;
  readonly total_pnl: number;
  readonly win_rate: number;
  readonly avg_hold_time_ms: number;
  readonly largest_win: number;
  readonly largest_loss: number;
  readonly session_trades: readonly TradeRecord[];
}

/** Divergent: signal agreement across models for a session window. */
export interface DivergentReport {
  readonly source: "divergent";
  readonly signal_count: number;
  readonly agreement_rate: number;
  readonly signals: readonly DivergentSignal[];
}

export interface DivergentSignal {
  readonly timestamp: string;
  readonly direction: "long" | "short" | "neutral";
  readonly confidence: number;
  readonly models_agreed: number;
  readonly models_total: number;
}

/** Horizon: live position exposure snapshot. */
export interface HorizonReport {
  readonly source: "horizon";
  readonly active_positions: number;
  readonly total_exposure: number;
  readonly unrealized_pnl: number;
  readonly positions: readonly HorizonPosition[];
}

export interface HorizonPosition {
  readonly symbol: string;
  readonly side: "long" | "short";
  readonly size: number;
  readonly entry_price: number;
  readonly current_price: number;
  readonly unrealized_pnl: number;
  readonly opened_at: string;
}

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

/** Union of all perspective report types. */
export type PerspectiveReport = SingularityReport | DivergentReport | HorizonReport;

/** A session packet bundles all perspective reports for one session window. */
export interface SessionPacket {
  readonly date: string;         // YYYY-MM-DD
  readonly session: TradingSession;
  readonly perspectives: readonly PerspectiveReport[];
  readonly assembled_at: string; // ISO 8601
}

/** A full deliberation record: packet + LLM analysis result. */
export interface DeliberationRecord {
  readonly id: string;           // crypto.randomUUID()
  readonly date: string;         // YYYY-MM-DD
  readonly session: TradingSession;
  readonly status: DeliberationStatus;
  readonly packet: SessionPacket;
  readonly prompt: string;
  readonly response?: string;
  readonly model: string;
  readonly tokens_used?: number;
  readonly latency_ms?: number;
  readonly created_at: string;   // ISO 8601
  readonly completed_at?: string;
  readonly error?: string;
}
