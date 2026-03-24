// main.js — entry point and wiring for Theronexus web UI
import { state } from './state.js';
import { loadGraph, applyHighlight, loadHeatmap } from './ui/graph.js';
import { loadStats, switchLeftTab, loadAgents } from './ui/panel.js';
import { doRunExplore, runContextForName, doRunImpact } from './ui/mcp.js';
import { toggleExplode, togglePath, unpinAll, setupKeyboardControls } from './ui/controls.js';
import { initBrainMode, brainLoop, setBrainRenderMode, brainTriggerActivation } from './mode/brain.js';
import { enableNexusShaders, disableNexusShaders } from './mode/nexus.js';
import { moduleColor } from './utils.js';

// ── Expose NEXUS node object for use in graph.js's nodeThreeObject callback ──
import { makeNexusNodeObject } from './objects/node.js';
window.__nexusMod = { makeNexusNodeObject };

// ── Expose activity module for use in mcp.js ─────────────────────────────────
import { triggerActivation } from './ui/activity.js';
window.__activityMod = { triggerActivation };

// ── showNodeDetail — opens context tab for a node ────────────────────────────
function showNodeDetail(node) {
  switchLeftTab('context');
  runContextForName(node.name, switchLeftTab, runImpact);
}

// ── runImpact wrapper ─────────────────────────────────────────────────────────
function runImpact() { doRunImpact(); }

// ── switchMode — BRAIN / NEXUS / GALAXY ──────────────────────────────────────
function switchMode(mode) {
  if (state.brainMode) cancelAnimationFrame(state.brainRafId);
  if (state.nexusMode) cancelAnimationFrame(state.nexusRafId);
  state.brainMode = mode === 'brain';
  state.nexusMode = mode === 'nexus';

  document.getElementById('galaxy-view').style.display = mode === 'brain' ? 'none' : 'block';
  document.getElementById('brain-view').style.display  = mode === 'brain' ? 'block' : 'none';
  document.getElementById('nexus-view').style.display  = 'none';
  document.getElementById('slice-row').style.display   = mode === 'brain' ? 'flex' : 'none';

  const btn = document.getElementById('mode-btn');
  btn.textContent = state.brainMode ? 'GALAXY' : 'BRAIN';
  btn.style.background = state.brainMode ? 'rgba(0,229,255,0.1)' : 'rgba(255,45,120,0.1)';
  btn.style.borderColor = state.brainMode ? 'rgba(0,229,255,0.5)' : 'rgba(255,45,120,0.5)';
  btn.style.color = state.brainMode ? 'var(--accent)' : 'var(--accent2)';

  const nb = document.getElementById('nexus-btn');
  nb.style.background = state.nexusMode ? 'rgba(153,51,255,0.25)' : 'rgba(153,51,255,0.1)';
  nb.style.borderColor = state.nexusMode ? 'rgba(153,51,255,0.9)' : 'rgba(153,51,255,0.5)';

  if (state.brainMode) { if (!state.brainRenderer) initBrainMode(showNodeDetail); state.brainLastFrame = 0; brainLoop(); }
  if (state.nexusMode) enableNexusShaders();
  if (!state.nexusMode && !state.brainMode) disableNexusShaders();
}

// ── Wire up left panel tabs ───────────────────────────────────────────────────
document.querySelectorAll('.left-tab').forEach(t => t.addEventListener('click', () => switchLeftTab(t.dataset.ltab)));

// ── Wire up explore ───────────────────────────────────────────────────────────
document.getElementById('explore-btn').addEventListener('click', () => doRunExplore(showNodeDetail));
document.getElementById('explore-input').addEventListener('keydown', e => e.key === 'Enter' && doRunExplore(showNodeDetail));

// ── Wire up context ───────────────────────────────────────────────────────────
document.getElementById('context-btn').addEventListener('click', () => {
  const name = document.getElementById('context-input').value.trim();
  if (name) runContextForName(name, switchLeftTab, runImpact);
});
document.getElementById('context-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const name = document.getElementById('context-input').value.trim();
    if (name) runContextForName(name, switchLeftTab, runImpact);
  }
});

// ── Wire up impact ────────────────────────────────────────────────────────────
document.getElementById('impact-btn').addEventListener('click', runImpact);
document.getElementById('impact-input').addEventListener('keydown', e => e.key === 'Enter' && runImpact());

// ── Wire up toolbar buttons ───────────────────────────────────────────────────
document.getElementById('explode-btn').addEventListener('click', toggleExplode);
document.getElementById('path-btn').addEventListener('click', togglePath);
document.getElementById('unpin-btn').addEventListener('click', unpinAll);
document.getElementById('mode-btn').addEventListener('click', () => switchMode(state.brainMode ? 'galaxy' : 'brain'));
document.getElementById('nexus-btn').addEventListener('click', () => switchMode(state.nexusMode ? 'galaxy' : 'nexus'));

// ── Slice slider for brain mode ───────────────────────────────────────────────
document.getElementById('slice-slider').addEventListener('input', e => {
  const THREE = window.THREE;
  const v = parseInt(e.target.value);
  if (state.brainRenderer) {
    if (v < 255) {
      state.brainRenderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), v)];
      state.brainRenderer.localClippingEnabled = true;
    } else {
      state.brainRenderer.clippingPlanes = [];
    }
  }
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
setupKeyboardControls(switchMode);

// ── Heatmap polling ───────────────────────────────────────────────────────────
loadHeatmap();
setInterval(loadHeatmap, 15000);

// ── Public API for external integration ──────────────────────────────────────
window.theronexusBrain = {
  triggerNodeActivation(nodeId) { if (state.brainMode) brainTriggerActivation(nodeId, 0.9); },
  injectPulse(srcId, tgtId, intensity) {
    const f = state.brainFibers.find(f => f.srcId === srcId && f.tgtId === tgtId);
    if (f) {
      const { spawnBrainPulse } = window.__brainMod;
      spawnBrainPulse(f.curve, moduleColor(state.nodeById.get(srcId)?.module ?? ''), intensity ?? 0.7);
    }
  },
  setMode(mode, clusterId) { setBrainRenderMode(mode, clusterId); },
  setSlicePlane(axis, value) {
    const THREE = window.THREE;
    if (!state.brainRenderer) return;
    const v = axis === 'x' ? new THREE.Vector3(-1, 0, 0) : axis === 'z' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, -1, 0);
    state.brainRenderer.clippingPlanes = [new THREE.Plane(v, value)];
    state.brainRenderer.localClippingEnabled = true;
  },
  get isActive() { return state.brainMode; },
};

// ── Expose brain pulse for public API ─────────────────────────────────────────
import { spawnBrainPulse } from './mode/brain.js';
window.__brainMod = { spawnBrainPulse };

// ── Bootstrap ─────────────────────────────────────────────────────────────────
loadStats();
loadGraph(showNodeDetail);
