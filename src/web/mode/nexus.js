// mode/nexus.js — NEXUS mode init, enable, disable, forces
import { state } from '../state.js';
import { makeNexusNodeObject } from '../objects/node.js';
import { makeNexusEdgeObject } from '../objects/edge.js';
import { buildNucleusLaser } from '../objects/laser.js';
import { buildNexusFiberBundles, cleanupNexusFibers } from '../systems/fibers.js';
import { addNexusStarfield, cleanupNexusStarfield, addNexusGlowRings } from '../systems/starfield.js';
import { moduleColor } from '../utils.js';

export function makeNexusBinaryTex() {
  const THREE = window.THREE;
  const size = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 11px "SF Mono",monospace';
  for (let r = 0; r < 11; r++) {
    for (let c = 0; c < 8; c++) {
      ctx.globalAlpha = 0.35 + Math.random() * 0.65;
      ctx.fillText(Math.random() < 0.5 ? '0' : '1', c * 16 + 2, r * 12 + 13);
    }
  }
  return new THREE.CanvasTexture(cv);
}

export function enableNexusForces() {
  if (!state.graph3d) return;
  const mods = [...new Set(state.allNodes.filter(n => n.module).map(n => n.module))];
  const N = mods.length || 1;
  const SHELL_R = 220;

  const clusterDir = new Map();
  mods.forEach((mod, i) => {
    const theta = (2 * Math.PI * i) / N;
    const phi   = i % 2 === 0 ? Math.PI * 0.5 : Math.PI * (0.30 + (i % 3) * 0.12);
    clusterDir.set(mod, {
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi),
      z: Math.sin(phi) * Math.sin(theta),
    });
  });

  state.graph3d.d3Force('nexusShell', alpha => {
    for (const n of state.allNodes) {
      if (n.__isNucleus && n.__nucleusRank === 0) continue;
      const r = Math.sqrt((n.x || 0) ** 2 + (n.y || 0) ** 2 + (n.z || 0) ** 2) || 1;
      const pull = (SHELL_R - r) / r * 0.14 * alpha;
      n.vx = (n.vx || 0) + (n.x || 0) * pull;
      n.vy = (n.vy || 0) + (n.y || 0) * pull;
      n.vz = (n.vz || 0) + (n.z || 0) * pull;
    }
  });

  state.graph3d.d3Force('nexusPetal', alpha => {
    for (const n of state.allNodes) {
      if (n.__isNucleus && n.__nucleusRank === 0) continue;
      const dir = clusterDir.get(n.module);
      if (!dir) continue;
      const r = Math.sqrt((n.x || 0) ** 2 + (n.y || 0) ** 2 + (n.z || 0) ** 2) || 1;
      n.vx = (n.vx || 0) + (dir.x * r - (n.x || 0)) * 0.05 * alpha;
      n.vy = (n.vy || 0) + (dir.y * r - (n.y || 0)) * 0.05 * alpha;
      n.vz = (n.vz || 0) + (dir.z * r - (n.z || 0)) * 0.05 * alpha;
    }
  });

  state.graph3d.d3Force('charge').strength(-126);
  state.graph3d.d3Force('link').distance(58);
  state.graph3d.d3ReheatSimulation();
}

export function disableNexusForces() {
  if (!state.graph3d) return;
  state.graph3d.d3Force('nexusShell', null);
  state.graph3d.d3Force('nexusPetal', null);
  state.graph3d.d3Force('charge').strength(-200);
  state.graph3d.d3Force('link').distance(90);
  state.graph3d.d3ReheatSimulation();
}

