// deliberate/packet.ts — Session packet builder and condensation.
//
// Assembles a SessionPacket by calling all three extractors (Singularity,
// Divergent, Horizon), then provides a condensePacket function to truncate
// large datasets for LLM context windows.

import type {
  TradingSession,
  SessionPacket,
  PerspectiveReport,
  SingularityReport,
  HorizonReport,
} from "./types";
import { extractSingularityReport } from "./extractors/singularity";
import { extractDivergentReport } from "./extractors/divergent";
import { extractHorizonReport } from "./extractors/horizon";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SINGULARITY_TRADES = 20;
const MAX_HORIZON_POSITIONS = 10;

// ---------------------------------------------------------------------------
// Packet builder
// ---------------------------------------------------------------------------

interface BuildSessionPacketOpts {
  readonly session: TradingSession;
  readonly date: string;
  readonly singularityPath: string;
  readonly divergentPath: string;
  readonly horizonPath: string;
}

/**
 * Build a SessionPacket by calling all three extractors in parallel.
 * Singularity always produces a report (possibly empty).
 * Divergent and Horizon return null when their files are missing;
 * null reports are excluded from the perspectives array.
 */
export async function buildSessionPacket(opts: BuildSessionPacketOpts): Promise<SessionPacket> {
  const { session, date, singularityPath, divergentPath, horizonPath } = opts;

  const [singularity, divergent, horizon] = await Promise.all([
    extractSingularityReport(singularityPath, session, date),
    extractDivergentReport(divergentPath, session, date),
    extractHorizonReport(horizonPath, session, date),
  ]);

  const perspectives: readonly PerspectiveReport[] = [
    singularity,
    ...(divergent ? [divergent] : []),
    ...(horizon ? [horizon] : []),
  ];

  return {
    date,
    session,
    perspectives,
    assembled_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Condensation
// ---------------------------------------------------------------------------

/**
 * Return a new packet (immutable) with large collections truncated:
 * - Singularity session_trades: max 20, most recent by entry_time
 * - Horizon positions: max 10, most recent by opened_at
 * - Divergent: passed through unchanged
 */
export function condensePacket(packet: SessionPacket): SessionPacket {
  const condensedPerspectives = packet.perspectives.map((report) => {
    switch (report.source) {
      case "singularity":
        return condenseSingularity(report);
      case "horizon":
        return condenseHorizon(report);
      case "divergent":
        return report;
    }
  });

  return {
    ...packet,
    perspectives: condensedPerspectives,
  };
}

function condenseSingularity(report: SingularityReport): SingularityReport {
  if (report.session_trades.length <= MAX_SINGULARITY_TRADES) {
    return { ...report };
  }

  const sorted = [...report.session_trades].sort(
    (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime(),
  );
  const truncated = sorted.slice(-MAX_SINGULARITY_TRADES);

  return {
    ...report,
    session_trades: truncated,
  };
}

function condenseHorizon(report: HorizonReport): HorizonReport {
  if (report.positions.length <= MAX_HORIZON_POSITIONS) {
    return { ...report };
  }

  const sorted = [...report.positions].sort(
    (a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime(),
  );
  const truncated = sorted.slice(-MAX_HORIZON_POSITIONS);

  return {
    ...report,
    positions: truncated,
  };
}
