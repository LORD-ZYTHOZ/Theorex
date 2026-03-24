// mode/brain.js — BRAIN mode: Killian hologram
import { state } from '../state.js';
import { moduleColor } from '../utils.js';

function seededRand(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return ((h >>> 0) % 10000) / 10000;
}

export function placeBrainNodes(nodes) {
  const THREE = window.THREE;
  const modules = [...new Set(nodes.map(n => n.module))];
  const modSectors = {};
  modules.forEach((mod, i) => {
    const frac = i / Math.max(modules.length, 1);
    modSectors[mod] = {
      theta: frac * Math.PI * 2 + 0.3,
      phi: Math.PI * 0.28 + (i % 3) * 0.30,
    };
  });
  const maxDeg = Math.max(...nodes.map(n => n.__degree || 0), 1);
  nodes.forEach(n => {
    const sec = modSectors[n.module] ?? { theta: 0, phi: Math.PI * 0.4 };
    const t = sec.theta + (seededRand(n.id + 'T') - 0.5) * 0.75;
    const p = sec.phi   + (seededRand(n.id + 'P') - 0.5) * 0.45;
    const r = 72 + (1 - ((n.__degree || 0) / maxDeg) * 0.45) * 165;
    n.__bp = new THREE.Vector3(
      r * Math.sin(p) * Math.cos(t) * 1.28,
      r * Math.cos(p) * 0.90,
      r * Math.sin(p) * Math.sin(t) * 0.76
    );
  });
}

