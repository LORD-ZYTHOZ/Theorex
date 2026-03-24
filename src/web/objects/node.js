// objects/node.js — makeNexusNodeObject: voxel binary point cloud for regular NEXUS nodes
import { state } from '../state.js';
import { nodeSize, getBaseColor } from '../utils.js';
import { NEXUS_NODE_VERT, NEXUS_NODE_FRAG } from '../shaders/node.js';
import { makeNucleusObject } from './nucleus.js';

export function makeNexusNodeObject(node) {
  const THREE = window.THREE;

  // Nucleus: highest-degree node gets the blazing stellar core treatment
  if (node.__isNucleus && node.__nucleusRank === 0) return makeNucleusObject(node);

  const size  = nodeSize(node);
  const col   = new THREE.Color(getBaseColor(node, state));
  const group = new THREE.Group();

  // ── Per-type hierarchy ──────────────────────────────────────────────────────
  const isClass  = node.type === 'Class';
  const isMethod = node.type === 'Method';
  const SHELL_COUNT = isClass ? 500 : isMethod ? 280 : 120;
  const INNER_COUNT = isClass ? 80  : isMethod ? 40  : 20;
  const TOTAL       = SHELL_COUNT + INNER_COUNT;

  function randChar() {
    const r = Math.random();
    if (isClass)  return r < 0.25 ? 0.0 : r < 0.5 ? 0.33 : r < 0.75 ? 0.66 : 1.0;
    if (isMethod) return r < 0.5  ? 0.0 : 1.0;
    return 0.0;
  }

  // ── 1. Voxel binary point cloud ─────────────────────────────────────────────
  const positions   = new Float32Array(TOTAL * 3);
  const phaseOffset = new Float32Array(TOTAL);
  const orbitAxis   = new Float32Array(TOTAL * 3);
  const charType    = new Float32Array(TOTAL);

  const goldenAngle = Math.PI * (3.0 - Math.sqrt(5.0));
  // Outer Fibonacci shell
  for (let i = 0; i < SHELL_COUNT; i++) {
    const y = 1.0 - (i / (SHELL_COUNT - 1)) * 2.0;
    const r = Math.sqrt(Math.max(0, 1.0 - y * y));
    const theta = goldenAngle * i;
    positions[i * 3]   = Math.cos(theta) * r * size;
    positions[i * 3 + 1] = y * size;
    positions[i * 3 + 2] = Math.sin(theta) * r * size;
    phaseOffset[i]   = Math.random() * Math.PI * 2;
    charType[i]      = randChar();
    orbitAxis[i * 3]   = Math.random() * 2 - 1;
    orbitAxis[i * 3 + 1] = Math.random() * 2 - 1;
    orbitAxis[i * 3 + 2] = Math.random() * 2 - 1;
  }
  // Inner shell at 0.85× radius
  for (let i = 0; i < INNER_COUNT; i++) {
    const idx = SHELL_COUNT + i;
    const y = 1.0 - (i / (INNER_COUNT - 1)) * 2.0;
    const r = Math.sqrt(Math.max(0, 1.0 - y * y));
    const theta = goldenAngle * i * 1.618;
    const ir = size * 0.85;
    positions[idx * 3]   = Math.cos(theta) * r * ir;
    positions[idx * 3 + 1] = y * ir;
    positions[idx * 3 + 2] = Math.sin(theta) * r * ir;
    phaseOffset[idx] = Math.random() * Math.PI * 2;
    charType[idx]    = randChar();
    orbitAxis[idx * 3]   = Math.random() * 2 - 1;
    orbitAxis[idx * 3 + 1] = Math.random() * 2 - 1;
    orbitAxis[idx * 3 + 2] = Math.random() * 2 - 1;
  }

  const pcGeo = new THREE.BufferGeometry();
  pcGeo.setAttribute('position',     new THREE.BufferAttribute(positions,   3));
  pcGeo.setAttribute('aPhaseOffset', new THREE.BufferAttribute(phaseOffset, 1));
  pcGeo.setAttribute('aOrbitAxis',   new THREE.BufferAttribute(orbitAxis,   3));
  pcGeo.setAttribute('aCharType',    new THREE.BufferAttribute(charType,    1));

  const pcUniforms = {
    uTime:           { value: 0.0 },
    uPulse:          { value: 0.0 },
    uColor:          { value: new THREE.Color(col) },
    uDegree:         { value: node.__degree || 0 },
    uCameraDistance: { value: 400.0 },
  };
  const pcMat = new THREE.ShaderMaterial({
    uniforms: pcUniforms, vertexShader: NEXUS_NODE_VERT, fragmentShader: NEXUS_NODE_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pointCloud = new THREE.Points(pcGeo, pcMat);
  pointCloud.onBeforeRender = (_r, _s, camera) => {
    pcUniforms.uTime.value = performance.now() * 0.001;
    if (camera) pcUniforms.uCameraDistance.value = camera.position.length();
  };
  group.add(pointCloud);

  // ── 2. No-op glow proxy — sphere removed so chars are visible ──────────────
  // IMPORTANT: The color.set() is intentionally a no-op to prevent errors
  const glowMat = { _o: 0.18, get opacity() { return this._o; }, set opacity(v) { this._o = v; }, color: { set() {} } };

  // ── 3. Class orbit ring ─────────────────────────────────────────────────────
  if (node.type === 'Class') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size * 1.8, 0.35, 6, 24),
      new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending })
    );
    ring.rotation.x = Math.PI / 3; ring.rotation.z = Math.PI / 6;
    group.add(ring);
  }

  // ── coreMats proxy — routes emissiveIntensity → uPulse for white-hot ────────
  state.coreMats.set(node.id, {
    get color()              { return pcUniforms.uColor.value; },
    set color(v)             { pcUniforms.uColor.value.set(v); },
    get emissive()           { return pcUniforms.uColor.value; },
    set emissive(v)          { pcUniforms.uColor.value.set(v); },
    get emissiveIntensity()  { return pcUniforms.uPulse.value; },
    set emissiveIntensity(v) {
      pcUniforms.uPulse.value = Math.max(0, v);
      glowMat.opacity = Math.min(0.85, 0.25 * Math.max(0, v));
    },
    get opacity()            { return 1.0; },
    set opacity(v)           { glowMat.opacity = Math.max(0, v * 0.25); },
  });

  state.glowMats.set(node.id, glowMat);
  return group;
}
