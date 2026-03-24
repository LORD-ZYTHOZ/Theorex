/**
 * voxel_nodes.js — 3D Voxel-Greeble node shells for Theorex NEXUS view
 * Requires: THREE (0.158.0), nexusUniforms, nodeSize (fn), coreMats, glowMats,
 *           allNodes, nodeActivity, nexusMode
 */

// ---------------------------------------------------------------------------
// Shell 0 — Core sphere ShaderMaterial (scrolling binary surface)
// ---------------------------------------------------------------------------

var SHELL0_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

var SHELL0_FRAG = /* glsl */`
uniform float     uTime;
uniform vec3      uColor;
uniform float     uActivity;
uniform sampler2D uCharAtlas;
varying vec2      vUv;

void main() {
  vec2 scrolledUV = vUv + vec2(uTime * 0.02, uTime * 0.015);
  // Tile into a 4x4 atlas cell — use scrolled UV to pick cell
  vec2 cell = vec2(
    mod(floor(scrolledUV.x * 4.0), 4.0),
    mod(floor(scrolledUV.y * 4.0), 4.0)
  ) / 4.0;
  vec2 localUV = fract(scrolledUV * 4.0) / 4.0;
  vec2 atlasUV = cell + localUV;
  float glyph = texture2D(uCharAtlas, atlasUV).r;

  // Base: tinted glyph intensity; bright flash on high activity
  vec3 col = mix(uColor, vec3(1.0), uActivity * 0.85);
  float alpha = mix(0.55, 1.0, glyph) * mix(0.6, 1.0, uActivity);
  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------
// Shell 1 — Code-orbit Points (Fibonacci sphere, char atlas, curl drift)
// ---------------------------------------------------------------------------

var SHELL1_VERT = /* glsl */`
uniform float uTime;
uniform float uActivity;
attribute float aCharIdx;
attribute float aPhase;
attribute vec3  aTangent;
varying float   vCharIdx;
varying float   vActivity;
varying float   vAlpha;

void main() {
  vec3 pos = position;

  // Tangential drift — moves along sphere surface, not outward
  float drift = uTime * 0.08 + aPhase;
  pos += aTangent * sin(drift) * 0.15;

  // On activation: faster drift + slight outward bloom
  pos += normalize(position) * uActivity * 0.3;

  vCharIdx  = aCharIdx;
  vActivity = uActivity;
  vAlpha    = 0.5 + 0.5 * sin(uTime * 1.2 + aPhase);

  vec4 mvPos  = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float baseSize = 1.8 + uActivity * 1.5;
  gl_PointSize   = clamp(baseSize * 250.0 / -mvPos.z, 1.0, 14.0);
}
`;

var SHELL1_FRAG = /* glsl */`
uniform sampler2D uCharAtlas;
uniform float     uCharFlip;
uniform vec3      uColor;
varying float     vCharIdx;
varying float     vActivity;
varying float     vAlpha;

