// AxonStore — Graphology-backed concept web persistence layer.
// Provides typed node/edge attributes, atomic saves, and safe upsert semantics.
// Phase 1 types defined here; final ConceptEvent shape comes from src/types.ts.
//
// INVARIANTS:
//   - NEVER call graph.addNode() — always graph.mergeNode()
//   - NEVER call graph.addEdge() — always graph.mergeEdge()
//   - Node keys are always String(concept_id) — never the raw number
//   - New nodes start with sentiment_tier: "NEUTRAL" (SNT-01)

import { UndirectedGraph } from "graphology";
import { rename } from "node:fs/promises";
import type { ConceptEvent } from "../types";
import { ColdStore } from "./cold";
import { decompressNode } from "./decompress";

// ---------------------------------------------------------------------------
// Typed attribute interfaces (Phase 1 graph layer)
// ---------------------------------------------------------------------------

export interface AxonNodeAttrs {
  concept_id: number;
  surface_form: string;
  importance_weight: number;
  relevance_tier: "ACTIVE" | "MILD" | "LESS" | "SLEEPING";
  archive_id: string;       // Phase 9: archive_id in ColdStore; "" when not sleeping
  sentiment_tier: "PREFERRED" | "NEUTRAL" | "DISPREFERRED";
  last_seen: string;       // ISO 8601
  frequency_count: number;
  source_weight: number;
  agent_id: string;        // Phase 6: which agent produced this node; "" = pre-Phase6 / unknown
  node_type: string;       // Phase 7: "concept" | "moment" | "code_function"; "" = pre-Phase7
  observation_type: string; // Phase 8: typed observation kind; "" = untyped
}

export interface AxonEdgeAttrs {
  strength: number;           // 0.0–1.0
  co_occurrence_count: number;
  last_co_occurrence: string; // ISO 8601
  seeded: boolean;            // true = created by RAG bootstrap; false = organic co-occurrence
  seed_created_at: string;    // ISO 8601 — used by dissolution age check; empty string if seeded: false
}

// ---------------------------------------------------------------------------
// AxonStore
// ---------------------------------------------------------------------------

export class AxonStore {
  private _graph: UndirectedGraph<AxonNodeAttrs, AxonEdgeAttrs>;
  private _cold: ColdStore | null = null;

  constructor() {
    this._graph = new UndirectedGraph<AxonNodeAttrs, AxonEdgeAttrs>();
  }

  /**
   * Open cold storage for this store. Call once after load() when Phase 9 is active.
   * If not opened, SLEEPING nodes are left as-is (backward compatible).
   */
  openCold(coldPath: string): void {
    this._cold = new ColdStore(coldPath);
  }

  /** Read-only access to the ColdStore (for scan.ts compression). */
  get cold(): ColdStore | null {
    return this._cold;
  }

  /** Read-only access to the underlying graph for external iteration. */
  get graph(): UndirectedGraph<AxonNodeAttrs, AxonEdgeAttrs> {
    return this._graph;
  }

  /**
   * Wake a SLEEPING node back to LESS tier (Phase 9).
   * Restores full attrs from cold storage and writes them back to the graph.
   * No-op if node is not SLEEPING or cold storage is not open.
   */
  wakeNode(key: string): void {
    if (!this._cold || !this._graph.hasNode(key)) return;
    const attrs = this._graph.getNodeAttributes(key);
    if (attrs.relevance_tier !== "SLEEPING") return;

    const restored = decompressNode(attrs, this._cold);
    // Restore to LESS tier so the next scan can re-score it organically
    const woken = { ...restored, relevance_tier: "LESS" as const };
    for (const [attr, val] of Object.entries(woken) as [keyof AxonNodeAttrs, AxonNodeAttrs[keyof AxonNodeAttrs]][]) {
      this._graph.setNodeAttribute(key, attr, val);
    }
  }