export function buildBrainShell(scene) {
  const THREE = window.THREE;
  const geo = new THREE.IcosahedronGeometry(228, 4);
  const pos = geo.attributes.position;
  function brainNoise(nx, ny, nz) {
    let v = 0, amp = 1, freq = 1, maxAmp = 0;
    for (let o = 0; o < 4; o++) {
      v += (Math.sin(nx * 5.2 * freq + ny * 3.1 * freq) * Math.cos(ny * 4.7 * freq + nz * 2.9 * freq) * Math.sin(nz * 6.1 * freq + nx * 4.3 * freq)
          + Math.sin(nx * 2.8 * freq + nz * 5.6 * freq) * 0.5) * amp;
      maxAmp += amp; freq *= 1.9; amp *= 0.5;
    }
    return (v / maxAmp) * 0.13;
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z), nx = x / len, ny = y / len, nz = z / len;
    const n = brainNoise(nx, ny, nz);
    const frontal = Math.max(0, nz * 0.12) * (1 - Math.abs(nx) * 0.4);
    const asym = nx > 0 ? 0.03 : -0.015;
    pos.setXYZ(i, x * (1 + n + asym) * 1.28, y * (1 + n + frontal) * 0.92, z * (1 + n) * 0.76);
  }
  geo.computeVertexNormals();
  state.brainShellUniforms = {
    uTime:    { value: 0 },
    uColor:   { value: new THREE.Color(0x00e5ff) },
    uOpacity: { value: 0.055 },
  };
  const fresnelMat = new THREE.ShaderMaterial({
    uniforms: state.brainShellUniforms,
    vertexShader: `
      varying vec3 vNormal; varying vec3 vViewDir; varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz); vUv = uv;
        gl_Position = projectionMatrix * mvPos;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform float uOpacity;
      varying vec3 vNormal; varying vec3 vViewDir; varying vec2 vUv;
      void main() {
        float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 2.2);
        float scanline = sin(vUv.y * 220.0 + uTime * 1.5) * 0.022 + 0.022;
        float noise = sin(vUv.x * 45.0 + uTime * 0.9) * sin(vUv.y * 65.0 - uTime * 0.6) * 0.012;
        gl_FragColor = vec4(uColor, clamp(uOpacity * (1.0 + fresnel * 4.5 + scanline + noise), 0.0, 0.92));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  scene.add(new THREE.Mesh(geo, fresnelMat));
  scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 22),
    new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.065, blending: THREE.AdditiveBlending })));
  scene.add(new THREE.Mesh(new THREE.IcosahedronGeometry(210, 2),
    new THREE.MeshBasicMaterial({ color: 0x002233, transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false })));
  const ccPts = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ccPts.push(new THREE.Vector3(Math.cos(a) * 32, 8 - Math.abs(Math.sin(a)) * 18, Math.sin(a) * 22));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ccPts),
    new THREE.LineBasicMaterial({ color: 0xff44cc, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending })));
}

function makeCodeTextureLive(hexCol, name) {
  const THREE = window.THREE;
  const res = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext('2d');
  const rC = parseInt(hexCol.slice(1, 3), 16), gC = parseInt(hexCol.slice(3, 5), 16), bC = parseInt(hexCol.slice(5, 7), 16);
  const glyphPool = '01010110010100110011' + (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function draw(intensity = 1.0) {
    ctx.clearRect(0, 0, res, res);
    ctx.font = '7px "SF Mono","Fira Code",monospace';
    for (let row = 0; row < 18; row++) {
      for (let col2 = 0; col2 < 18; col2++) {
        const x = col2 * 7 + 1, y = row * 7 + 8;
        const dx = x + 3 - res / 2, dy = y - 3 - res / 2;
        const dist = Math.sqrt(dx * dx + dy * dy) / (res / 2 - 2);
        if (dist > 1) continue;
        const alpha = (1 - dist * dist) * (0.25 + Math.random() * 0.65) * intensity;
        ctx.fillStyle = `rgba(${rC},${gC},${bC},${alpha.toFixed(2)})`;
        ctx.fillText(glyphPool[Math.floor(Math.random() * glyphPool.length)] || '0', x, y);
      }
    }
    const grad = ctx.createRadialGradient(res / 2, res / 2, 0, res / 2, res / 2, res / 2);
    grad.addColorStop(0,    `rgba(${rC},${gC},${bC},${(0.35 * intensity).toFixed(2)})`);
    grad.addColorStop(0.45, `rgba(${rC},${gC},${bC},${(0.10 * intensity).toFixed(2)})`);
    grad.addColorStop(1,    `rgba(${rC},${gC},${bC},0.00)`);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(res / 2, res / 2, res / 2, 0, Math.PI * 2); ctx.fill();
  }
  draw();
  return { tex: new THREE.CanvasTexture(canvas), draw };
}

function activateBrainNodeSprite(nodeId, intensity) {
  const m = state.brainNodeMats.get(nodeId);
  if (!m?.draw) return;
  let frame = 0;
  const total = 12;
  const interval = setInterval(() => {
    frame++;
    m.draw(0.5 + intensity * (1 - frame / total));
    m.core.map.needsUpdate = true;
    if (frame >= total) { clearInterval(interval); m.draw(1.0); m.core.map.needsUpdate = true; }
  }, 100);
}

export function buildBrainNodes(scene, nodes) {
  const THREE = window.THREE;
  state.brainNodeMats = new Map(); state.brainMeshes = [];
  nodes.forEach(n => {
    if (!n.__bp) return;
    const col = moduleColor(n.module);
    const base = n.type === 'Class' ? 44 : n.type === 'Method' ? 30 : 22;
    const size = base * (1 + Math.sqrt(n.__degree || 0) * 0.10);
    const { tex, draw } = makeCodeTextureLive(col, n.name);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(size);
    sprite.position.copy(n.__bp);
    sprite.__nodeId = n.id;
    scene.add(sprite); state.brainMeshes.push(sprite);
    state.brainNodeMats.set(n.id, { core: mat, glow: null, draw });
  });
}

export function buildBrainFibers(scene, edges) {
  const THREE = window.THREE;
  state.brainFibers = []; state.brainBundles = [];
  const bundleMap = new Map();
  edges.forEach(e => {
    const src = state.nodeById.get(e.source?.id ?? e.source);
    const tgt = state.nodeById.get(e.target?.id ?? e.target);
    if (!src?.__bp || !tgt?.__bp) return;
    const key = src.module <= tgt.module ? `${src.module}|${tgt.module}` : `${tgt.module}|${src.module}`;
    if (!bundleMap.has(key)) bundleMap.set(key, { srcMod: src.module, tgtMod: tgt.module, pairs: [] });
    bundleMap.get(key).pairs.push({ src, tgt });
  });
  bundleMap.forEach(({ srcMod, tgtMod, pairs }) => {
    const intra = srcMod === tgtMod;
    const srcC = pairs.reduce((v, { src }) => v.add(src.__bp), new THREE.Vector3()).divideScalar(pairs.length);
    const tgtC = pairs.reduce((v, { tgt }) => v.add(tgt.__bp), new THREE.Vector3()).divideScalar(pairs.length);
    const pull = intra ? 0.72 : 0.48;
    const mid = srcC.clone().add(tgtC).multiplyScalar(0.5).multiplyScalar(pull);
    const bundleCurve = new THREE.CatmullRomCurve3([srcC.clone(), mid, tgtC.clone()]);
    const col = new THREE.Color(moduleColor(srcMod));
    const baseOpacity = intra ? 0.032 : 0.052;
    const tubeMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: baseOpacity, blending: THREE.AdditiveBlending, depthWrite: false });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(bundleCurve, 18, intra ? 0.6 : 1.0, 4, false), tubeMat));
    const bundleRef = { mat: tubeMat, srcMod, tgtMod, baseOpacity, lastActive: 0 };
    state.brainBundles.push(bundleRef);
    pairs.forEach(({ src, tgt }) => {
      const eMid = src.__bp.clone().add(tgt.__bp).multiplyScalar(0.5).multiplyScalar(pull);
      state.brainFibers.push({ curve: new THREE.CatmullRomCurve3([src.__bp.clone(), eMid, tgt.__bp.clone()]), srcId: src.id, tgtId: tgt.id, bundleRef });
    });
  });
}

export function addBrainStars(scene) {
  const THREE = window.THREE;
  const verts = [];
  for (let i = 0; i < 1400; i++) {
    const r = 650 + Math.random() * 900;
    const t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
    verts.push(r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x88ffff, size: 1.6, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending })));
}

export function spawnBrainPulse(curve, color, intensity) {
  const THREE = window.THREE;
  const headMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const head = new THREE.Mesh(new THREE.SphereGeometry(3.0, 6, 6), headMat);
  const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(7.0, 5, 5), haloMat);
  const trailMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
  const trail = new THREE.Line(new THREE.BufferGeometry(), trailMat);
  state.brainScene.add(head); state.brainScene.add(halo); state.brainScene.add(trail);
  state.brainPulses.push({ head, halo, trail, headMat, haloMat, trailMat, curve, progress: 0, speed: 0.005 + Math.random() * 0.009, intensity });
}

export function animateBrainPulses() {
  const THREE = window.THREE;
  const dead = [];
  for (const p of state.brainPulses) {
    p.progress += p.speed;
    if (p.progress >= 1) { dead.push(p); continue; }
    const pos = p.curve.getPoint(p.progress);
    const envelope = Math.sin(p.progress * Math.PI);
    p.head.position.copy(pos);
    p.headMat.opacity = envelope * p.intensity * 0.95;
    p.halo.position.copy(pos);
    p.halo.scale.setScalar(0.8 + Math.sin(p.progress * Math.PI * 4) * 0.3);
    p.haloMat.opacity = envelope * p.intensity * 0.35;
    const trailStart = Math.max(0, p.progress - 0.14);
    const tPts = [];
    for (let i = 0; i <= 7; i++) tPts.push(p.curve.getPoint(trailStart + (p.progress - trailStart) * i / 7));
    p.trail.geometry.dispose();
    p.trail.geometry = new THREE.BufferGeometry().setFromPoints(tPts);
    p.trailMat.opacity = envelope * p.intensity * 0.55;
  }
  dead.forEach(p => { state.brainScene.remove(p.head); state.brainScene.remove(p.halo); state.brainScene.remove(p.trail); state.brainPulses.splice(state.brainPulses.indexOf(p), 1); });
}

export function spawnNodeBurst(pos, color) {
  const THREE = window.THREE;
  const count = 9 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const speed = 25 + Math.random() * 35;
    const mat = new THREE.SpriteMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(4);
    sprite.position.copy(pos);
    state.brainScene.add(sprite);
    state.brainBurstParticles.push({ sprite, mat, vel: dir.multiplyScalar(speed), age: 0, maxAge: 0.5 + Math.random() * 0.3 });
  }
}

export function animateBrainBursts(dt) {
  const dead = [];
  for (const p of state.brainBurstParticles) {
    p.age += dt;
    if (p.age >= p.maxAge) { dead.push(p); continue; }
    p.sprite.position.addScaledVector(p.vel, dt);
    const frac = p.age / p.maxAge;
    p.mat.opacity = (1 - frac) * (1 - frac) * 0.9;
    p.sprite.scale.setScalar(4 + frac * 8);
  }
  dead.forEach(p => { state.brainScene.remove(p.sprite); state.brainBurstParticles.splice(state.brainBurstParticles.indexOf(p), 1); });
}

export function brainTriggerActivation(nodeId, intensity) {
  state.liveActivityNodes.add(nodeId);
  const visited = new Set();
  const queue = [{ id: nodeId, intens: intensity, depth: 0 }];
  while (queue.length) {
    const { id, intens, depth } = queue.shift();
    if (visited.has(id) || intens < 0.08) continue;
    visited.add(id);
    const mats = state.brainNodeMats.get(id);
    const delay = depth * 55;
    if (mats) setTimeout(() => {
      activateBrainNodeSprite(id, intens);
      if (depth === 0) { const n = state.nodeById.get(id); if (n?.__bp) spawnNodeBurst(n.__bp, moduleColor(n.module)); }
    }, delay);
    state.brainFibers.filter(f => f.srcId === id || f.tgtId === id).slice(0, depth === 0 ? 6 : 2).forEach((f, i) => {
      const br = f.bundleRef;
      if (br) {
        br.lastActive = Date.now();
        if (depth === 0) setTimeout(() => {
          br.mat.opacity = Math.max(br.mat.opacity, 0.65);
          spawnBrainPulse(f.curve, moduleColor(state.nodeById.get(id)?.module ?? ''), intens * 0.88);
          setTimeout(() => { br.mat.opacity = br.baseOpacity; }, 1000);
        }, delay + i * 80);
      }
      if (depth < 2) {
        const nId = f.srcId === id ? f.tgtId : f.srcId;
        if (!visited.has(nId)) queue.push({ id: nId, intens: intens * 0.45, depth: depth + 1 });
      }
    });
  }
}

export function runBrainAmbientNoise() {
  if (!state.brainMode || !state.brainFibers.length) return setTimeout(runBrainAmbientNoise, 2000);
  const f = state.brainFibers[Math.floor(Math.random() * state.brainFibers.length)];
  const THREE = window.THREE;
  spawnBrainPulse(f.curve, '#' + new THREE.Color(f.bundleRef?.mat.color ?? 0x00e5ff).getHexString(), 0.07);
  setTimeout(runBrainAmbientNoise, 1200 + Math.random() * 3200);
}

export function setBrainRenderMode(mode, clusterId) {
  state.brainRenderMode = mode; state.brainFocusCluster = clusterId ?? null;
  updateBrainBundleVisibility();
  if (mode === 'activeOnly') {
    state.brainMeshes.forEach(sprite => {
      const isLive = state.liveActivityNodes.has(sprite.__nodeId);
      sprite.material.opacity = isLive ? 0.88 : 0.10;
    });
    autoCameraRoute();
  } else {
    state.brainMeshes.forEach(sprite => { sprite.material.opacity = 0.88; });
  }
}

export function autoCameraRoute() {
  if (!state.brainMode || !state.liveActivityNodes.size) return;
  const liveNodes = [...state.liveActivityNodes]
    .map(id => state.nodeById.get(id))
    .filter(n => n && n.__bp)
    .sort((a, b) => (b.__degree || 0) - (a.__degree || 0))
    .slice(0, 6);
  if (!liveNodes.length) return;
  const cx = liveNodes.reduce((s, n) => s + n.__bp.x, 0) / liveNodes.length;
  const cy = liveNodes.reduce((s, n) => s + n.__bp.y, 0) / liveNodes.length;
  const cz = liveNodes.reduce((s, n) => s + n.__bp.z, 0) / liveNodes.length;
  const targetY = Math.atan2(cx, cz);
  const targetX = Math.atan2(cy, Math.sqrt(cx * cx + cz * cz)) * 0.6;
  const startY = state.brainOrbit.rotY, startX = state.brainOrbit.rotX;
  const steps = 30;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    const t = step / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    state.brainOrbit.rotY = startY + (targetY - startY) * ease;
    state.brainOrbit.rotX = startX + (targetX - startX) * ease;
    updateBrainCamera();
    if (step >= steps) clearInterval(timer);
  }, 50);
}

export function updateBrainBundleVisibility() {
  const now = Date.now();
  state.brainBundles.forEach(b => {
    let target;
    if (state.brainRenderMode === 'activeOnly') {
      target = (now - b.lastActive) < 5000 ? b.baseOpacity * 5 : b.baseOpacity * 0.08;
    } else if (state.brainRenderMode === 'clusterFocus' && state.brainFocusCluster) {
      const inF = b.srcMod === state.brainFocusCluster || b.tgtMod === state.brainFocusCluster;
      target = inF ? b.baseOpacity * 4 : b.baseOpacity * 0.05;
    } else {
      target = b.baseOpacity;
    }
    b.mat.opacity += (target - b.mat.opacity) * 0.08;
  });
}

export function updateBrainCamera() {
  const o = state.brainOrbit;
  state.brainCamera.position.set(
    o.radius * Math.sin(o.rotY) * Math.cos(o.rotX),
    o.radius * Math.sin(o.rotX),
    o.radius * Math.cos(o.rotY) * Math.cos(o.rotX)
  );
  state.brainCamera.lookAt(0, 0, 0);
}

export function setupBrainInteraction(container, showNodeDetail) {
  const THREE = window.THREE;
  container.addEventListener('mousedown', e => {
    state.brainOrbit.isDragging = true; state.brainOrbit.prevX = e.clientX; state.brainOrbit.prevY = e.clientY;
  });
  window.addEventListener('mouseup', () => { state.brainOrbit.isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!state.brainOrbit.isDragging || !state.brainMode) return;
    state.brainOrbit.rotY += (e.clientX - state.brainOrbit.prevX) * 0.005;
    state.brainOrbit.rotX += (e.clientY - state.brainOrbit.prevY) * 0.004;
    state.brainOrbit.rotX = Math.max(-1.3, Math.min(1.3, state.brainOrbit.rotX));
    state.brainOrbit.autoY = state.brainOrbit.rotY;
    state.brainOrbit.prevX = e.clientX; state.brainOrbit.prevY = e.clientY;
    updateBrainCamera();
  });
  container.addEventListener('wheel', e => {
    state.brainOrbit.radius = Math.max(260, Math.min(1400, state.brainOrbit.radius + e.deltaY * 0.5));
    updateBrainCamera(); e.preventDefault();
  }, { passive: false });
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  function ndcFromEvent(e) {
    const r = container.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  container.addEventListener('mousemove', e => {
    if (!state.brainMode) return;
    const now = Date.now(); if (now - state.brainLastRayCast < 60) return; state.brainLastRayCast = now;
    ndcFromEvent(e); raycaster.setFromCamera(mouse, state.brainCamera);
    const hits = raycaster.intersectObjects(state.brainMeshes);
    if (hits.length) {
      const node = state.nodeById.get(hits[0].object.__nodeId);
      if (node && node !== state.hoveredBrainNode) {
        if (state.hoveredBrainNode) { const pm = state.brainNodeMats.get(state.hoveredBrainNode.id); if (pm) { pm.core.opacity = 0.88; } }
        state.hoveredBrainNode = node;
        const m = state.brainNodeMats.get(node.id); if (m) { m.core.opacity = 1.0; }
        if (state.brainHudEl) {
          state.brainHudEl.style.left = Math.min(container.clientWidth - 260, e.offsetX + 20) + 'px';
          state.brainHudEl.style.top  = Math.max(10, e.offsetY - 40) + 'px';
          state.brainHudEl.innerHTML = `<div style="color:#00e5ff;font-weight:700;font-size:13px;margin-bottom:4px;text-shadow:0 0 10px rgba(0,229,255,0.6)">${node.name}</div><div style="color:#1c5468;font-size:10px;word-break:break-all;margin-bottom:6px">${node.filePath ?? ''}</div><div style="display:flex;gap:6px;flex-wrap:wrap"><span style="background:rgba(0,229,255,0.1);color:#00e5ff;padding:2px 7px;border:1px solid rgba(0,229,255,0.3);font-size:10px">${node.type}</span><span style="background:rgba(255,45,120,0.1);color:#ff2d78;padding:2px 7px;border:1px solid rgba(255,45,120,0.3);font-size:10px">${node.module}</span></div>`;
          state.brainHudEl.style.display = 'block';
        }
      }
    } else if (state.hoveredBrainNode) {
      const pm = state.brainNodeMats.get(state.hoveredBrainNode.id); if (pm) { pm.core.opacity = 0.88; }
      state.hoveredBrainNode = null; if (state.brainHudEl) state.brainHudEl.style.display = 'none';
    }
  });
  container.addEventListener('click', e => {
    if (!state.brainMode) return;
    ndcFromEvent(e); raycaster.setFromCamera(mouse, state.brainCamera);
    const hits = raycaster.intersectObjects(state.brainMeshes);
    if (hits.length) {
      const node = state.nodeById.get(hits[0].object.__nodeId);
      if (node) { showNodeDetail(node); brainTriggerActivation(node.id, 0.9); }
    }
  });
}

export function initBrainMode(showNodeDetail) {
  const THREE = window.THREE;
  const container = document.getElementById('brain-view');
  const W = container.clientWidth, H = container.clientHeight;
  state.brainRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  state.brainRenderer.setSize(W, H);
  state.brainRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  state.brainRenderer.localClippingEnabled = true;
  state.brainRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.brainRenderer.toneMappingExposure = 1.15;
  container.appendChild(state.brainRenderer.domElement);
  state.brainScene = new THREE.Scene();
  state.brainScene.background = new THREE.Color(0x010b14);
  state.brainScene.fog = new THREE.FogExp2(0x010b14, 0.00085);
  state.brainCamera = new THREE.PerspectiveCamera(55, W / H, 1, 4000);
  updateBrainCamera();
  state.brainScene.add(new THREE.AmbientLight(0x001a2e, 2.5));
  const kl = new THREE.PointLight(0x00e5ff, 4, 1000); kl.position.set(60, 320, 180); state.brainScene.add(kl);
  const fl = new THREE.PointLight(0xff2d78, 2.5, 700); fl.position.set(-220, -140, -200); state.brainScene.add(fl);
  placeBrainNodes(state.allNodes);
  buildBrainNodes(state.brainScene, state.allNodes);
  buildBrainFibers(state.brainScene, state.brainEdgesData);
  addBrainStars(state.brainScene);
  setupBrainInteraction(container, showNodeDetail);
  state.brainHudEl = document.createElement('div');
  state.brainHudEl.style.cssText = 'position:absolute;pointer-events:none;z-index:20;background:rgba(0,8,20,0.96);border:1px solid rgba(0,229,255,0.55);border-radius:2px;padding:10px 14px;font-family:"SF Mono","Fira Code",monospace;font-size:11px;color:#8ffcff;backdrop-filter:blur(8px);display:none;box-shadow:0 0 30px rgba(0,229,255,0.2);max-width:240px;';
  container.appendChild(state.brainHudEl);
  const scanGeo = new THREE.TorusGeometry(235, 1.5, 6, 72);
  const scanMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const scanRing = new THREE.Mesh(scanGeo, scanMat);
  scanRing.rotation.x = Math.PI / 2;
  state.brainScene.add(scanRing);
  let scanY = -200, scanDir = 1;
  (function scanTick() {
    if (!state.brainMode) return setTimeout(scanTick, 500);
    scanY += 0.055 * scanDir;
    if (scanY > 185) { scanDir = -1; scanMat.opacity = 0; } else if (scanY < -200) { scanDir = 1; scanMat.opacity = 0; }
    scanRing.position.y = scanY;
    if (scanMat.opacity < 0.42) scanMat.opacity = Math.min(0.42, scanMat.opacity + 0.003);
    requestAnimationFrame(scanTick);
  })();
  new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    state.brainRenderer?.setSize(w, h);
    if (state.brainCamera) { state.brainCamera.aspect = w / h; state.brainCamera.updateProjectionMatrix(); }
  }).observe(container);
  setTimeout(runBrainAmbientNoise, 2500);
}

export function brainLoop(ts = 0) {
  if (!state.brainMode) return;
  state.brainRafId = requestAnimationFrame(brainLoop);
  const dt = Math.min((ts - state.brainLastFrame) / 1000, 0.05); state.brainLastFrame = ts;
  if (!state.brainOrbit.isDragging) {
    state.brainOrbit.autoY += 0.0006;
    state.brainOrbit.rotY = state.brainOrbit.autoY;
    updateBrainCamera();
  }
  animateBrainPulses();
  animateBrainBursts(dt);
  if (state.brainRenderMode !== 'all') updateBrainBundleVisibility();
  state.brainRenderer.render(state.brainScene, state.brainCamera);
}
