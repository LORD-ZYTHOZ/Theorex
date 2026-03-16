// vision/ingest.ts — Full image ingestion pipeline (Phase 10).
//
// Pipeline:
//   image file
//     → vision model describes it (describe.ts)
//     → description + elements text → processText() → ConceptEvents
//     → concepts merged into axon with observation_type: "image"
//     → ImageMemory written to data/images/{uuid}.json
//
// INVARIANTS:
//   - Returns null if vision model unavailable (non-fatal to caller)
//   - axon.json is written atomically via store.save()
//   - observation_type: "image" on all concept nodes from this ingest

import { processText } from "../compose";
import { AxonStore } from "../axon/store";
import type { Config } from "../config";
import { describeImage } from "./describe";
import { createImageMemory } from "./store";
import type { ImageMemory } from "./store";

export interface ImageIngestResult {
  readonly memory: ImageMemory;
  readonly conceptsAdded: number;
  readonly edgesAdded: number;
}

/**
 * Ingest an image into Theorex:
 * 1. Extract structured description via vision model
 * 2. Extract concepts from description + elements
 * 3. Merge concepts into axon with observation_type: "image"
 * 4. Save ImageMemory to disk
 *
 * Returns null if the vision model is unavailable or the image cannot be read.
 */
export async function ingestImage(
  imagePath: string,
  config: Config,
  options?: {
    axonPath?: string;
    imagesDir?: string;
    userContext?: string;  // optional user-supplied context to enrich description
    agentId?: string;
    nowMs?: number;
  },
): Promise<ImageIngestResult | null> {
  const axonPath = options?.axonPath ?? config.axonPath ?? "data/axon.json";
  const imagesDir = options?.imagesDir ?? config.imagesDir ?? "data/images";
  const agentId = options?.agentId ?? "main";
  const nowMs = options?.nowMs ?? Date.now();
  const timestamp = new Date(nowMs).toISOString();

  // 1. Describe image
  const visual = await describeImage(imagePath, config);
  if (!visual) return null;

  // 2. Build concept extraction text: description + elements + context
  const contextNote = options?.userContext ? ` ${options.userContext}` : "";
  const extractionText = [
    visual.description,
    visual.elements.join(". "),
    visual.context + contextNote,
  ].join(" ");

  const events = processText(extractionText, 1.0, "concept", timestamp);

  // 3. Merge into axon
  const store = await AxonStore.load(axonPath);

  const nodesBefore = store.graph.order;
  const edgesBefore = store.graph.size;

  for (const event of events) {
    store.mergeNode(event, agentId, "image");
  }

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      store.mergeEdge(events[i]!.concept_id, events[j]!.concept_id, timestamp);
    }
  }

  await store.save(axonPath);

  const conceptsAdded = store.graph.order - nodesBefore;
  const edgesAdded = store.graph.size - edgesBefore;

  // 4. Build and save ImageMemory
  const memory: ImageMemory = {
    id: crypto.randomUUID(),
    timestamp,
    source_path: imagePath,
    description: visual.description,
    elements: visual.elements,
    context: options?.userContext
      ? `${visual.context} ${options.userContext}`
      : visual.context,
    reconstruction_prompt: visual.reconstruction_prompt,
    concept_ids: events.map((e) => e.concept_id),
  };

  await createImageMemory(memory, imagesDir);

  return { memory, conceptsAdded, edgesAdded };
}
