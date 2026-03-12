// Public API surface for Theorex significance engine.
// Import processText and ConceptEvent from here in all downstream phases.

export { processText } from "./src/compose.ts";
export type { ConceptEvent, NodeType } from "./src/types.ts";
