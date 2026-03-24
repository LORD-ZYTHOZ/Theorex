// objects/edge.js — NEXUS edge mesh builders (liquid fiber bundles)
import { state } from '../state.js';
import { moduleColor } from '../utils.js';
import { NEXUS_EDGE_VERT, NEXUS_EDGE_FRAG } from '../shaders/edge.js';

export function makeNexusEdgeObject(link) {
  const THREE = window.THREE;

  const sId = typeof link.source === 'object' ? link.source.id : link.source;
  const tId = typeof link.target === 'object' ? link.target.id : link.target;
  const src = typeof link.source === 'object' ? link.source : state.nodeById.get(link.source);
  const tgt = typeof link.target === 'object' ? link.target : state.nodeById.get(link.target);
  if (!src || !tgt) return null;

  const isNucleusEdge = (src.__isNucleus && src.__nucleusRank === 0) || (tgt.__isNucleus && tgt.__nucleusRank === 0);
  const isActive      = isNucleusEdge || state.liveActivityNodes.has(sId) || state.liveActivityNodes.has(tId);
  const col           = new THREE.Color(isNucleusEdge ? '#aaddff' : moduleColor(src.module ?? ''));

  const P0 = new THREE.Vector3(src.x ?? 0, src.y ?? 0, src.z ?? 0);
  const P1 = new THREE.Vector3(tgt.x ?? 0, tgt.y ?? 0, tgt.z ?? 0);
  const spine    = new THREE.Vector3().subVectors(P1, P0);
  const spineLen = spine.length();
  const spineDir = spine.clone().normalize();
  const up    = Math.abs(spineDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const perp1 = new THREE.Vector3().crossVectors(spineDir, up).normalize();
  const perp2 = new THREE.Vector3().crossVectors(spineDir, perp1).normalize();

  const SEGS       = 28;
  const noiseAmp   = isNucleusEdge ? spineLen * 0.10 : spineLen * 0.055;

  // Nucleus edges: 8-fiber braid with weight-gated visibility per fiber.
  // Non-nucleus edges: 3 fibers always-on.
  const MAX_FIBERS = isNucleusEdge ? 8 : 3;

  function makeLineMat(color, threshold = 0.0) {
    const scrollSpeed = isActive ? 0.6 + (isNucleusEdge ? 0.8 : 0.0) : 0.05;
    const initWeight  = isNucleusEdge ? 0.35 : 1.0;
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime:        state.nexusUniforms.uTime,
        uColor:       { value: color },
        uActive:      { value: isActive ? 1.0 : 0.0 },
        uBoost:       { value: isNucleusEdge ? 1.0 : 0.0 },
        uScrollSpeed: { value: scrollSpeed },
        uWeight:      { value: initWeight },
        uThreshold:   { value: threshold },
      },
      vertexShader: NEXUS_EDGE_VERT, fragmentShader: NEXUS_EDGE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  const group    = new THREE.Group();
  const fiberMats = [];

  for (let fi = 0; fi < MAX_FIBERS; fi++) {
    const threshold  = isNucleusEdge ? (fi / MAX_FIBERS) * 0.92 : 0.0;
    const radiusMult = isNucleusEdge ? 0.60 + (fi / (MAX_FIBERS - 1)) * 1.00 : 1.0;
    const fiberNoiseAmp = noiseAmp * radiusMult;

    let fc;
    if (fi === 0) {
      fc = col.clone();
    } else {
      const tf = fi % 2 === 1 ? 0.35 : 0.20;
      fc = new THREE.Color(
        Math.min(1, col.r * (1 - tf) + tf),
        Math.min(1, col.g * (1 - tf) + tf * 0.7),
        Math.min(1, col.b * (1 - tf) + tf * 1.2)
      ).multiplyScalar(isNucleusEdge ? 0.85 : 0.65);
    }

    function makeFiberGeoScaled(fi, cnt) {
      const angleBase = (fi / cnt) * Math.PI * 2;
      const off1 = perp1.clone().multiplyScalar(Math.cos(angleBase + 0.6) * fiberNoiseAmp)
        .addScaledVector(perp2, Math.sin(angleBase + 0.6) * fiberNoiseAmp);
      const off2 = perp1.clone().multiplyScalar(Math.cos(angleBase - 0.6) * fiberNoiseAmp)
        .addScaledVector(perp2, Math.sin(angleBase - 0.6) * fiberNoiseAmp);
      const gravityPull = isNucleusEdge ? 0.12 : 0.22;
      const cp1   = P0.clone().lerp(P1, 0.33).add(off1).lerp(new THREE.Vector3(0, 0, 0), gravityPull);
      const cp2   = P0.clone().lerp(P1, 0.67).add(off2).lerp(new THREE.Vector3(0, 0, 0), gravityPull);
      const curve = new THREE.CatmullRomCurve3([P0.clone(), cp1, cp2, P1.clone()]);
      const pts   = curve.getPoints(SEGS);
      const pos = new Float32Array((SEGS + 1) * 3);
      const prg = new Float32Array(SEGS + 1);
      for (let i = 0; i <= SEGS; i++) {
        pos[i * 3] = pts[i].x; pos[i * 3 + 1] = pts[i].y; pos[i * 3 + 2] = pts[i].z;
        prg[i] = i / SEGS;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',  new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aProgress', new THREE.BufferAttribute(prg, 1));
      return geo;
    }

    const mat = makeLineMat(fc, threshold);
    fiberMats.push(mat);
    if (fi === 0) link.__nexusEdgeMat = mat;
    group.add(new THREE.Line(makeFiberGeoScaled(fi, MAX_FIBERS), mat));
  }

  if (isNucleusEdge) link.__nexusFiberMats = fiberMats;

  // Nucleus edges: midpoint glow sprite for extra luminosity
  if (isNucleusEdge) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      color: col.clone(), transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    sp.position.set(
      ((src.x ?? 0) + (tgt.x ?? 0)) * 0.5,
      ((src.y ?? 0) + (tgt.y ?? 0)) * 0.5,
      ((src.z ?? 0) + (tgt.z ?? 0)) * 0.5
    );
    sp.scale.set(4.5, 4.5, 1);
    group.add(sp);
  }

  return group;
}
