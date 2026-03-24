// systems/pulses.js — animatePulses (corona breathing) and flareNode
// IMPORTANT: Do NOT change logic in animatePulses or flareNode.
import { state } from '../state.js';
import { moduleColor, getBaseColor } from '../utils.js';
import { updateNucleusLaser } from '../objects/laser.js';
import { animateNexusFibers } from './fibers.js';

export function spawnPulse(srcNode, tgtNode, color, intensity) {
  const THREE = window.THREE;
  if (!state.graph3d) return;
  const geo = new THREE.SphereGeometry(1.8, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  state.graph3d.scene().add(mesh);
  state.activityPulses.push({ mesh, srcNode, tgtNode, progress: 0, speed: 0.007 + Math.random() * 0.009, intensity });
}

export function flareNode(nodeId) {
  const THREE = window.THREE;
  const core = state.coreMats.get(nodeId), glow = state.glowMats.get(nodeId);
  if (!core || !glow) return;
  // Snap to violet
  core.color.set('#9933ff'); core.emissive.set('#cc66ff');
  core.emissiveIntensity = 4.0;
  glow.color.set('#9933ff');
  glow.opacity = 0.7;
  // Ignite connected nebula filaments
  if (state.nexusMode && state.nexusFibers.length) {
    for (const f of state.nexusFibers) {
      if (f.srcId === nodeId || f.tgtId === nodeId) f.ignited = 1.0;
    }
  }
  // Decay back to module color after 400ms
  const node = state.nodeById.get(nodeId);
  setTimeout(() => {
    const col = getBaseColor(node ?? {}, state);
    core.color.set(col); core.emissive.set(col);
    core.emissiveIntensity = 0.75;
    glow.color.set(col);
    glow.opacity = 0.18;
  }, 420);
}

export function animatePulses() {
  const now = performance.now();
  // Tick nexus shader uTime
  state.nexusUniforms.uTime.value = now / 1000;
  // Nucleus heartbeat — corona breathing + bloom + light sync
  if (state.nexusMode && state.nucleusCoronas.length) {
    const t    = now / 1000;
    const beat = Math.sin(t * 0.8);
    state.nucleusCoronas.forEach((c, i) => {
      const freq = 0.8 - i * 0.12;
      const s    = Math.sin(t * freq + c.phase);
      c.mesh.scale.setScalar(1.0 + (0.04 + i * 0.025) * s);
      c.mesh.material.opacity = c.baseOpacity * (1.0 + 0.3 * s);
    });
    if (state.nexusBloomRef)     state.nexusBloomRef.intensity = 5.5 + 0.5 * beat;
    if (state.nucleusPointLight) state.nucleusPointLight.intensity = 5.0 + 1.0 * beat;
    updateNucleusLaser();
    animateNexusFibers();
    // Update nucleus edge braid weight from cumulative edgeFireCount
    if (state.graph3d) {
      const _links = state.graph3d.graphData().links;
      for (const _lnk of _links) {
        if (!_lnk.__nexusFiberMats) continue;
        const _sId  = typeof _lnk.source === 'object' ? _lnk.source.id : _lnk.source;
        const _tId  = typeof _lnk.target === 'object' ? _lnk.target.id : _lnk.target;
        const _eKey = [_sId, _tId].sort().join('|');
        const _fires = state.edgeFireCount.get(_eKey) ?? 0;
        const _w    = Math.min(1.0, 0.35 + _fires * 0.05);
        const _ss   = 0.40 + _w * 1.40;
        for (const _m of _lnk.__nexusFiberMats) {
          _m.uniforms.uWeight.value      = _w;
          _m.uniforms.uScrollSpeed.value = _ss;
        }
      }
    }
    if (state.nexusGlowRingRefs) state.nexusGlowRingRefs.tick(t);
    if (state.nexusStarfieldRefs) {
      state.nexusStarfieldRefs.close.rotation.y = t * 0.02;
      state.nexusStarfieldRefs.close.rotation.x = Math.sin(t * 0.1) * 0.05;
    }
  }
  const dead = [];
  for (const p of state.activityPulses) {
    p.progress += p.speed;
    if (p.progress >= 1) { dead.push(p); continue; }
    const { x: sx = 0, y: sy = 0, z: sz = 0 } = p.srcNode;
    const { x: tx = 0, y: ty = 0, z: tz = 0 } = p.tgtNode;
    const t = p.progress;
    p.mesh.position.set(sx + (tx - sx) * t, sy + (ty - sy) * t, sz + (tz - sz) * t);
    p.mesh.material.opacity = Math.sin(t * Math.PI) * p.intensity * 0.9;
    // Pulse brightens nearby node glow
    if (t < 0.15) {
      const g = state.glowMats.get(p.srcNode.id);
      if (g) g.opacity = Math.min(0.5, g.opacity + 0.08 * (1 - t / 0.15));
    }
    if (t > 0.85) {
      const g = state.glowMats.get(p.tgtNode.id);
      if (g) g.opacity = Math.min(0.5, g.opacity + 0.08 * ((t - 0.85) / 0.15));
    }
  }
  for (const p of dead) {
    state.graph3d?.scene().remove(p.mesh);
    state.activityPulses.splice(state.activityPulses.indexOf(p), 1);
    // Ignition flare — only for real-intensity pulses (not ambient hum)
    if (p.intensity > 0.15) flareNode(p.tgtNode.id);
  }
  // Node breathing — idle nodes pulse emissiveIntensity gently
  let nodeIdx = 0;
  for (const [id, mat] of state.coreMats) {
    const act = state.nodeActivity.get(id);
    if (!act || !act.level) {
      const breathAmp  = state.nexusMode ? 0.08 : 0.08;
      const breathBase = state.nexusMode ? 0.125 : 0.75;
      const breathe    = Math.sin(now / 1000 * 1.2 + nodeIdx * 0.37) * breathAmp;
      mat.emissiveIntensity = breathBase + breathe;
    }
    nodeIdx++;
  }
  // Decay glow back toward baseline
  for (const [, g] of state.glowMats) {
    if (g.opacity > 0.18) g.opacity = Math.max(0.18, g.opacity - 0.003);
  }
  requestAnimationFrame(animatePulses);
}
