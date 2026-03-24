// ui/graph.js — 3d-force-graph wiring, applyHighlight, HUD
import { state } from '../state.js';
import { moduleColor, nodeSize, getBaseColor } from '../utils.js';
import { triggerActivation } from './activity.js';
import { addStarField, addNebulaVolumes } from '../systems/starfield.js';
import { addScannerPlane } from '../systems/scanner.js';
import { setupBloom } from '../systems/bloom.js';
import { animatePulses } from '../systems/pulses.js';
import { runAmbientNoise, runSpriteFlicker } from '../systems/ambient.js';
import { connectActivityStream } from './mcp.js';
import { loadAgents } from './panel.js';

export function isNodeHighlighted(n) {
  if (state.pathHighlightNodes.size && !state.pathHighlightNodes.has(n.id)) return false;
  if (state.clusterHighlightLabel && n.module !== state.clusterHighlightLabel) return false;
  if (state.graphSearchTerm && !n.name.toLowerCase().includes(state.graphSearchTerm)) return false;
  return true;
}

export function applyHighlight() {
  const has = state.clusterHighlightLabel || state.graphSearchTerm;
  state.allNodes.forEach(node => {
    const core = state.coreMats.get(node.id), glow = state.glowMats.get(node.id);
    if (!core) return;
    const col = (!has || isNodeHighlighted(node)) && node.__pinned ? '#39ff14' : getBaseColor(node, state);
    const dimmed = has && !isNodeHighlighted(node);
    const actLevel = state.nodeActivity.get(node.id)?.level ?? 0;
    core.color.set(col); core.emissive.set(col);
    core.opacity = dimmed ? 0.06 : 1.0;
    if (node.__pinned && !dimmed) { core.color.set('#39ff14'); core.emissive.set('#39ff14'); }
    core.emissiveIntensity = dimmed ? 0.0 : (node.__pinned ? 1.8 : 0.75 + actLevel);
    if (glow) glow.opacity = dimmed ? 0.004 : 0.18 + actLevel * 0.15;
  });
}

export async function loadHeatmap() {
  try {
    state.heatData = await fetch('/api/heatmap').then(r => r.json());
    if (state.graph3d) applyHighlight();
  } catch {}
}

export function setupHUD(container) {
  const THREE = window.THREE;
  state.hudEl = document.createElement('div');
  state.hudEl.style.cssText = 'position:absolute;pointer-events:none;z-index:20;background:rgba(0,8,20,0.96);border:1px solid rgba(0,229,255,0.55);border-radius:2px;padding:12px 16px;font-family:"SF Mono","Fira Code",monospace;font-size:11px;color:#8ffcff;backdrop-filter:blur(8px);display:none;box-shadow:0 0 30px rgba(0,229,255,0.2),inset 0 0 20px rgba(0,229,255,0.04),0 0 0 1px rgba(0,229,255,0.1);max-width:240px;';
  container.appendChild(state.hudEl);
  (function track() {
    if (state.hudNode && state.graph3d) {
      const v = new THREE.Vector3(state.hudNode.x || 0, state.hudNode.y || 0, state.hudNode.z || 0).project(state.graph3d.camera());
      const cv = state.graph3d.renderer().domElement;
      const x = (v.x * 0.5 + 0.5) * cv.clientWidth, y = (-v.y * 0.5 + 0.5) * cv.clientHeight;
      state.hudEl.style.left = Math.min(cv.clientWidth - 260, x + 20) + 'px';
      state.hudEl.style.top  = Math.max(10, y - 50) + 'px';
    }
    requestAnimationFrame(track);
  })();
}

export function showHUD(node) {
  state.hudNode = node;
  const actLevel = state.nodeActivity.get(node.id)?.level ?? 0;
  const actBar = actLevel > 0 ? `<div style="margin-top:8px;height:2px;background:rgba(0,229,255,0.08)"><div style="height:2px;width:${Math.min(100, actLevel * 40)}%;background:linear-gradient(90deg,#00e5ff,#ff2d78);box-shadow:0 0 6px rgba(0,229,255,0.6);transition:width 0.3s"></div></div>` : '';
  state.hudEl.innerHTML = `
    <div style="color:#00e5ff;font-weight:700;font-size:13px;margin-bottom:6px;letter-spacing:1px;text-shadow:0 0 10px rgba(0,229,255,0.6)">${node.name}</div>
    <div style="color:#1c5468;margin-bottom:4px;word-break:break-all;line-height:1.5;font-size:10px">${node.filePath || ''}</div>
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
      <span style="background:rgba(0,229,255,0.1);color:#00e5ff;padding:2px 7px;border:1px solid rgba(0,229,255,0.3);font-size:10px;letter-spacing:1px">${node.type}</span>
      <span style="background:rgba(255,45,120,0.1);color:#ff2d78;padding:2px 7px;border:1px solid rgba(255,45,120,0.3);font-size:10px;letter-spacing:1px">${node.module}</span>
      ${node.__pinned ? '<span style="background:rgba(57,255,20,0.1);color:#39ff14;padding:2px 7px;border:1px solid rgba(57,255,20,0.3);font-size:10px;letter-spacing:1px;text-shadow:0 0 6px rgba(57,255,20,0.5)">LOCKED</span>' : ''}
    </div>
    ${actBar}
    <div style="color:#0a2030;font-size:10px;margin-top:10px;border-top:1px solid rgba(0,229,255,0.1);padding-top:6px;letter-spacing:0.5px">drag→flick/pin · dbl-click to${node.__pinned ? ' unpin' : ' warp'} · [F] path · [E] explode</div>`;
  state.hudEl.style.display = 'block';
}