export function enableNexusShaders() {
  const THREE = window.THREE;
  if (!state.graph3d) return;
  if (!state.nexusBinaryTex) state.nexusBinaryTex = makeNexusBinaryTex();
  state.nexusUniforms.uTime.value = performance.now() / 1000;
  state.graph3d
    .nodeThreeObject(makeNexusNodeObject)
    .nodeThreeObjectExtend(false)
    .linkThreeObject(makeNexusEdgeObject)
    .linkPositionUpdate((obj, { start, end }) => {
      if (!obj) return;
      const pos = obj.geometry?.attributes?.position;
      if (!pos) return;
      const N = pos.count - 1;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pos.setXYZ(i, start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t, start.z + (end.z - start.z) * t);
      }
      pos.needsUpdate = true;
    })
    .linkWidth(0)
    .linkDirectionalParticles(0)
    .refresh();
  // Boost bloom for nexus
  if (state.nexusBloomRef) { state.nexusBloomRef.intensity = 5.5; state.nexusBloomRef.radius = 0.70; state.nexusBloomRef.luminanceThreshold = 0.10; }
  // Dim directional lights so the nucleus PointLight dominates
  if (window._sceneKeyLight)  window._sceneKeyLight.intensity  = 0.4;
  if (window._sceneFillLight) window._sceneFillLight.intensity = 0.2;
  // PointLight at nucleus origin
  const _scene = state.graph3d.scene();
  if (state.nucleusPointLight) _scene.remove(state.nucleusPointLight);
  state.nucleusPointLight = new THREE.PointLight(0xaabbff, 5.0, 2000, 2);
  state.nucleusPointLight.position.set(0, 0, 0);
  _scene.add(state.nucleusPointLight);
  // Lock nucleus node at origin
  const _nucleusNode = state.allNodes.find(n => n.__isNucleus && n.__nucleusRank === 0);
  if (_nucleusNode) { _nucleusNode.fx = 0; _nucleusNode.fy = 0; _nucleusNode.fz = 0; }
  enableNexusForces();
  buildNucleusLaser(_scene);
  buildNexusFiberBundles(_scene);
  state.nexusStarfieldRefs = addNexusStarfield(_scene);
  state.nexusGlowRingRefs  = addNexusGlowRings(_scene);
}

export function disableNexusShaders() {
  if (!state.graph3d) return;
  if (state.nucleusPointLight) { state.graph3d.scene().remove(state.nucleusPointLight); state.nucleusPointLight = null; }
  if (state.nucleusLaser) {
    const s = state.graph3d.scene();
    s.remove(state.nucleusLaser.inner); s.remove(state.nucleusLaser.outer); s.remove(state.nucleusLaser.glow);
    state.nucleusLaser = null;
  }
  state.nucleusCoronas = [];
  cleanupNexusFibers(state.graph3d.scene());
  if (state.nexusStarfieldRefs) { cleanupNexusStarfield(state.graph3d.scene(), state.nexusStarfieldRefs); state.nexusStarfieldRefs = null; }
  if (state.nexusGlowRingRefs) {
    state.nexusGlowRingRefs.rings.forEach(r => { state.graph3d.scene().remove(r); r.geometry.dispose(); r.material.dispose(); });
    state.nexusGlowRingRefs = null;
  }
  const _nucleusNode = state.allNodes.find(n => n.__isNucleus && n.__nucleusRank === 0);
  if (_nucleusNode) { delete _nucleusNode.fx; delete _nucleusNode.fy; delete _nucleusNode.fz; }
  disableNexusForces();
  state.graph3d
    .nodeThreeObject(null)
    .linkThreeObject(null)
    .linkPositionUpdate(null)
    .linkWidth(link => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const tId = typeof link.target === 'object' ? link.target.id : link.target;
      if (!state.liveActivityNodes.has(sId) && !state.liveActivityNodes.has(tId)) return 0.2;
      const eKey = [sId, tId].sort().join('|');
      return Math.min(2.2, 0.7 + (state.edgeFireCount.get(eKey) ?? 0) * 0.15);
    })
    .linkDirectionalParticles(2)
    .refresh();
  // Restore galaxy bloom
  if (state.nexusBloomRef) { state.nexusBloomRef.intensity = 2.8; state.nexusBloomRef.radius = 0.38; state.nexusBloomRef.luminanceThreshold = 0.20; }
  // Restore directional light intensities
  if (window._sceneKeyLight)  window._sceneKeyLight.intensity  = 2.5;
  if (window._sceneFillLight) window._sceneFillLight.intensity = 1.2;
}
