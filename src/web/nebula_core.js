// nebula_core.js — Volumetric binary nebula core for Three.js 0.158.0
// Replaces nucleus in Theorex NEXUS view
// Kepler supernova remnant style: hollow torus + filamentary tendrils

// ---------------------------------------------------------------------------
// 1. GLSL Simplex Noise — Stefan Gustavson / Ashima Arts (full implementation)
// ---------------------------------------------------------------------------
const SIMPLEX_NOISE_GLSL = `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 10.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// ---------------------------------------------------------------------------
// 2. Char Atlas Canvas Texture
// ---------------------------------------------------------------------------
function makeCharAtlasTex() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, 128, 128);

  const chars = ['0','1','0','1','A','B','C','D','E','F','X','+','0','1','0','1'];
  ctx.fillStyle = 'white';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < 16; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const cx = col * 32 + 16;
    const cy = row * 32 + 16;
    ctx.fillText(chars[i], cx, cy);
  }

  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// 3. Vertex Shader
// ---------------------------------------------------------------------------
const NEBULA_CORE_VERT = SIMPLEX_NOISE_GLSL + `
uniform float uTime;
uniform float uActivity;
uniform vec3  uIgniteDir;

attribute float aPhase;
attribute float aLayer;
attribute float aCharIdx;
attribute float aBaseRadius;

varying float vLayer;
varying float vCharIdx;
varying float vAlpha;

void main() {
  vLayer   = aLayer;
  vCharIdx = aCharIdx;

  // Curl noise — divergence-free simmering, NO radial outward motion
  vec3 p = position * 0.04;

  float nx = snoise(p + vec3(0.0, 0.0, uTime * 0.08 + aPhase));
  float ny = snoise(p + vec3(1.7, 0.0, uTime * 0.06 + aPhase));
  float nz = snoise(p + vec3(0.0, 3.4, uTime * 0.07 + aPhase));

  // Curl: approximate cross product of noise gradients
  vec3 curl = vec3(
    snoise(p + vec3(0.0, 0.01, 0.0) + vec3(0.0, 0.0,  uTime * 0.06)) - ny,
    snoise(p + vec3(0.0, 0.0,  0.01) + vec3(0.0, 3.4,  uTime * 0.07)) - nz,
    snoise(p + vec3(0.01, 0.0, 0.0) + vec3(1.7, 0.0,  uTime * 0.08)) - nx
  ) * 12.0;

  vec3 pos = position + curl * 0.6;

  // Activity pull toward ignite direction
  if (uActivity > 0.1) {
    float pull = uActivity * 0.4 * smoothstep(0.0, 1.0, uActivity);
    pos = mix(pos, uIgniteDir * aBaseRadius, pull * (1.0 - aLayer * 0.3));
  }

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPos;

  // Point size by layer, attenuated by distance
  float dist = -mvPos.z;
  float baseSize;
  if (aLayer < 0.5) {
    baseSize = 3.5;
  } else if (aLayer < 1.5) {
    baseSize = 2.0;
  } else {
    baseSize = 1.2;
  }
  gl_PointSize = baseSize * (300.0 / max(dist, 1.0));

  // Alpha fades with distance and by layer
  float layerAlpha = 1.0 - aLayer * 0.2;
  vAlpha = layerAlpha * clamp(200.0 / max(dist, 1.0), 0.1, 1.0);
}
`;

// ---------------------------------------------------------------------------
// 4. Fragment Shader
// ---------------------------------------------------------------------------
const NEBULA_CORE_FRAG = `
uniform float     uTime;
uniform float     uActivity;
uniform sampler2D uCharAtlas;
uniform float     uCharFlip;

varying float vLayer;
varying float vCharIdx;
varying float vAlpha;

