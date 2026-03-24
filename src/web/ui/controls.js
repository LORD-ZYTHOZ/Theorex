// ui/controls.js — keyboard/mouse controls, explode mode, path highlight, unpin
import { state } from '../state.js';
import { applyHighlight } from './graph.js';
import { triggerActivation } from './activity.js';
import { hideHUD } from './graph.js';
import { setBrainRenderMode } from '../mode/brain.js';

export function toggleExplode() {
  state.explodeMode = !state.explodeMode;
  const btn = document.getElementById('explode-btn');
  btn.textContent = state.explodeMode ? 'EXPLODE ON' : 'EXPLODE';
  btn.style.opacity = state.explodeMode ? '1' : '0.7';
  btn.style.color = state.explodeMode ? 'var(--accent2)' : '';

  if (!state.graph3d) return;

  if (state.explodeMode) {
    const modules = [...new Set(state.allNodes.map(n => n.module))];
    const count = modules.length, radius = 500;
    const centers = new Map(modules.map((mod, i) => {
      const angle = (i / count) * Math.PI * 2;
      return [mod, { cx: Math.cos(angle) * radius, cy: Math.sin(angle) * radius }];
    }));
    state.graph3d.d3Force('explode', alpha => {
      state.graph3d.graphData().nodes.forEach(n => {
        if (n.__pinned) return;
        const c = centers.get(n.module); if (!c) return;
        n.vx = (n.vx || 0) + (c.cx - (n.x || 0)) * 0.06 * alpha;
        n.vy = (n.vy || 0) + (c.cy - (n.y || 0)) * 0.06 * alpha;
      });
    });
  } else {
    state.graph3d.d3Force('explode', null);
  }
  state.graph3d.d3ReheatSimulation();
}

export function bfsToDepth(startId, depth) {
  const links = state.graph3d?.graphData().links ?? [];
  const visited = new Set([startId]);
  const queue = [startId];
  for (let d = 0; d < depth && queue.length; d++) {
    const current = [...queue]; queue.length = 0;
    current.forEach(nodeId => {
      links.forEach(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (s === nodeId && !visited.has(t)) { visited.add(t); queue.push(t); }
        if (t === nodeId && !visited.has(s)) { visited.add(s); queue.push(s); }
      });
    });
  }
  return visited;
}

export function togglePath() {
  if (!state.pathSelectedNode) return;
  const maxDepth = 3;
  state.pathDepth = state.pathHighlightNodes.size ? (state.pathDepth % maxDepth) + 1 : 1;

  if (state.pathDepth > maxDepth || (state.pathDepth === 1 && state.pathHighlightNodes.size && bfsToDepth(state.pathSelectedNode.id, 1).size === state.pathHighlightNodes.size)) {
    state.pathHighlightNodes = new Set(); state.pathDepth = 0;
    const btn = document.getElementById('path-btn');
    btn.textContent = 'PATH'; btn.style.opacity = '0.7'; btn.style.color = '';
    applyHighlight();
    return;
  }

  const visited = bfsToDepth(state.pathSelectedNode.id, state.pathDepth);
  state.pathHighlightNodes = visited;
  const btn = document.getElementById('path-btn');
  btn.textContent = `PATH d${state.pathDepth} (${visited.size})`;
  btn.style.opacity = '1'; btn.style.color = 'var(--accent2)';
  visited.forEach(id => triggerActivation(id, 0.5));
  applyHighlight();
}

export function unpinAll() {
  state.allNodes.forEach(n => {
    if (n.__pinned) {
      n.fx = n.fy = n.fz = undefined; n.__pinned = false;
      const c = state.coreMats.get(n.id); if (c) c.emissiveIntensity = 0.5;
    }
  });
  if (state.graph3d) state.graph3d.d3ReheatSimulation();
}

export function setupKeyboardControls(switchMode) {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'b' || e.key === 'B') switchMode(state.brainMode ? 'galaxy' : 'brain');
    if (e.key === 'n' || e.key === 'N') switchMode(state.nexusMode ? 'galaxy' : 'nexus');
    if (e.key === 'e' || e.key === 'E') toggleExplode();
    if (e.key === 'f' || e.key === 'F') togglePath();
    if (e.key === 'u' || e.key === 'U') unpinAll();
    if (state.brainMode) {
      if (e.key === '1') setBrainRenderMode('all');
      if (e.key === '2') setBrainRenderMode('activeOnly');
      if (e.key === '3') setBrainRenderMode('clusterFocus', state.clusterHighlightLabel);
    }
    if (e.key === 'Escape') {
      state.pathHighlightNodes = new Set(); state.pathSelectedNode = null; state.pathDepth = 0;
      state.clusterHighlightLabel = null; state.graphSearchTerm = '';
      const s = document.getElementById('graph-search'); if (s) s.value = '';
      document.querySelectorAll('.cluster-card.active').forEach(el => el.classList.remove('active'));
      const pb = document.getElementById('path-btn'); if (pb) { pb.textContent = 'PATH'; pb.style.opacity = '0.7'; pb.style.color = ''; }
      applyHighlight(); hideHUD();
    }
  });
}
