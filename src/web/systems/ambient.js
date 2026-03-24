// systems/ambient.js — ambient animation helpers
import { state } from '../state.js';
import { moduleColor } from '../utils.js';
import { spawnPulse } from './pulses.js';

export function runAmbientNoise() {
  const THREE = window.THREE;
  if (!state.graph3d || state.allNodes.length === 0) return setTimeout(runAmbientNoise, 1500);
  const links = state.graph3d.graphData().links;
  if (!links.length) return setTimeout(runAmbientNoise, 2000);
  const count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const link = links[Math.floor(Math.random() * links.length)];
    const sId = typeof link.source === 'object' ? link.source.id : link.source;
    const tId = typeof link.target === 'object' ? link.target.id : link.target;
    const s = state.nodeById.get(sId), t = state.nodeById.get(tId);
    if (s && t && state.activityPulses.length < 60) spawnPulse(s, t, moduleColor(s.module), 0.10);
  }
  setTimeout(runAmbientNoise, 1800 + Math.random() * 2800);
}

export function runSpriteFlicker(makeCodeTexture) {
  if (state.spriteMats.size > 0) {
    const ids = [...state.spriteMats.keys()];
    const id = ids[Math.floor(Math.random() * ids.length)];
    const act = state.nodeActivity.get(id);
    if (!act || !act.level) {
      const entry = state.spriteMats.get(id);
      if (entry) {
        const newTex = makeCodeTexture(entry.col, entry.name);
        entry.mat.map = newTex;
        entry.mat.needsUpdate = true;
      }
    }
  }
  setTimeout(() => runSpriteFlicker(makeCodeTexture), 800 + Math.random() * 1500);
}