export function hideHUD() { state.hudNode = null; state.hudEl.style.display = 'none'; }

export function makeCodeTextureGlobal(hexCol, name) {
  const THREE = window.THREE;
  const res = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, res, res);
  const r = parseInt(hexCol.slice(1, 3), 16);
  const g = parseInt(hexCol.slice(3, 5), 16);
  const b = parseInt(hexCol.slice(5, 7), 16);
  ctx.font = '7px "SF Mono","Fira Code",monospace';
  const glyphPool = '01010110010100110011' + (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let row = 0; row < 18; row++) {
    for (let col = 0; col < 18; col++) {
      const x = col * 7 + 1, y = row * 7 + 8;
      const dx = x + 3 - res / 2, dy = y - 3 - res / 2;
      const dist = Math.sqrt(dx * dx + dy * dy) / (res / 2 - 2);
      if (dist > 1) continue;
      const alpha = (1 - dist * dist) * (0.25 + Math.random() * 0.65);
      const ch = glyphPool[Math.floor(Math.random() * glyphPool.length)] || '0';
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      ctx.fillText(ch, x, y);
    }
  }
  const grad = ctx.createRadialGradient(res / 2, res / 2, 0, res / 2, res / 2, res / 2);
  grad.addColorStop(0,    `rgba(${r},${g},${b},0.35)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.10)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0.00)`);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(res / 2, res / 2, res / 2, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

export async function loadGraph(showNodeDetail) {
  const THREE = window.THREE;
  const ForceGraph3D = window.ForceGraph3D;
  const container = document.getElementById('galaxy-view');
  const data = await fetch('/api/graph').then(r => r.json());
  if (data.error) { container.innerHTML = `<div style="color:#f97316;padding:20px;font-family:monospace">${data.error}</div>`; return; }

  state.allNodes = data.nodes;
  state.nodeById = new Map(state.allNodes.map(n => [n.id, n]));
  state.brainEdgesData = data.edges;
  const links = data.edges.map(e => ({ source: e.source, target: e.target }));

  const degree = new Map(state.allNodes.map(n => [n.id, 0]));
  data.edges.forEach(e => { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); });
  const maxDeg = Math.max(...degree.values(), 1);
  state.allNodes.forEach(n => {
    n.__degree = degree.get(n.id) || 0;
    n.__centrality = n.__degree / maxDeg;
    n.__isolated = n.__degree === 0;
  });
  const sorted = [...state.allNodes].sort((a, b) => b.__degree - a.__degree);
  sorted.slice(0, 3).forEach((n, i) => { n.__isNucleus = true; n.__nucleusRank = i; });

  let lastClickTime = 0, lastClickNode = null;

  state.graph3d = ForceGraph3D({ antialias: true, alpha: false })(container)
    .width(container.clientWidth).height(container.clientHeight)
    .backgroundColor('#000510')
    .nodeLabel(n =>
      `<div style="font-family:'SF Mono',monospace;font-size:12px;background:#12121a;border:1px solid #1e1e2e;border-radius:6px;padding:8px 12px;pointer-events:none">` +
      `<b style="color:#a78bfa">${n.name}</b><br><span style="color:#6b6a80;font-size:10px">${n.filePath ?? ''}</span></div>`)
    .nodeThreeObject(node => {
      if (state.nexusMode) {
        const { makeNexusNodeObject } = window.__nexusMod;
        return makeNexusNodeObject(node);
      }
      const col = getBaseColor(node, state), size = nodeSize(node);
      const group = new THREE.Group();
      const cMat = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.75, transparent: true, opacity: 1.0 });
      state.coreMats.set(node.id, cMat);
      group.add(new THREE.Mesh(new THREE.SphereGeometry(size, 14, 14), cMat));
      const gMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
      state.glowMats.set(node.id, gMat);
      group.add(new THREE.Mesh(new THREE.SphereGeometry(size * 2.8, 8, 8), gMat));
      const codeTex = makeCodeTextureGlobal(col, node.name);
      const sMat = new THREE.SpriteMaterial({ map: codeTex, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false });
      state.spriteMats.set(node.id, { mat: sMat, col, name: node.name });
      const sprite = new THREE.Sprite(sMat);
      const ss = size * 3.0;
      sprite.scale.set(ss, ss, 1);
      group.add(sprite);
      if (node.type === 'Class') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 1.8, 0.35, 6, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
        ring.rotation.x = Math.PI / 3; ring.rotation.z = Math.PI / 6; group.add(ring);
      }
      return group;
    })
    .nodeThreeObjectExtend(false)
    .nodeVal(n => nodeSize(n) ** 2)
    .linkColor(link => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const tId = typeof link.target === 'object' ? link.target.id : link.target;
      if (state.pathHighlightNodes.size) {
        if (state.pathHighlightNodes.has(sId) && state.pathHighlightNodes.has(tId)) return 'rgba(0,229,255,0.90)';
        return 'rgba(0,229,255,0.015)';
      }
      const isSpectral = !state.liveActivityNodes.has(sId) && !state.liveActivityNodes.has(tId);
      if (isSpectral) return 'rgba(80,80,140,0.10)';
      const s = state.nodeById.get(sId);
      const col = s ? moduleColor(s.module) : '#00e5ff';
      const rv = parseInt(col.slice(1, 3), 16), gv = parseInt(col.slice(3, 5), 16), bv = parseInt(col.slice(5, 7), 16);
      const eKey = [sId, tId].sort().join('|');
      const fires = state.edgeFireCount.get(eKey) ?? 0;
      const alpha = Math.min(0.75, 0.22 + fires * 0.04);
      return `rgba(${rv},${gv},${bv},${alpha.toFixed(2)})`;
    })
    .linkWidth(link => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const tId = typeof link.target === 'object' ? link.target.id : link.target;
      if (state.pathHighlightNodes.size) {
        if (state.pathHighlightNodes.has(sId) && state.pathHighlightNodes.has(tId)) return 2.0;
        return 0.2;
      }
      if (!state.liveActivityNodes.has(sId) && !state.liveActivityNodes.has(tId)) return 0.2;
      const eKey = [sId, tId].sort().join('|');
      const fires = state.edgeFireCount.get(eKey) ?? 0;
      return Math.min(2.2, 0.7 + fires * 0.15);
    })
    .linkDirectionalParticles(2)
    .linkDirectionalParticleWidth(link => {
      if (state.pathHighlightNodes.size) {
        const s = typeof link.source === 'object' ? link.source.id : link.source;
        const t = typeof link.target === 'object' ? link.target.id : link.target;
        if (state.pathHighlightNodes.has(s) && state.pathHighlightNodes.has(t)) return 3.5;
        return 0;
      }
      return 1.8;
    })
    .linkDirectionalParticleSpeed(0.008)
    .linkDirectionalParticleColor(link => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const s = state.nodeById.get(sId);
      return s ? moduleColor(s.module) : '#a78bfa';
    })
    .onNodeHover(node => { if (node) showHUD(node); else hideHUD(); })
    .onNodeClick(node => {
      const now = Date.now(), isDouble = now - lastClickTime < 300 && lastClickNode === node;
      lastClickTime = now; lastClickNode = node;
      state.pathSelectedNode = node;
      if (isDouble) {
        if (node.__pinned) { node.fx = node.fy = node.fz = undefined; node.__pinned = false; const c = state.coreMats.get(node.id); if (c) c.emissiveIntensity = 0.5; }
        else { const m = Math.hypot(node.x || 1, node.y || 1, node.z || 1), r = 1 + 70 / m; state.graph3d.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, 700); }
      } else {
        showNodeDetail(node);
        const m = Math.hypot(node.x || 1, node.y || 1, node.z || 1), r = 1 + 180 / m;
        state.graph3d.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, 500);
      }
      showHUD(node);
    })
    .onNodeDrag(node => {
      const now = Date.now();
      const hist = state.dragHistory.get(node.id) ?? [];
      hist.push({ x: node.x || 0, y: node.y || 0, z: node.z || 0, t: now });
      if (hist.length > 5) hist.shift();
      state.dragHistory.set(node.id, hist);
      if (state.nexusMode) state.draggedNodes.set(node.id, { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 });
    })
    .onNodeDragEnd(node => {
      if (state.nexusMode) state.draggedNodes.delete(node.id);
      const hist = state.dragHistory.get(node.id) ?? [];
      state.dragHistory.delete(node.id);
      clearTimeout(state.dragPinTimers.get(node.id));
      state.dragPinTimers.delete(node.id);
      if (hist.length >= 2) {
        const last = hist[hist.length - 1], prev = hist[hist.length - 2];
        const dt = last.t - prev.t;
        if (dt > 0 && dt < 150) {
          const scale = Math.min(25, 60 / Math.max(dt, 16));
          const vx = (last.x - prev.x) / dt * scale;
          const vy = (last.y - prev.y) / dt * scale;
          const vz = (last.z - prev.z) / dt * scale;
          const speed = Math.hypot(vx, vy, vz);
          if (speed > 1.5) {
            node.vx = vx; node.vy = vy; node.vz = vz;
            const timer = setTimeout(() => {
              node.fx = node.x; node.fy = node.y; node.fz = node.z; node.__pinned = true;
              const c = state.coreMats.get(node.id); if (c) c.emissiveIntensity = 1.2;
              showHUD(node); state.dragPinTimers.delete(node.id);
            }, 850);
            state.dragPinTimers.set(node.id, timer);
            return;
          }
        }
      }
      node.fx = node.x; node.fy = node.y; node.fz = node.z; node.__pinned = true;
      const c = state.coreMats.get(node.id); if (c) c.emissiveIntensity = 1.2;
      showHUD(node);
    })
    .onBackgroundClick(() => {
      state.clusterHighlightLabel = null; state.graphSearchTerm = '';
      state.pathHighlightNodes = new Set(); state.pathSelectedNode = null; state.pathDepth = 0;
      const s = document.getElementById('graph-search'); if (s) s.value = '';
      document.querySelectorAll('.cluster-card.active').forEach(el => el.classList.remove('active'));
      const pb = document.getElementById('path-btn'); if (pb) { pb.textContent = 'PATH'; pb.style.opacity = '0.7'; pb.style.color = ''; }
      applyHighlight(); hideHUD();
    })
    .graphData({ nodes: state.allNodes, links });

  state.graph3d.d3Force('charge').strength(-200);
  state.graph3d.d3Force('link').distance(90);
  state.graph3d.d3VelocityDecay(0.45);

  const scene = state.graph3d.scene();
  scene.fog = new THREE.FogExp2(0x000510, 0.0009);
  scene.add(new THREE.AmbientLight(0x001633, 10));
  const key = new THREE.DirectionalLight(0x00e5ff, 2.5); key.position.set(1, 1, 0.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xff2d78, 1.2); fill.position.set(-1, -0.5, 1); scene.add(fill);
  window._sceneKeyLight = key;
  window._sceneFillLight = fill;
  addStarField(scene);
  addNebulaVolumes(scene);
  addScannerPlane(scene);

  const controls = state.graph3d.controls();
  controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  let autoRotateTimer;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(autoRotateTimer); });
  controls.addEventListener('end',   () => { autoRotateTimer = setTimeout(() => controls.autoRotate = true, 3000); });

  setupBloom(container);
  setupHUD(container);

  document.getElementById('graph-stats').textContent = `${state.allNodes.length} nodes · ${links.length} edges`;

  new ResizeObserver(() => { if (state.graph3d) state.graph3d.width(container.clientWidth).height(container.clientHeight); }).observe(container);

  document.getElementById('heat-toggle').addEventListener('click', () => {
    state.heatMode = !state.heatMode;
    const btn = document.getElementById('heat-toggle');
    btn.textContent = state.heatMode ? 'HEAT ON' : 'HEAT OFF';
    btn.style.opacity = state.heatMode ? '1' : '0.7';
    btn.style.color = state.heatMode ? 'var(--risk-high)' : '';
    applyHighlight();
  });
  document.getElementById('churn-btn').addEventListener('click', async () => {
    const btn = document.getElementById('churn-btn'); btn.textContent = 'SCANNING…';
    await fetch('/api/churn-refresh', { method: 'POST' });
    setTimeout(async () => { await loadHeatmap(); btn.textContent = 'REFRESH'; }, 8000);
  });
  document.getElementById('graph-search').addEventListener('input', e => {
    state.graphSearchTerm = e.target.value.trim().toLowerCase();
    if (state.graphSearchTerm) { state.clusterHighlightLabel = null; document.querySelectorAll('.cluster-card.active').forEach(el => el.classList.remove('active')); }
    applyHighlight();
  });

  animatePulses();
  setTimeout(runAmbientNoise, 2000);
  setTimeout(() => runSpriteFlicker(makeCodeTextureGlobal), 3000);
  connectActivityStream();
  loadAgents();
  setInterval(loadAgents, 15000);
}
