// utils.js — pure utility functions (no side effects, no state)

const MODULE_COLORS = [
  '#4da6ff','#ff4dd2','#9d6bff','#ffc94d','#00ff88','#ff6600',
  '#00ddff','#ff3366','#00ffcc','#cc00ff','#ffaa00','#ff2d78',
  '#00ff55','#7700ff','#ff9900',
];
const moduleColorMap = {};
let colorIdx = 0;

export function moduleColor(mod) {
  if (!moduleColorMap[mod]) moduleColorMap[mod] = MODULE_COLORS[colorIdx++ % MODULE_COLORS.length];
  return moduleColorMap[mod];
}

export function nodeSize(node) {
  const base = node.type === 'Class' ? 8.8 : node.type === 'Method' ? 5.5 : 3.3;
  const degScale = 1 + Math.sqrt(node.__degree || 0) * 0.42;
  return base * Math.min(degScale, 5.0);
}

export function tensionColor(t) {
  return t < 0.30 ? '#4fd1c5' : t < 0.55 ? '#fbbf24' : t < 0.75 ? '#f97316' : '#ef4444';
}

export function lerpHex(h1, h2, t) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = p(h1), [r2, g2, b2] = p(h2);
  return '#' + [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]
    .map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function getBaseColor(node, state) {
  let col = moduleColor(node.module);
  if (state.heatMode && state.heatData.nodes[node.id]) {
    const ns = state.heatData.nodes[node.id];
    col = lerpHex(col, tensionColor(ns.tension ?? 0), Math.min(1, (ns.tension ?? 0) * 1.5));
  }
  return col;
}