void main() {
  float idx  = mod(vCharIdx + floor(uCharFlip * 0.05), 16.0);
  vec2 cell  = vec2(mod(idx, 4.0), floor(idx / 4.0)) / 4.0;
  vec2 uv    = cell + gl_PointCoord / 4.0;
  float a    = texture2D(uCharAtlas, uv).r;

  if (a < 0.08) discard;
  if (length(gl_PointCoord - 0.5) > 0.5) discard;

  vec3 col = mix(uColor, vec3(1.0), vActivity * 0.7);
  gl_FragColor = vec4(col, a * vAlpha * (0.4 + vActivity * 0.6));
}
`;

// ---------------------------------------------------------------------------
// nodeTokenStream(node) — deterministic char-atlas index array length 120
// ---------------------------------------------------------------------------

function nodeTokenStream(node) {
  var src     = ((node.name || '') + (node.module || '')).toUpperCase();
  var CHAR_MAP = {
    '0': 0,  '1': 1,  '2': 2,  '3': 3,
    'A': 4,  'B': 5,  'C': 6,  'D': 7,
    'E': 8,  'F': 9,  'X': 10, '+': 11
  };
  var raw = [];
  for (var i = 0; i < src.length; i++) {
    var ch  = src[i];
    var idx = (ch in CHAR_MAP)
      ? CHAR_MAP[ch]
      : (ch.charCodeAt(0) % 6) + 10;
    raw.push(idx);
  }
  if (raw.length === 0) raw = [0];

  var out = new Float32Array(120);
  for (var j = 0; j < 120; j++) {
    out[j] = raw[j % raw.length];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helper — Fibonacci sphere positions (unit sphere)
// ---------------------------------------------------------------------------

function _fibonacciSphere(n) {
  var positions = new Float32Array(n * 3);
  var phi       = Math.PI * (3.0 - Math.sqrt(5.0)); // golden angle
  for (var i = 0; i < n; i++) {
    var y    = 1.0 - (i / (n - 1)) * 2.0;
    var r    = Math.sqrt(Math.max(0, 1.0 - y * y));
    var theta = phi * i;
    positions[i * 3 + 0] = Math.cos(theta) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * r;
  }
  return positions;
}

// Precompute a tangent perpendicular to the radial direction at each position
function _fibonacciTangents(unitPos, n) {
  var tangents = new Float32Array(n * 3);
  var up       = new THREE.Vector3(0, 1, 0);
  var tmp      = new THREE.Vector3();
  var nrm      = new THREE.Vector3();
  for (var i = 0; i < n; i++) {
    nrm.set(unitPos[i * 3], unitPos[i * 3 + 1], unitPos[i * 3 + 2]);
    tmp.copy(up).cross(nrm);
    if (tmp.lengthSq() < 0.001) {
      tmp.set(1, 0, 0).cross(nrm);
    }
    tmp.normalize();
    tangents[i * 3 + 0] = tmp.x;
    tangents[i * 3 + 1] = tmp.y;
    tangents[i * 3 + 2] = tmp.z;
  }
  return tangents;
}

// ---------------------------------------------------------------------------
// Internal helper — build detail canvas sprite (Shell 2)
// ---------------------------------------------------------------------------

function _makeDetailSprite(node) {
  var W  = 512;  // 256 * 2x
  var H  = 256;  // 128 * 2x
  var canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Name — large, bright
  ctx.font        = 'bold 52px monospace';
  ctx.fillStyle   = '#ffffff';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(node.name || '', W / 2, H * 0.38);

  // Type badge
  ctx.font      = '28px monospace';
  ctx.fillStyle = '#88ffcc';
  ctx.fillText('[' + (node.type || 'node') + ']', W / 2, H * 0.64);

  // Module — muted
  ctx.font      = '24px monospace';
  ctx.fillStyle = '#557799';
  ctx.fillText(node.module || '', W / 2, H * 0.85);

  var tex        = new THREE.CanvasTexture(canvas);
  var mat        = new THREE.SpriteMaterial({
    map:         tex,
    transparent: true,
    opacity:     0.0,
    depthWrite:  false
  });
  var sprite     = new THREE.Sprite(mat);
  // Scale to world units (half-width ≈ 10 units)
  sprite.scale.set(20, 10, 1);
  sprite.renderOrder = 5;
  return sprite;
}

// ---------------------------------------------------------------------------
// makeVoxelNodeObject(node, charAtlasTex) — main factory
// ---------------------------------------------------------------------------

function makeVoxelNodeObject(node, charAtlasTex) {
  var group  = new THREE.Group();
  var sz     = nodeSize(node);   // caller-provided size fn
  var color  = (node.color !== undefined)
    ? new THREE.Color(node.color)
    : new THREE.Color(0x44ffaa);

  // ------------------------------------------------------------------
  // Shell 0 — Core sphere with scrolling char-atlas surface
  // ------------------------------------------------------------------
  var coreGeo = new THREE.SphereGeometry(sz, 32, 32);
  var coreMat = new THREE.ShaderMaterial({
    vertexShader:   SHELL0_VERT,
    fragmentShader: SHELL0_FRAG,
    transparent:    true,
    uniforms: {
      uTime:      { value: 0 },
      uColor:     { value: color.clone() },
      uActivity:  { value: 0 },
      uCharAtlas: { value: charAtlasTex }
    }
  });
  var coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.renderOrder = 1;
  group.add(coreMesh);

  // Track in shared coreMats proxy (existing contract)
  coreMats[node.id] = coreMat;

  // ------------------------------------------------------------------
  // BackSide glow — keep existing proxy pattern
  // ------------------------------------------------------------------
  var glowGeo = new THREE.SphereGeometry(sz * 5.0, 16, 16);
  var glowMat = new THREE.MeshBasicMaterial({
    color:       color.clone(),
    transparent: true,
    opacity:     0.40,
    side:        THREE.BackSide,
    depthWrite:  false
  });
  var glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.renderOrder = 0;
  group.add(glowMesh);

  glowMats[node.id] = glowMat;

  // ------------------------------------------------------------------
  // Shell 1 — Points on Fibonacci sphere
  // ------------------------------------------------------------------
  var N_PTS    = 100;
  var orbRadius = sz * 1.9;

  var unitPositions = _fibonacciSphere(N_PTS);
  var tangents      = _fibonacciTangents(unitPositions, N_PTS);
  var charIndices   = nodeTokenStream(node);  // length 120, we use first 100
  var phases        = new Float32Array(N_PTS);

  var scaledPositions = new Float32Array(N_PTS * 3);
  for (var i = 0; i < N_PTS; i++) {
    scaledPositions[i * 3 + 0] = unitPositions[i * 3 + 0] * orbRadius;
    scaledPositions[i * 3 + 1] = unitPositions[i * 3 + 1] * orbRadius;
    scaledPositions[i * 3 + 2] = unitPositions[i * 3 + 2] * orbRadius;
    phases[i] = Math.random() * Math.PI * 2;
  }

  var charSubset = new Float32Array(N_PTS);
  for (var j = 0; j < N_PTS; j++) {
    charSubset[j] = charIndices[j];
  }

  var shell1Geo = new THREE.BufferGeometry();
  shell1Geo.setAttribute('position', new THREE.BufferAttribute(scaledPositions, 3));
  shell1Geo.setAttribute('aCharIdx',  new THREE.BufferAttribute(charSubset, 1));
  shell1Geo.setAttribute('aPhase',    new THREE.BufferAttribute(phases, 1));
  shell1Geo.setAttribute('aTangent',  new THREE.BufferAttribute(tangents, 3));

  var shell1Mat = new THREE.ShaderMaterial({
    vertexShader:   SHELL1_VERT,
    fragmentShader: SHELL1_FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    uniforms: {
      uTime:      { value: 0 },
      uActivity:  { value: 0 },
      uCharFlip:  { value: 0 },
      uColor:     { value: color.clone() },
      uCharAtlas: { value: charAtlasTex }
    }
  });

  var shell1Points = new THREE.Points(shell1Geo, shell1Mat);
  shell1Points.renderOrder = 2;
  shell1Points.visible     = false;  // LOD — off by default
  group.add(shell1Points);

  group.userData.shell1 = {
    points: shell1Points,
    mat:    shell1Mat
  };

  // ------------------------------------------------------------------
  // Shell 2 — Detail sprite (billboard canvas texture)
  // ------------------------------------------------------------------
  var detailSprite = _makeDetailSprite(node);
  detailSprite.visible     = false;  // LOD — off by default
  detailSprite.renderOrder = 6;
  group.add(detailSprite);

  group.userData.detailSprite  = detailSprite;
  group.userData.detailVisible = false;

  // ------------------------------------------------------------------
  // Class orbit ring (keep existing torus for Class nodes)
  // ------------------------------------------------------------------
  if (node.type === 'Class') {
    var ringGeo = new THREE.TorusGeometry(sz * 2.2, sz * 0.08, 8, 64);
    var ringMat = new THREE.MeshBasicMaterial({
      color:       color.clone(),
      transparent: true,
      opacity:     0.55
    });
    var ringMesh = new THREE.Mesh(ringGeo, ringMat);
    // Tilt ring slightly for visual interest
    ringMesh.rotation.x = Math.PI / 5;
    ringMesh.renderOrder = 3;
    group.add(ringMesh);
  }

  // ------------------------------------------------------------------
  // Metadata for LOD + animation callers
  // ------------------------------------------------------------------
  group.userData.nodeId   = node.id;
  group.userData.coreMat  = coreMat;
  group.userData.glowMat  = glowMat;

  return group;
}

// ---------------------------------------------------------------------------
// updateVoxelNodeLOD(group, cameraPosition, nodeWorldPos)
// Call each frame for frustum-visible nodes
// ---------------------------------------------------------------------------

function updateVoxelNodeLOD(group, cameraPosition, nodeWorldPos) {
  var dist = cameraPosition.distanceTo(nodeWorldPos);

  // Shell 1 — orbit code points
  var shell1 = group.userData.shell1;
  if (shell1) {
    shell1.points.visible = (dist < 280);
  }

  // Shell 2 — detail sprite
  var sprite = group.userData.detailSprite;
  if (sprite) {
    var inRange = dist < 70;
    if (inRange) {
      var opacity = 1.0 - dist / 70.0;
      sprite.visible               = true;
      sprite.material.opacity      = Math.max(0, Math.min(1, opacity));
      group.userData.detailVisible = true;
    } else {
      sprite.visible               = false;
      group.userData.detailVisible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// activateVoxelNode(group, intensity)
// Call when a pulse arrives at this node
// ---------------------------------------------------------------------------

function activateVoxelNode(group, intensity) {
  var shell1 = group.userData.shell1;
  if (shell1 && shell1.mat.uniforms) {
    shell1.mat.uniforms.uActivity.value = Math.min(1.0, intensity);
  }
  // Also drive the core sphere brightness
  var coreMat = group.userData.coreMat;
  if (coreMat && coreMat.uniforms) {
    coreMat.uniforms.uActivity.value = Math.min(1.0, intensity);
  }
}

// ---------------------------------------------------------------------------
// updateVoxelNodes(time) — tick all uniforms for visible nodes
// Call from the main animation loop, passing elapsed seconds
// ---------------------------------------------------------------------------

function updateVoxelNodes(time) {
  for (var id in coreMats) {
    var cmat = coreMats[id];
    if (cmat && cmat.uniforms && cmat.uniforms.uTime !== undefined) {
      cmat.uniforms.uTime.value = time;
    }
  }

  // Walk allNodes groups to update shell1 time + charFlip
  if (typeof allNodes !== 'undefined') {
    allNodes.forEach(function(entry) {
      var group = entry.group;
      if (!group) return;
      var shell1 = group.userData.shell1;
      if (shell1 && shell1.mat.uniforms) {
        shell1.mat.uniforms.uTime.value     = time;
        shell1.mat.uniforms.uCharFlip.value = time; // modular math in shader
      }
      // Decay activity back to 0 over time
      var act = shell1
        ? shell1.mat.uniforms.uActivity.value
        : 0;
      if (act > 0) {
        var decayed = Math.max(0, act - 0.012);
        activateVoxelNode(group, decayed);
      }
    });
  }
}
