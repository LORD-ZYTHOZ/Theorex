// objects/nucleus.js — makeNucleusObject: the blazing stellar core
import { state } from '../state.js';
import { nodeSize } from '../utils.js';
import { NUCLEUS_VERT, NUCLEUS_FRAG } from '../shaders/nucleus.js';

export function makeNucleusObject(node) {
  const THREE = window.THREE;

  // Fixed radius — independent of nodeSize() so cluster node size changes don't affect the core
  const _nucBase = Math.min(1 + Math.sqrt(node.__degree || 0) * 0.28, 3.2);
  const R = 5.5 * _nucBase * 5;

  // ── 2-tier nebula: dense inner core + wispy outer halo ─────────────────────
  const INNER = 600;
  const OUTER = 400;
  const TOTAL = INNER + OUTER;

  const posArr   = new Float32Array(TOTAL * 3);
  const phaseArr = new Float32Array(TOTAL);
  const freqArr  = new Float32Array(TOTAL);
  const ampArr   = new Float32Array(TOTAL);
  const zoneArr  = new Float32Array(TOTAL);
  const charArr  = new Float32Array(TOTAL);
  const innerArr = new Float32Array(TOTAL);

  function fillPt(idx, rMin, rMax, isInner) {
    const r     = R * (rMin + Math.cbrt(Math.random()) * (rMax - rMin));
    const theta = Math.acos(2 * Math.random() - 1);
    const phi   = 2 * Math.PI * Math.random();
    const x = r * Math.sin(theta) * Math.cos(phi);
    const y = r * Math.sin(theta) * Math.sin(phi);
    const z = r * Math.cos(theta);
    posArr[idx * 3]   = x; posArr[idx * 3 + 1] = y; posArr[idx * 3 + 2] = z;
    phaseArr[idx]     = Math.random() * Math.PI * 2;
    freqArr[idx]      = isInner ? 0.30 + Math.random() * 0.25 : 0.10 + Math.random() * 0.18;
    ampArr[idx]       = isInner ? R * (0.08 + Math.random() * 0.10) : R * (0.14 + Math.random() * 0.16);
    const az          = Math.atan2(z, x);
    zoneArr[idx]      = Math.floor(((az + Math.PI) / (Math.PI * 2)) * 4) % 4;
    const cr          = Math.random();
    charArr[idx]      = cr < 0.25 ? 0.0 : cr < 0.50 ? 0.25 : cr < 0.75 ? 0.50 : 0.75;
    innerArr[idx]     = isInner ? 1.0 : 0.0;
  }

  for (let i = 0; i < INNER; i++) fillPt(i, 0.00, 0.55, true);
  for (let i = 0; i < OUTER; i++) fillPt(INNER + i, 0.55, 1.60, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',     new THREE.BufferAttribute(posArr,   3));
  geo.setAttribute('aPhaseOffset', new THREE.BufferAttribute(phaseArr, 1));
  geo.setAttribute('aDriftFreq',   new THREE.BufferAttribute(freqArr,  1));
  geo.setAttribute('aDriftAmp',    new THREE.BufferAttribute(ampArr,   1));
  geo.setAttribute('aZone',        new THREE.BufferAttribute(zoneArr,  1));
  geo.setAttribute('aCharType',    new THREE.BufferAttribute(charArr,  1));
  geo.setAttribute('aInner',       new THREE.BufferAttribute(innerArr, 1));

  const nucUniforms = {
    uTime:           state.nexusUniforms.uTime,
    uRadius:         { value: R },
    uCameraDistance: { value: 400.0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms:       nucUniforms,
    vertexShader:   NUCLEUS_VERT,
    fragmentShader: NUCLEUS_FRAG,
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
  });

  const group = new THREE.Group();
  const pts = new THREE.Points(geo, mat);
  pts.onBeforeRender = (_r, _s, camera) => {
    if (camera) nucUniforms.uCameraDistance.value = camera.position.length();
  };
  group.add(pts);

  // ── 3 BackSide corona spheres ──────────────────────────────────────────────
  const coronaDefs = [
    { r: R * 2,  opacity: 0.22, color: 0x8833ff, phase: Math.random() * Math.PI * 2 },
    { r: R * 5,  opacity: 0.09, color: 0x4411cc, phase: Math.random() * Math.PI * 2 },
    { r: R * 10, opacity: 0.04, color: 0x221166, phase: Math.random() * Math.PI * 2 },
  ];
  state.nucleusCoronas = [];
  for (const cd of coronaDefs) {
    const cMat = new THREE.MeshBasicMaterial({
      color: cd.color, transparent: true, opacity: cd.opacity,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const corona = new THREE.Mesh(new THREE.SphereGeometry(cd.r, 24, 24), cMat);
    group.add(corona);
    state.nucleusCoronas.push({ mesh: corona, baseOpacity: cd.opacity, phase: cd.phase });
  }

  // Disable raycasting on all visual children
  group.children.forEach(child => { child.raycast = () => {}; });

  // Tiny invisible hit-sphere at nucleus center
  const hitMesh = new THREE.Mesh(
    new THREE.SphereGeometry(nodeSize(node) * 1.8, 6, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  group.add(hitMesh);

  // Proxy coreMats so activation / breathing code doesn't crash
  state.coreMats.set(node.id, {
    get emissiveIntensity()    { return 4.0; },
    set emissiveIntensity(_v)  {},
    get color()                { return new THREE.Color(0xaaffff); },
    set color(_v)              {},
    get emissive()             { return new THREE.Color(0xaaffff); },
    set emissive(_v)           {},
    get opacity()              { return 1.0; },
    set opacity(_v)            {},
  });
  state.glowMats.delete(node.id);

  return group;
}
