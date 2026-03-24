// priority_pulses.js — Priority-based data pulse system for Theorex NEXUS view
// Depends on globals: THREE, nodeById, edgeFireCount, coreMats, nexusMode

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PULSE_PRIORITY = {
  CRITICAL: { speed: 0.030, jitter: 0.8, color: 0xff0040, trailLen: 0.15 },
  HIGH:     { speed: 0.022, jitter: 0.4, color: 0xff6a00, trailLen: 0.10 },
  MEDIUM:   { speed: 0.012, jitter: 0.1, color: 0x00e5ff, trailLen: 0.06 },
  LOW:      { speed: 0.005, jitter: 0.0, color: 0x1c5468, trailLen: 0.03 },
};

const MAX_ACTIVE_PULSES = 120;

const activePriorityPulses = []; // {curve, t, speed, head, trail, scene, tgtNode, priority, color, trailLen}

// ---------------------------------------------------------------------------
// ignitePathway
// ---------------------------------------------------------------------------

function ignitePathway(srcNode, tgtNode, priority, scene) {
  if (typeof priority !== 'string' || !PULSE_PRIORITY[priority]) {
    priority = 'MEDIUM';
  }

  const cfg = PULSE_PRIORITY[priority];

  // Build CatmullRomCurve3 from src to target with jitter midpoints
  const src = new THREE.Vector3(srcNode.x || 0, srcNode.y || 0, srcNode.z || 0);
  const tgt = new THREE.Vector3(tgtNode.x || 0, tgtNode.y || 0, tgtNode.z || 0);

  const midpoints = [];
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const mid = src.clone().lerp(tgt, t);
    const jitterAmt = cfg.jitter * src.distanceTo(tgt) * 0.25;
    mid.x += (Math.random() - 0.5) * jitterAmt;
    mid.y += (Math.random() - 0.5) * jitterAmt;
    mid.z += (Math.random() - 0.5) * jitterAmt;
    midpoints.push(mid);
  }

  const curve = new THREE.CatmullRomCurve3([src, ...midpoints, tgt]);

  // Head sphere: glowing, additive blending
  const headRadius = 2.0 + cfg.jitter * 1.5;
  const headGeo = new THREE.SphereGeometry(headRadius, 8, 8);
  const headMat = new THREE.MeshBasicMaterial({
    color: cfg.color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  const startPos = curve.getPoint(0);
  head.position.copy(startPos);
  scene.add(head);

  // Trail spheres: 5 spheres, decreasing opacity 0.6 → 0.1
  const trail = [];
  const trailGeo = new THREE.SphereGeometry(1.0, 6, 6);
  for (let i = 0; i < 5; i++) {
    const opacity = 0.6 - (i / 5) * 0.5; // 0.60, 0.50, 0.40, 0.30, 0.20 → clamped to 0.6→0.1 range
    const trailMat = new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: Math.max(0.1, 0.6 - i * 0.1),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trailMesh = new THREE.Mesh(trailGeo, trailMat);
    trailMesh.position.copy(startPos);
    scene.add(trailMesh);
    trail.push(trailMesh);
  }

  // For CRITICAL/HIGH: render a thin line showing full path at low opacity
  let pathLine = null;
  if (priority === 'CRITICAL' || priority === 'HIGH') {
    const pathPoints = curve.getPoints(64);
    const pathGeo = new THREE.BufferGeometry().setFromPoints(pathPoints);
    const pathMat = new THREE.LineBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    pathLine = new THREE.Line(pathGeo, pathMat);
    scene.add(pathLine);
  }

  activePriorityPulses.push({
    curve,
    t: 0,
    speed: cfg.speed,
    head,
    trail,
    pathLine,
    scene,
    tgtNode,
    priority,
    color: cfg.color,
    trailLen: cfg.trailLen,
  });
}

// ---------------------------------------------------------------------------
// animatePriorityPulses
// ---------------------------------------------------------------------------

function animatePriorityPulses() {
  for (let i = activePriorityPulses.length - 1; i >= 0; i--) {
    const p = activePriorityPulses[i];

    p.t += p.speed;

    if (p.t >= 1.0) {
      // Remove head from scene
      p.scene.remove(p.head);
      if (p.head.geometry) p.head.geometry.dispose();
      if (p.head.material) p.head.material.dispose();

      // Remove trail meshes from scene
      for (let j = 0; j < p.trail.length; j++) {
        p.scene.remove(p.trail[j]);
        if (p.trail[j].geometry) p.trail[j].geometry.dispose();
        if (p.trail[j].material) p.trail[j].material.dispose();
      }

      // Remove path line if present
      if (p.pathLine) {
        p.scene.remove(p.pathLine);
        if (p.pathLine.geometry) p.pathLine.geometry.dispose();
        if (p.pathLine.material) p.pathLine.material.dispose();
      }

      // Trigger arrival effect on target node
      if (p.tgtNode && p.tgtNode.id != null) {
        flareVoxelNode(p.tgtNode.id);
      }

      activePriorityPulses.splice(i, 1);
      continue;
    }

    // Position head at current t along curve
    const headPos = p.curve.getPoint(p.t);
    p.head.position.copy(headPos);

    // Per-frame jitter for CRITICAL/HIGH
    const jitterAmt = p.priority === 'CRITICAL' ? 0.5 : p.priority === 'HIGH' ? 0.2 : 0;
    if (jitterAmt > 0) {
      p.head.position.x += (Math.random() - 0.5) * jitterAmt;
      p.head.position.y += (Math.random() - 0.5) * jitterAmt;
      p.head.position.z += (Math.random() - 0.5) * jitterAmt;
    }

    // Fade envelope: sin ramp for natural fade in/out along path
    const fadeEnvelope = Math.sin(p.t * Math.PI);

    // Update trail positions and opacities
    for (let j = 0; j < p.trail.length; j++) {
      const trailT = Math.max(0, p.t - p.trailLen * (j + 1) / 5);
      const trailPos = p.curve.getPoint(trailT);
      p.trail[j].position.copy(trailPos);
      p.trail[j].material.opacity = (1 - j / 5) * 0.6 * fadeEnvelope;
    }
  }
}

// ---------------------------------------------------------------------------
// flareVoxelNode
// ---------------------------------------------------------------------------

function flareVoxelNode(nodeId) {
  const entry = coreMats ? coreMats.get(nodeId) : null;
  if (!entry) return;

  const { mat, baseColor } = entry;
  if (!mat) return;

  // Flash to white with high emissive intensity
  mat.color.setHex(0xffffff);
  if (mat.emissive) mat.emissive.setHex(0xffffff);
  if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 5.0;

  // Decay back to module color after 300ms
  setTimeout(function () {
    if (!mat) return;
    const restoreColor = baseColor != null ? baseColor : 0x00e5ff;
    mat.color.setHex(restoreColor);
    if (mat.emissive) mat.emissive.setHex(restoreColor);
    if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 1.0;
  }, 300);
}

// ---------------------------------------------------------------------------
// getPriorityFromEdge
// ---------------------------------------------------------------------------

function getPriorityFromEdge(link, nodeById) {
  // Explicit risk flag takes precedence
  if (link.risk === 'CRITICAL') return 'CRITICAL';
  if (link.risk === 'HIGH') return 'HIGH';

  // Nucleus edge: source or target node has rank 0
  const srcNode = nodeById ? nodeById.get(link.source) : null;
  const tgtNode = nodeById ? nodeById.get(link.target) : null;
  if ((srcNode && srcNode.rank === 0) || (tgtNode && tgtNode.rank === 0)) {
    return 'HIGH';
  }

  // Fire count threshold
  const eKey = link.source + '|' + link.target;
  const fireCount = edgeFireCount ? (edgeFireCount.get(eKey) || 0) : 0;
  if (fireCount > 5) return 'MEDIUM';

  return 'LOW';
}

// ---------------------------------------------------------------------------
// injectPriorityPulse — integration hook
// ---------------------------------------------------------------------------

function injectPriorityPulse(srcId, tgtId, scene) {
  // Enforce active pulse cap
  if (activePriorityPulses.length >= MAX_ACTIVE_PULSES) return;

  const srcNode = nodeById ? nodeById.get(srcId) : null;
  const tgtNode = nodeById ? nodeById.get(tgtId) : null;
  if (!srcNode || !tgtNode) return;

  // Build a minimal link object for priority determination
  const link = { source: srcId, target: tgtId };
  const priority = getPriorityFromEdge(link, nodeById);

  ignitePathway(srcNode, tgtNode, priority, scene);
}
