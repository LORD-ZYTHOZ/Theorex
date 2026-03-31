// config.ts — Project-wide configuration loader.
// Reads config.json if present; falls back to DEFAULT_CONFIG.
// No other module should hardcode these values.

export interface Config {
  halfLifeDays: number;       // default: 14
  activeThreshold: number;    // default: 0.6
  mildThreshold: number;      // default: 0.3
  pruneThresholdDays: number; // default: 30
  edgePruneThreshold: number; // default: 0.01
  // Phase 2: Short-Term Memory fields
  stmRetentionDays: number;      // default: 14
  stmGraduateDays: number;       // default: 7
  lmStudioUrl: string;           // default: "http://localhost:8082" (Qwen3-32B)
  lmStudioEmbedModel: string;    // default: "nomic-embed-text-v1.5"
  lmStudioTimeoutMs: number;     // default: 3000
  // Phase 4: RAG Bootstrap
  ragBootstrapK: number;               // default: 5  — max seeded edges per new concept
  ragBootstrapMinSimilarity: number;   // default: 0.4 — min cosine similarity to seed
  ragSeedDissolutionDays: number;      // default: 7  — days before unreinforced seed dissolves
  ragEmbeddingStorePath: string;       // default: "data/concept-embeddings.json"
  hnswIndexPath: string;               // default: "data/hnsw-index.json"
  ragOnnxModel: string;                // default: "Xenova/all-MiniLM-L6-v2"
  // Phase 5: Moment Nodes
  momentsDir: string;                  // default: "data/moments"
  // Phase 8: Drift Detection
  driftWindowDays: number;             // default: 7  — rolling window for tier instability / sentiment flip detection
  eventsPath: string;                  // default: "data/events.jsonl"
  // Phase 6: AI Family Shared Layer
  promotionThreshold: number;          // default: 0.7 — composite_score required to auto-promote to shared
  sharedAxonPath: string;              // default: "~/.openclaw/workspace/theorex/shared-axon.json"
  agentAxonDir: string;                // default: "~/.openclaw/agents"
  // Phase 14: Temporal Awareness
  location: string;                    // default: "" — e.g. "Sydney"
  temporalAgentId: string;             // default: "main" — agent to write temporal summaries to
  temporalStorePath: string;           // default: "data/temporal.json"
  // Phase 15: Auto-Sliding Context Window
  contextSlideThreshold: number;       // default: 0.50 — used_pct >= this triggers compression
  contextSlideCooldownCalls: number;   // default: 20 — min tool calls between compressions
  synthEndpoint: string;               // default: "http://localhost:8082" — Qwen3-32B for synthesis
  // Phase 9: Memory Compression
  coldStorePath: string;               // default: "data/cold.db" — SQLite cold storage path
  compressAfterDays: number;           // default: 30 — compress LESS nodes older than this many days
  // Phase 12: Deployment Mode + Profession Packs
  deploymentMode: "personal" | "business"; // default: "personal"
  professionPack: string;              // default: "" — pack name to load in business mode (e.g. "trading")
  professionPacksDir: string;          // default: "" — custom packs directory; falls back to built-in
  // Phase 10: Visual Memory
  imagesDir: string;                   // default: "data/images"
  visionModel: string;                 // default: "claude-haiku-4-5-20251001"
  visionEndpoint: string;              // default: "" — local LM Studio URL; uses Anthropic API if empty
  axonPath: string;                    // default: "data/axon.json" — used by ingest-image
  // Phase 11: Video Memory
  videosDir: string;                   // default: "data/videos"
  videoFrameIntervalSec: number;       // default: 5 — extract one frame every N seconds
  ffmpegPath: string;                  // default: "ffmpeg" — path to ffmpeg binary
  // Phase 13: Living Code / Self-Refinement
  outcomesDir: string;                 // default: "data/outcomes" — outcome records
  lessonsDir: string;                  // default: "data/lessons" — synthesized lesson records
  evolutionLogPath: string;            // default: "data/evolution.jsonl" — nightly refinement log
  evolveWindowDays: number;            // default: 7 — rolling window for outcome review
  // Short-term memory directory (Phase 2) — explicit field enables test isolation
  stmDir: string;                      // default: "data/short-term"
  // Phase 21: Agent Health Monitoring
  healthDir: string;                   // default: "data/health"
  healthProbeTimeoutMs: number;        // default: 3000
  healthWindowDays: number;            // default: 7
  // Phase 23: Multi-Vault Shared Memory
  vaultRegistryPath: string;           // default: "data/vaults.json"
  // Deliberation Channel — post-session multi-engine review
  deliberationsDir: string;            // default: "data/deliberations"
  singularityTradesPath: string;       // default: "data/singularity/latent_trades.jsonl"
  divergentDir: string;                // default: "data/divergent"
  horizonDir: string;                  // default: "data/horizon"
}

