// systems/fibers.js — buildNexusFiberBundles, animateNexusFibers
// IMPORTANT: Do NOT change logic in these functions.
import { state } from '../state.js';
import { moduleColor } from '../utils.js';

export function buildNexusFiberBundles(scene) {
  const THREE = window.THREE;

  if (state.nexusFiberGroup) cleanupNexusFibers(scene);
  const group = new THREE.Group();
  state.nexusFiberGroup = group;
  state.nexusFibers = [];

  const links = state.graph3d.graphData().links;
  const SEGS  = 20;

  function buildFiber(srcNode, tgtNode, noiseAmt, baseOpacity, col) {
    const p0 = new THREE.Vector3(srcNode.x ?? 0, srcNode.y ?? 0, srcNode.z ?? 0);
    const p1 = new THREE.Vector3(tgtNode.x ?? 0, tgtNode.y ?? 0, tgtNode.z ?? 0);
    const dist = p0.distanceTo(p1);
    if (dist < 2) return;

    const c1 = p0.clone().lerp(p1, 0.33).add(
      new THREE.Vector3((Math.random() - 0.5) * dist * noiseAmt, (Math.random() - 0.5) * dist * noiseAmt, (Math.random() - 0.5) * dist * noiseAmt));
    const c2 = p0.clone().lerp(p1, 0.67).add(
      new THREE.Vector3((Math.random() - 0.5) * dist * noiseAmt, (Math.random() - 0.5) * dist * noiseAmt, (Math.random() - 0.5) * dist * noiseAmt));
    const pts = new THREE.CatmullRomCurve3([p0, c1, c2, p1]).getPoints(SEGS);

    const N    = pts.length;
    const base = new Float32Array(N * 3);
    const pos  = new Float32Array(N * 3);
    const dax  = new Float32Array(N * 3);
    pts.forEach((p, i) => {
      base[i * 3] = p.x; base[i * 3 + 1] = p.y; base[i * 3 + 2] = p.z;
      pos[i * 3]  = p.x; pos[i * 3 + 1]  = p.y; pos[i * 3 + 2]  = p.z;
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      dax[i * 3] = d.x; dax[i * 3 + 1] = d.y; dax[i * 3 + 2] = d.z;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: col.clone(), transparent: true, opacity: baseOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    group.add(line);

    const isNuc = (srcNode.__isNucleus && srcNode.__nucleusRank === 0) ||
                  (tgtNode.__isNucleus && tgtNode.__nucleusRank === 0);
    state.nexusFibers.push({
      geo, mat, base, dax,
      driftAmt:    dist * 0.022,
      phase:       Math.random() * Math.PI * 2,
      baseOpacity,
      baseColor:   col.clone(),
      isNucleusEdge: isNuc,
      srcId: srcNode.id, tgtId: tgtNode.id,
      ignited: 0,
    });
  }

  // ── Graph-edge fiber bundles ────────────────────────────────────────────────
  for (const link of links) {
    const src = typeof link.source === 'object' ? link.source : state.nodeById.get(link.source);
    const tgt = typeof link.target === 'object' ? link.target : state.nodeById.get(link.target);
    if (!src || !tgt) continue;
    const isNuc = (src.__isNucleus && src.__nucleusRank === 0) ||
                  (tgt.__isNucleus && tgt.__nucleusRank === 0);
    const col      = new THREE.Color(isNuc ? '#aaddff' : moduleColor(src.module ?? ''));
    const bundleN  = isNuc ? 4 : 1 + (((src.__degree || 0) > 5 || (tgt.__degree || 0) > 5) ? 1 : 0);
    const noiseAmt = isNuc ? 0.45 : 0.30;
    const baseOp   = isNuc ? 0.09 : 0.045;
    for (let b = 0; b < bundleN; b++) {
      buildFiber(src, tgt,
        noiseAmt + b * 0.08,
        baseOp * (0.5 + Math.random() * 0.5),
        col.clone().multiplyScalar(0.55 + Math.random() * 0.45));
    }
  }

  // ── Ambient fill filaments between hub nodes ────────────────────────────────
  const hubs = state.allNodes
    .filter(n => !n.__isNucleus)
    .sort((a, b) => (b.__degree || 0) - (a.__degree || 0))
    .slice(0, 16);
  const fillN = Math.min(40, hubs.length * 3);
  for (let i = 0; i < fillN; i++) {
    const a = hubs[Math.floor(Math.random() * hubs.length)];
    const b = hubs[Math.floor(Math.random() * hubs.length)];
    if (!a || !b || a.id === b.id) continue;
    const col = new THREE.Color(moduleColor(a.module ?? '')).multiplyScalar(0.35);
    buildFiber(a, b, 0.55, 0.02 + Math.random() * 0.02, col);
  }

  // ── Orbital atmosphere filaments — short arcs wrapping the nucleus ──────────
  const ORBIT_RADII = [32, 48, 65];
  const colors = ['#aaddff', '#88aaff', '#cc88ff', '#ffaa44', '#44ffcc'];
  for (let ri = 0; ri < ORBIT_RADII.length; ri++) {
    const R = ORBIT_RADII[ri];
    const count = 6 + ri * 3;
    for (let j = 0; j < count; j++) {
      const baseAngle = (j / count) * Math.PI * 2;
      const elev = (Math.random() - 0.5) * Math.PI * 0.8;
      const arcSpan = 0.5 + Math.random() * 0.8;
      const pts = [];
      for (let s = 0; s <= 12; s++) {
        const a = baseAngle + (s / 12) * arcSpan - arcSpan * 0.5;
        const r = R * (0.9 + Math.random() * 0.2);
        pts.push(new THREE.Vector3(
          Math.cos(a) * Math.cos(elev) * r,
          Math.sin(elev) * r,
          Math.sin(a) * Math.cos(elev) * r
        ));
      }
      const col = new THREE.Color(colors[(ri * 3 + j) % colors.length]).multiplyScalar(0.5);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const base = new Float32Array(pts.length * 3);
      const dax  = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => {
        base[i * 3] = p.x; base[i * 3 + 1] = p.y; base[i * 3 + 2] = p.z;
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        dax[i * 3] = d.x; dax[i * 3 + 1] = d.y; dax[i * 3 + 2] = d.z;
      });
      const mat = new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0.12 - ri * 0.02,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      group.add(new THREE.Line(geo, mat));
      state.nexusFibers.push({
        geo, mat, base, dax,
        driftAmt: R * 0.015, phase: Math.random() * Math.PI * 2,
        baseOpacity: mat.opacity, baseColor: col.clone(),
        isNucleusEdge: true, srcId: null, tgtId: null, ignited: 0,
      });
    }
  }

  scene.add(group);
}

export function animateNexusFibers() {
  if (!state.nexusFibers.length) return;
  const THREE = window.THREE;
  const t      = state.nexusUniforms.uTime.value;
  const VIOLET = new THREE.Color('#aa33ff');
  const TENSION = 0.85;

  for (const f of state.nexusFibers) {
    const pos = f.geo.attributes.position.array;
    const N   = pos.length / 3;
    const da  = f.driftAmt;

    // Pull physics: check if either endpoint node is being dragged
    const srcDrag = state.draggedNodes.get(f.srcId);
    const tgtDrag = state.draggedNodes.get(f.tgtId);
    let pullSrcX = 0, pullSrcY = 0, pullSrcZ = 0;
    let pullTgtX = 0, pullTgtY = 0, pullTgtZ = 0;
    if (srcDrag) {
      pullSrcX = srcDrag.x - f.base[0];
      pullSrcY = srcDrag.y - f.base[1];
      pullSrcZ = srcDrag.z - f.base[2];
    }
    if (tgtDrag) {
      const ti = (N - 1) * 3;
      pullTgtX = tgtDrag.x - f.base[ti];
      pullTgtY = tgtDrag.y - f.base[ti + 1];
      pullTgtZ = tgtDrag.z - f.base[ti + 2];
    }

    // Breathing: swell and contract like umbilical cord
    const breathScale = 1.0 + 0.4 * Math.sin(t * 0.6 + f.phase * 1.7);
    for (let i = 0; i < N; i++) {
      const wave = Math.sin(t * 0.45 + f.phase + i * 0.42) * da * breathScale;
      const bi   = i * 3;
      let px = f.base[bi]     + f.dax[bi]     * wave;
      let py = f.base[bi + 1] + f.dax[bi + 1] * wave;
      let pz = f.base[bi + 2] + f.dax[bi + 2] * wave;
      if (srcDrag || tgtDrag) {
        const sf = ((N - 1 - i) / (N - 1)) * TENSION;
        const tf = (i / (N - 1)) * TENSION;
        px += pullSrcX * sf + pullTgtX * tf;
        py += pullSrcY * sf + pullTgtY * tf;
        pz += pullSrcZ * sf + pullTgtZ * tf;
      }
      pos[bi] = px; pos[bi + 1] = py; pos[bi + 2] = pz;
    }
    f.geo.attributes.position.needsUpdate = true;

    // Opacity breathing + ignition decay
    if (f.ignited > 0) {
      f.ignited = Math.max(0, f.ignited - 0.018);
      f.mat.opacity = f.baseOpacity + f.ignited * (f.isNucleusEdge ? 0.55 : 0.30);
      f.mat.color.lerpColors(f.baseColor, VIOLET, Math.min(1, f.ignited * 1.6));
    } else {
      f.mat.opacity = f.baseOpacity * (0.7 + 0.3 * Math.sin(t * 0.35 + f.phase));
      f.mat.color.copy(f.baseColor);
    }
  }
}

export function cleanupNexusFibers(scene) {
  if (!state.nexusFiberGroup) return;
  scene.remove(state.nexusFiberGroup);
  state.nexusFiberGroup.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  state.nexusFiberGroup = null;
  state.nexusFibers = [];
}
