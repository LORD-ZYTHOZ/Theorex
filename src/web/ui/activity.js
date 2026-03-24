// ui/activity.js — triggerActivation, decayNode, nodeActivity logic
import { state } from '../state.js';
import { moduleColor, getBaseColor } from '../utils.js';
import { spawnPulse } from '../systems/pulses.js';
import { brainTriggerActivation } from '../mode/brain.js';

export function triggerActivation(nodeId, intensity) {
  if (state.brainMode) { brainTriggerActivation(nodeId, intensity); return; }
  const core = state.coreMats.get(nodeId), glow = state.glowMats.get(nodeId);
  if (!core) return;
  const cur = state.nodeActivity.get(nodeId) ?? { level: 0 };
  clearTimeout(cur.timer);
  const newLevel = Math.min(2.5, cur.level + intensity);
  const timer = setTimeout(() => decayNode(nodeId), 1500 + intensity * 2000);
  state.nodeActivity.set(nodeId, { level: newLevel, timer });
  state.liveActivityNodes.add(nodeId);
  if (!core.opacity || core.opacity > 0.5) {
    core.emissiveIntensity = 0.5 + newLevel;
    if (glow) glow.opacity = Math.min(0.4, 0.10 + newLevel * 0.12);
  }
  // Spawn activity pulses along connected edges
  if (state.graph3d && state.activityPulses.length < 80) {
    const links = state.graph3d.graphData().links;
    const connected = links.filter(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return s === nodeId || t === nodeId;
    }).slice(0, Math.ceil(intensity * 6));
    const srcNode = state.nodeById.get(nodeId);
    connected.forEach((link, i) => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const tId = typeof link.target === 'object' ? link.target.id : link.target;
      const s = state.nodeById.get(sId), t = state.nodeById.get(tId);
      if (s && t) {
        const eKey = [sId, tId].sort().join('|');
        state.edgeFireCount.set(eKey, (state.edgeFireCount.get(eKey) ?? 0) + 1);
        setTimeout(() => spawnPulse(s, t, moduleColor(srcNode?.module ?? s.module), intensity), i * 120);
      }
    });
  }
}

export function decayNode(nodeId) {
  const act = state.nodeActivity.get(nodeId); if (!act) return;
  const newLevel = act.level * 0.35;
  if (newLevel < 0.05) {
    state.nodeActivity.delete(nodeId);
    const core = state.coreMats.get(nodeId), glow = state.glowMats.get(nodeId);
    const n = state.nodeById.get(nodeId);
    if (core) {
      if (n?.__pinned) { core.color.set('#39ff14'); core.emissive.set('#39ff14'); core.emissiveIntensity = 1.8; }
      else { const c = getBaseColor(n ?? {}, state); core.color.set(c); core.emissive.set(c); core.emissiveIntensity = 0.75; }
    }
    if (glow) glow.opacity = 0.18;
  } else {
    const timer = setTimeout(() => decayNode(nodeId), 700);
    state.nodeActivity.set(nodeId, { level: newLevel, timer });
    const core = state.coreMats.get(nodeId), glow = state.glowMats.get(nodeId);
    if (core) core.emissiveIntensity = 0.5 + newLevel;
    if (glow) glow.opacity = Math.min(0.4, 0.10 + newLevel * 0.12);
  }
}

export function activateByName(name, intensity) {
  const q = name.toLowerCase();
  state.allNodes.forEach(n => { if (n.name.toLowerCase().includes(q)) triggerActivation(n.id, intensity); });
}

export function activateByFile(filePath, intensity) {
  const file = filePath.split('/').pop() ?? '';
  if (!file) return;
  state.allNodes.forEach(n => { if (n.filePath && n.filePath.includes(file)) triggerActivation(n.id, intensity); });
}

export function triggerActivationWithColor(nodeId, intensity, color) {
  triggerActivation(nodeId, intensity);
  const links = state.graph3d?.graphData().links ?? [];
  links.filter(l => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    return s === nodeId || t === nodeId;
  }).slice(0, 3).forEach((l, i) => {
    const s = typeof l.source === 'object' ? l.source : state.nodeById.get(l.source);
    const t = typeof l.target === 'object' ? l.target : state.nodeById.get(l.target);
    if (s && t) setTimeout(() => spawnPulse(s, t, color, intensity * 0.8), i * 80);
  });
}

export function systemWave(color, intensity, count = 15, staggerMs = 30) {
  if (!state.allNodes.length) return;
  const shuffled = [...state.allNodes].sort(() => Math.random() - 0.5).slice(0, count);
  shuffled.forEach((n, i) => setTimeout(() => triggerActivationWithColor(n.id, intensity, color), i * staggerMs));
}

export function hubBurst(color, intensity) {
  if (!state.allNodes.length) return;
  const hubs = [...state.allNodes].sort((a, b) => (b.__degree || 0) - (a.__degree || 0)).slice(0, 8);
  hubs.forEach((n, i) => setTimeout(() => triggerActivationWithColor(n.id, intensity, color), i * 60));
}