export const DEFAULT_CONFIG: Config = {
  halfLifeDays: 14,
  activeThreshold: 0.6,
  mildThreshold: 0.3,
  pruneThresholdDays: 30,
  edgePruneThreshold: 0.01,
  // Phase 2: Short-Term Memory defaults
  stmRetentionDays: 14,
  stmGraduateDays: 7,
  lmStudioUrl: "http://localhost:8082",
  lmStudioEmbedModel: "nomic-embed-text-v1.5",
  lmStudioTimeoutMs: 15000,
  // Phase 4: RAG Bootstrap defaults
  ragBootstrapK: 5,
  ragBootstrapMinSimilarity: 0.4,
  ragSeedDissolutionDays: 7,
  ragEmbeddingStorePath: "data/concept-embeddings.json",
  hnswIndexPath: "data/hnsw-index.json",
  ragOnnxModel: "Xenova/all-MiniLM-L6-v2",
  // Phase 5: Moment Nodes
  momentsDir: "data/moments",
  // Phase 8: Drift Detection
  driftWindowDays: 7,
  eventsPath: "data/events.jsonl",
  // Phase 6: AI Family Shared Layer
  promotionThreshold: 0.5,
  sharedAxonPath: "",   // empty = resolved at runtime via homedir()
  agentAxonDir: "",     // empty = resolved at runtime via homedir()
  // Phase 14: Temporal Awareness
  location: "",
  temporalAgentId: "main",
  temporalStorePath: "data/temporal.json",
  // Phase 15: Auto-Sliding Context Window
  contextSlideThreshold: 0.50,
  contextSlideCooldownCalls: 20,
  synthEndpoint: "http://localhost:8082",
  // Phase 9: Memory Compression
  coldStorePath: "data/cold.db",
  compressAfterDays: 30,
  // Phase 12: Deployment Mode + Profession Packs
  deploymentMode: "personal",
  professionPack: "",
  professionPacksDir: "",
  // Phase 10: Visual Memory
  imagesDir: "data/images",
  visionModel: "claude-haiku-4-5-20251001",
  visionEndpoint: "",
  axonPath: "data/axon.json",
  // Phase 11: Video Memory
  videosDir: "data/videos",
  videoFrameIntervalSec: 5,
  ffmpegPath: "ffmpeg",
  // Phase 13: Living Code / Self-Refinement
  outcomesDir: "data/outcomes",
  lessonsDir: "data/lessons",
  evolutionLogPath: "data/evolution.jsonl",
  evolveWindowDays: 7,
  stmDir: "data/short-term",
  // Phase 21: Agent Health Monitoring
  healthDir: "data/health",
  healthProbeTimeoutMs: 3000,
  healthWindowDays: 7,
  // Phase 23: Multi-Vault Shared Memory
  vaultRegistryPath: "data/vaults.json",
  // Deliberation Channel
  deliberationsDir: "data/deliberations",
  singularityTradesPath: "data/singularity/latent_trades.jsonl",
  divergentDir: "data/divergent",
  horizonDir: "data/horizon",
};

/**
 * Load config from path.
 * If file is absent or invalid JSON, returns a copy of DEFAULT_CONFIG.
 * Merges — caller-supplied keys override defaults, missing keys use defaults.
 * Clamps numeric fields to valid ranges to prevent silent misbehaviour.
 */
export async function loadConfig(path = "config.json"): Promise<Config> {
  try {
    const raw = await Bun.file(path).json();
    return validateConfig({ ...DEFAULT_CONFIG, ...raw });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Clamp config values to their valid ranges.
 * Returns a new config — never mutates the input.
 */
export function validateConfig(cfg: Config): Config {
  return {
    ...cfg,
    halfLifeDays:             Math.max(1, cfg.halfLifeDays),
    activeThreshold:          Math.min(1, Math.max(0, cfg.activeThreshold)),
    mildThreshold:            Math.min(1, Math.max(0, cfg.mildThreshold)),
    pruneThresholdDays:       Math.max(1, cfg.pruneThresholdDays),
    edgePruneThreshold:       Math.min(1, Math.max(0, cfg.edgePruneThreshold)),
    promotionThreshold:       Math.min(1, Math.max(0, cfg.promotionThreshold)),
    contextSlideThreshold:    Math.min(1, Math.max(0, cfg.contextSlideThreshold)),
    contextSlideCooldownCalls:Math.max(1, cfg.contextSlideCooldownCalls),
    compressAfterDays:        Math.max(1, cfg.compressAfterDays),
    ragBootstrapK:            Math.max(0, cfg.ragBootstrapK),
    ragBootstrapMinSimilarity:Math.min(1, Math.max(0, cfg.ragBootstrapMinSimilarity)),
    evolveWindowDays:         Math.max(1, cfg.evolveWindowDays),
    videoFrameIntervalSec:    Math.max(1, cfg.videoFrameIntervalSec),
  };
}
