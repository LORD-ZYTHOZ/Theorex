// state.js — all shared mutable state for the Theronexus web UI
// All modules import { state } from './state.js'

export const state = {
  // ── Graph data ─────────────────────────────────────────────────────────────
  graph3d: null,
  allNodes: [],
  nodeById: new Map(),
  brainEdgesData: [],

  // ── Per-node material refs ─────────────────────────────────────────────────
  coreMats: new Map(),    // nodeId → material proxy
  glowMats: new Map(),    // nodeId → material proxy
  spriteMats: new Map(),  // nodeId → { mat, col, name }

  // ── Activity tracking ──────────────────────────────────────────────────────
  nodeActivity: new Map(),        // id → { level, timer }
  liveActivityNodes: new Set(),   // node ids with at least one real pulse
  edgeFireCount: new Map(),       // edgeKey → count

  // ── Pulse animation ────────────────────────────────────────────────────────
  activityPulses: [],

  // ── Heatmap ────────────────────────────────────────────────────────────────
  heatMode: false,
  heatData: { nodes: {}, edges: {} },

  // ── Graph search/filter ────────────────────────────────────────────────────
  graphSearchTerm: '',
  clusterHighlightLabel: null,
  clustersLoaded: false,

  // ── Explode mode ───────────────────────────────────────────────────────────
  explodeMode: false,

  // ── Path highlight ─────────────────────────────────────────────────────────
  pathHighlightNodes: new Set(),
  pathSelectedNode: null,
  pathDepth: 0,

  // ── Drag physics ──────────────────────────────────────────────────────────
  dragHistory: new Map(),    // nodeId → [{x,y,z,t}, ...]
  draggedNodes: new Map(),   // nodeId → {x,y,z} live drag position
  dragPinTimers: new Map(),  // nodeId → timeout

  // ── Mode flags ────────────────────────────────────────────────────────────
  brainMode: false,
  nexusMode: false,

  // ── Bloom refs ────────────────────────────────────────────────────────────
  nexusBloomRef: null,
  galaxyBloomRef: null,

  // ── NEXUS objects ──────────────────────────────────────────────────────────
  nexusUniforms: { uTime: { value: 0 } },
  nexusShaderMats: new Map(),
  nucleusCoronas: [],
  nucleusPointLight: null,
  nucleusLaser: null,
  nexusFibers: [],
  nexusFiberGroup: null,
  nexusStarfieldRefs: null,
  nexusGlowRingRefs: null,
  nexusBinaryTex: null,

  // ── BRAIN objects ──────────────────────────────────────────────────────────
  brainRenderer: null,
  brainScene: null,
  brainCamera: null,
  brainPulses: [],
  brainFibers: [],
  brainBundles: [],
  brainBurstParticles: [],
  brainNodeMats: new Map(),
  brainMeshes: [],
  brainRafId: null,
  brainLastFrame: 0,
  brainOrbit: { rotX: 0.15, rotY: 0, radius: 640, isDragging: false, prevX: 0, prevY: 0, autoY: 0 },
  brainShellUniforms: null,
  brainRenderMode: 'all',
  brainFocusCluster: null,
  hoveredBrainNode: null,
  brainLastRayCast: 0,
  brainHudEl: null,

  // ── HUD ───────────────────────────────────────────────────────────────────
  hudNode: null,
  hudEl: null,
};
