// roles/index.ts — Re-export everything from the roles registry.
// Phase 18: Formal Agent Roles

export {
  DEFAULT_AGENT_PROFILES,
  getProfile,
  getCapableAgents,
  routeToAgent,
  saveProfiles,
  loadProfiles,
} from "./registry";

export type { AgentRole, Capability, QueryType, AgentProfile } from "./registry";
