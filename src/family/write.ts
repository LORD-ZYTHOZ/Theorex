// family/write.ts — Write text to an agent's private axon store.
// Phase 6: AI Family Shared Layer
//
// Wraps the existing significance pipeline (processText) and AxonStore.mergeNode.
// Agents call this to record their observations into their private concept web.

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { processText } from "../compose";
import { AxonStore } from "../axon/store";
import { agentAxonPath, sourceWeightForAgent } from "./paths";
import type { Config } from "../config";

export interface WriteResult {
  readonly agentId: string;
  readonly axonPath: string;
  readonly conceptsAdded: number;
  readonly edgesAdded: number;
}

/**
 * Process multiple texts and write all extracted concepts in a single axon I/O cycle.
 * Equivalent to calling writeToAgent() for each text but with one load+save instead of N.
 */
export async function batchWriteToAgent(
  agentId: string,
  texts: readonly string[],
  config: Config,
  nowMs: number = Date.now(),
  observationType = "",
): Promise<WriteResult> {
  if (texts.length === 0) {
    const axonPath = agentAxonPath(agentId, config.agentAxonDir);
    return { agentId, axonPath, conceptsAdded: 0, edgesAdded: 0 };
  }

  const sourceWeight = sourceWeightForAgent(agentId);
  const timestamp = new Date(nowMs).toISOString();
  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  await mkdir(dirname(axonPath), { recursive: true });

  const store = await AxonStore.load(axonPath);
  const nodesBefore = store.graph.order;
  const edgesBefore = store.graph.size;

  for (const text of texts) {
    const events = processText(text, sourceWeight, "concept", timestamp);
    for (const event of events) {
      store.mergeNode(event, agentId, observationType);
    }
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        store.mergeEdge(events[i]!.concept_id, events[j]!.concept_id, timestamp);
      }
    }
  }

  await store.save(axonPath);

  return {
    agentId,
    axonPath,
    conceptsAdded: store.graph.order - nodesBefore,
    edgesAdded: store.graph.size - edgesBefore,
  };
}

/**
 * Process text and write extracted concepts into an agent's private axon store.
 * Creates the agent's theorex directory if it doesn't exist.
 */
export async function writeToAgent(
  agentId: string,
  text: string,
  config: Config,
  nowMs: number = Date.now(),
  observationType = "",
): Promise<WriteResult> {
  const sourceWeight = sourceWeightForAgent(agentId);
  const timestamp = new Date(nowMs).toISOString();

  const events = processText(text, sourceWeight, "concept", timestamp);

  const axonPath = agentAxonPath(agentId, config.agentAxonDir);
  await mkdir(dirname(axonPath), { recursive: true });

  const store = await AxonStore.load(axonPath);

  const nodesBefore = store.graph.order;
  const edgesBefore = store.graph.size;

  // Merge all concept nodes
  for (const event of events) {
    store.mergeNode(event, agentId, observationType);
  }

  // Merge co-occurrence edges (all pairs within the same text share an edge)
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      store.mergeEdge(events[i]!.concept_id, events[j]!.concept_id, timestamp);
    }
  }

  await store.save(axonPath);

  return {
    agentId,
    axonPath,
    conceptsAdded: store.graph.order - nodesBefore,
    edgesAdded: store.graph.size - edgesBefore,
  };
}