void main() {
  // Circular clip
  vec2 pc = gl_PointCoord - 0.5;
  if (dot(pc, pc) > 0.25) discard;

  // Sample character from 4x4 atlas
  float charIdx = mod(vCharIdx + floor(uCharFlip + vCharIdx * 0.1), 16.0);
  vec2 cell = vec2(mod(charIdx, 4.0), floor(charIdx / 4.0)) / 4.0;
  vec2 uv   = cell + gl_PointCoord / 4.0;
  float alpha = texture2D(uCharAtlas, uv).r;
  if (alpha < 0.08) discard;

  // Color by layer + activity
  vec3 color;
  if (vLayer < 0.5) {
    // Layer 0: hot core — purple → gold
    color = mix(vec3(0.8, 0.3, 1.0), vec3(1.0, 0.9, 0.5), uActivity);
  } else if (vLayer < 1.5) {
    // Layer 1: filaments — navy → cyan
    color = mix(vec3(0.1, 0.3, 0.8), vec3(0.3, 0.9, 1.0), uActivity);
  } else {
    // Layer 2: outer tendrils — dark → violet
    color = mix(vec3(0.05, 0.1, 0.3), vec3(0.5, 0.2, 0.8), uActivity);
  }

  gl_FragColor = vec4(color, alpha * vAlpha);
}
`;

// ---------------------------------------------------------------------------
// 5. makeNebulaCoreObject(node, charAtlasTex)
// ---------------------------------------------------------------------------
function makeNebulaCoreObject(node, charAtlasTex) {
  const group = new THREE.Group();
  group.position.copy(node.position || new THREE.Vector3());

  const ns = nodeSize; // global

  // ---- Particle arrays ----
  const totalPts = 1500;
  const positions  = new Float32Array(totalPts * 3);
  const aPhaseArr  = new Float32Array(totalPts);
  const aLayerArr  = new Float32Array(totalPts);
  const aCharArr   = new Float32Array(totalPts);
  const aBaseRadArr= new Float32Array(totalPts);

  let idx = 0;

  // Helper: random in [-1,1]
  function rnd() { return Math.random() * 2.0 - 1.0; }

  // --- Layer 0: 300 pts — hot torus ring ---
  const rMajor = ns * 3.5;
  const rMinor = ns * 2.0;
  for (let i = 0; i < 300; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.random() * Math.PI * 2;
    const x = (rMajor + rMinor * Math.cos(phi)) * Math.cos(theta) + rnd() * ns * 1.5;
    const y = rMinor * Math.sin(phi)                               + rnd() * ns * 1.5;
    const z = (rMajor + rMinor * Math.cos(phi)) * Math.sin(theta) + rnd() * ns * 1.5;

    positions[idx*3]     = x;
    positions[idx*3 + 1] = y;
    positions[idx*3 + 2] = z;
    aPhaseArr[idx]   = Math.random() * Math.PI * 2;
    aLayerArr[idx]   = 0.0;
    aCharArr[idx]    = Math.floor(Math.random() * 16);
    aBaseRadArr[idx] = Math.sqrt(x*x + y*y + z*z);
    idx++;
  }

  // --- Layer 1: 800 pts — filament cloud sphere ---
  for (let i = 0; i < 800; i++) {
    // Cube-root for uniform radial distribution in shell ns*2 – ns*8
    const rMin = ns * 2, rMax = ns * 8;
    const u = Math.random();
    const r = Math.cbrt(u * (rMax**3 - rMin**3) + rMin**3);
    const cosTheta = rnd();
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta*cosTheta));
    const phi = Math.random() * Math.PI * 2;

    const x = r * sinTheta * Math.cos(phi);
    const y = r * cosTheta;
    const z = r * sinTheta * Math.sin(phi);

    positions[idx*3]     = x;
    positions[idx*3 + 1] = y;
    positions[idx*3 + 2] = z;
    aPhaseArr[idx]   = Math.random() * Math.PI * 2;
    aLayerArr[idx]   = 1.0;
    aCharArr[idx]    = Math.floor(Math.random() * 16);
    aBaseRadArr[idx] = r;
    idx++;
  }

  // --- Layer 2: 400 pts — outer tendrils ---
  for (let i = 0; i < 400; i++) {
    const rMin = ns * 6, rMax = ns * 15;
    const u = Math.random();
    const r = Math.cbrt(u * (rMax**3 - rMin**3) + rMin**3);
    const cosTheta = rnd();
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta*cosTheta));
    const phi = Math.random() * Math.PI * 2;

    const x = r * sinTheta * Math.cos(phi);
    const y = r * cosTheta;
    const z = r * sinTheta * Math.sin(phi);

    positions[idx*3]     = x;
    positions[idx*3 + 1] = y;
    positions[idx*3 + 2] = z;
    aPhaseArr[idx]   = Math.random() * Math.PI * 2;
    aLayerArr[idx]   = 2.0;
    aCharArr[idx]    = Math.floor(Math.random() * 16);
    aBaseRadArr[idx] = r;
    idx++;
  }

  // ---- BufferGeometry ----
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',    new THREE.BufferAttribute(positions,   3));
  geo.setAttribute('aPhase',      new THREE.BufferAttribute(aPhaseArr,   1));
  geo.setAttribute('aLayer',      new THREE.BufferAttribute(aLayerArr,   1));
  geo.setAttribute('aCharIdx',    new THREE.BufferAttribute(aCharArr,    1));
  geo.setAttribute('aBaseRadius', new THREE.BufferAttribute(aBaseRadArr, 1));

  // ---- ShaderMaterial ----
  const nebulaMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:      nexusUniforms.uTime,        // shared global uniform
      uActivity:  { value: 0.0 },
      uIgniteDir: { value: new THREE.Vector3(1, 0, 0) },
      uCharAtlas: { value: charAtlasTex },
      uCharFlip:  { value: 0.0 }
    },
    vertexShader:   NEBULA_CORE_VERT,
    fragmentShader: NEBULA_CORE_FRAG,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    transparent: true
  });

  const points = new THREE.Points(geo, nebulaMat);
  group.add(points);

  // ---- BackSide corona spheres ----
  const coronaGeoA = new THREE.SphereGeometry(ns * 6,  32, 32);
  const coronaGeoB = new THREE.SphereGeometry(ns * 12, 32, 32);

  const coronaMatA = new THREE.MeshBasicMaterial({
    color:       0x330066,
    side:        THREE.BackSide,
    transparent: true,
    opacity:     0.12,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false
  });
  const coronaMatB = new THREE.MeshBasicMaterial({
    color:       0x110033,
    side:        THREE.BackSide,
    transparent: true,
    opacity:     0.06,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false
  });

  const coronaA = new THREE.Mesh(coronaGeoA, coronaMatA);
  const coronaB = new THREE.Mesh(coronaGeoB, coronaMatB);
  group.add(coronaA);
  group.add(coronaB);

  // ---- Store refs for animation ----
  group.userData.nebulaMat  = nebulaMat;
  group.userData.coronas    = [coronaA, coronaB];
  group.userData.coronaMats = [coronaMatA, coronaMatB];

  // ---- Proxy coreMats / glowMats (same contract as makeNucleusObject) ----
  coreMats.push(nebulaMat);
  if (typeof glowMats !== 'undefined') {
    glowMats.push(coronaMatA, coronaMatB);
  }

  return group;
}

// ---------------------------------------------------------------------------
// 6. animateNebulaCore(t)
// ---------------------------------------------------------------------------
function animateNebulaCore(t) {
  if (!nexusMode) return;

  // Find nucleus node
  const nucleusNode = allNodes.find(function(n) {
    return n.__isNucleus && n.__nucleusRank === 0;
  });
  if (!nucleusNode) return;

  const obj = nucleusNode.__object || nucleusNode.object;
  if (!obj) return;

  const mat = obj.userData && obj.userData.nebulaMat;
  if (!mat) return;

  // Char flip every 20 frames at 60fps
  mat.uniforms.uCharFlip.value = Math.floor(t * 60 / 20);

  // Activity: sum active levels from nodeActivity map, normalize 0-1
  let actSum = 0;
  let actCount = 0;
  if (typeof nodeActivity !== 'undefined' && nodeActivity) {
    nodeActivity.forEach(function(level) {
      actSum += level;
      actCount++;
    });
  }
  const activity = actCount > 0 ? Math.min(actSum / actCount, 1.0) : 0.0;
  mat.uniforms.uActivity.value = activity;

  // Corona heartbeat (same rhythm as nucleusCoronas)
  const coronaMats = obj.userData.coronaMats;
  if (coronaMats && coronaMats.length === 2) {
    const beat = 0.12 + 0.06 * Math.sin(t * Math.PI * 1.2);
    coronaMats[0].opacity = 0.12 + beat * activity;
    coronaMats[1].opacity = 0.06 + beat * 0.5 * activity;
  }
}