  /**
   * Upsert a node from a ConceptEvent.
   * - If node does not exist: creates with all attrs; sentiment_tier: "NEUTRAL", relevance_tier: "ACTIVE"
   * - If node exists: increments frequency_count and updates last_seen; preserves tiers
   * - If node is SLEEPING: wakes it first, then upserts (transparent re-activation)
   * Returns the node key (always String(concept_id)).
   */
  mergeNode(event: ConceptEvent, agentId = "", observationType = ""): string {
    const key = String(event.concept_id);

    if (this._graph.hasNode(key)) {
      // Wake sleeping node before any upsert (Phase 9)
      this.wakeNode(key);

      const existing = this._graph.getNodeAttributes(key);
      this._graph.setNodeAttribute(key, "frequency_count", existing.frequency_count + event.frequency_count);
      this._graph.setNodeAttribute(key, "last_seen", event.timestamp);
      // Always update observation_type and node_type when the caller provides them —
      // re-encounters with a richer/more-specific type should win over the old value.
      if (observationType !== "") this._graph.setNodeAttribute(key, "observation_type", observationType);
      if (event.node_type) this._graph.setNodeAttribute(key, "node_type", event.node_type);
      if (agentId) this._graph.setNodeAttribute(key, "agent_id", agentId);
    } else {
      this._graph.addNode(key, {
        concept_id: event.concept_id,
        surface_form: event.surface_form,
        importance_weight: event.importance_score,
        relevance_tier: "ACTIVE",
        sentiment_tier: "NEUTRAL",
        last_seen: event.timestamp,
        frequency_count: event.frequency_count,
        source_weight: event.source_weight,
        agent_id: agentId,
        node_type: event.node_type ?? "",
        observation_type: observationType,
        archive_id: "",
      });
    }

    return key;
  }

  /**
   * Upsert/strengthen a co-occurrence edge between two concept IDs.
   * - First call: strength = 0.1, co_occurrence_count = 1
   * - Subsequent calls: strength += 0.05 (clamped at 1.0), co_occurrence_count++
   * Nodes for idA and idB must already exist (call mergeNode first).
   */
  mergeEdge(idA: number, idB: number, timestamp: string): void {
    const keyA = String(idA);
    const keyB = String(idB);

    const existingEdge = this._graph.edge(keyA, keyB);

    if (existingEdge === undefined) {
      this._graph.addEdge(keyA, keyB, {
        strength: 0.1,
        co_occurrence_count: 1,
        last_co_occurrence: timestamp,
        seeded: false,
        seed_created_at: "",
      });
    } else {
      const attrs = this._graph.getEdgeAttributes(existingEdge);
      const newStrength = Math.min(1.0, attrs.strength + 0.05);
      this._graph.setEdgeAttribute(existingEdge, "strength", newStrength);
      this._graph.setEdgeAttribute(existingEdge, "co_occurrence_count", attrs.co_occurrence_count + 1);
      this._graph.setEdgeAttribute(existingEdge, "last_co_occurrence", timestamp);
      // Preserve seeded and seed_created_at immutably — do not overwrite on upsert
    }
  }

  /**
   * Extends mergeNode with a non-blocking RAG bootstrap hook.
   * On first-time concept creation (isNew === true), fires bootstrapFn via setImmediate.
   * Seeding is best-effort: errors in bootstrapFn do not propagate to the caller.
   *
   * Usage from callers:
   *   store.mergeNodeWithBootstrap(event, (conceptId, label) => {
   *     void seedEdges(store, conceptId, label, config.ragEmbeddingStorePath, config);
   *   });
   *
   * Non-blocking design: setImmediate ensures the concept upsert completes first,
   * then seeding runs in a subsequent event-loop tick.
   */
  mergeNodeWithBootstrap(
    event: ConceptEvent,
    bootstrapFn?: (conceptId: number, label: string) => void,
    agentId = ""
  ): string {
    const isNew = !this._graph.hasNode(String(event.concept_id));
    const key = this.mergeNode(event, agentId);

    if (isNew && bootstrapFn) {
      setImmediate(() => bootstrapFn(event.concept_id, event.surface_form));
    }

    return key;
  }

  /**
   * Atomically write graph to path via temp file + rename.
   * Always writes to path+".tmp" in the same directory (same filesystem).
   */
  async save(path: string): Promise<void> {
    const tmp = path + ".tmp";
    await Bun.write(tmp, JSON.stringify(this._graph.export(), null, 2));
    await rename(tmp, path);
  }

  /**
   * Load AxonStore from path.
   * If the file does not exist (ENOENT), returns a new empty AxonStore.
   */
  static async load(path: string): Promise<AxonStore> {
    const store = new AxonStore();
    const file = Bun.file(path);

    const exists = await file.exists();
    if (!exists) {
      return store;
    }

    const raw = await file.json();
    store._graph = UndirectedGraph.from<AxonNodeAttrs, AxonEdgeAttrs>(raw);
    return store;
  }
}
