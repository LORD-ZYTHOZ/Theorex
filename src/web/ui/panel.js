// ui/panel.js — left panel, tabs, stats, live feed, agents
import { state } from '../state.js';
import { applyHighlight } from './graph.js';

export function switchLeftTab(name) {
  document.querySelectorAll('.left-tab').forEach(t => t.classList.toggle('active', t.dataset.ltab === name));
  document.querySelectorAll('.left-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'ltab-' + name));
  if (name === 'clusters') loadClusters();
  if (name === 'live') loadAgents();
}

export async function loadStats() {
  try {
    const r = await fetch('/api/stats').then(r => r.json());
    document.getElementById('stat-symbols').textContent = r.symbols?.toLocaleString() ?? '956';
    document.getElementById('stat-clusters').textContent = r.clusters ?? '180';
    document.getElementById('stat-flows').textContent = r.processes ?? '69';
  } catch {}
}

export function renderLoading(el) { el.innerHTML = '<div class="loading">Searching…</div>'; }
export function renderError(el, msg) { el.innerHTML = `<div class="error-msg">${msg}</div>`; }

export async function loadClusters() {
  if (state.clustersLoaded) return;
  const grid = document.getElementById('cluster-grid');
  try {
    const res = await fetch('/api/clusters').then(r => r.json());
    const clusters = res.clusters ?? [];
    if (!clusters.length) { grid.innerHTML = '<div class="empty">No clusters found</div>'; return; }
    const maxSym = Math.max(...clusters.map(c => c.symbolCount));
    grid.innerHTML = '';
    clusters.forEach(c => {
      const card = document.createElement('div'); card.className = 'cluster-card';
      const pct = Math.round((c.symbolCount / maxSym) * 100), coh = Math.round(c.cohesion * 100);
      card.innerHTML = `<div class="cluster-name">${c.label}</div><div class="cluster-bar-bg"><div class="cluster-bar" style="width:${pct}%"></div></div><div class="cluster-stats"><span>${c.symbolCount} sym</span><span>${coh}% coh</span></div>`;
      card.addEventListener('click', () => {
        if (state.clusterHighlightLabel === c.label) { state.clusterHighlightLabel = null; card.classList.remove('active'); }
        else { document.querySelectorAll('.cluster-card.active').forEach(el => el.classList.remove('active')); state.clusterHighlightLabel = c.label; card.classList.add('active'); }
        applyHighlight();
      });
      grid.appendChild(card);
    });
    state.clustersLoaded = true;
  } catch (e) { grid.innerHTML = `<div class="error-msg">${e.message}</div>`; }
}

export async function loadAgents() {
  try {
    const data = await fetch('/api/agents').then(r => r.json());
    const agents = data.agents ?? [];
    const el = document.getElementById('agents-status');
    if (!el) return;
    el.innerHTML = '';
    agents.forEach(a => {
      const row = document.createElement('div');
      row.className = 'agent-row';
      const status = a.status === 'healthy' ? 'healthy' : a.status === 'unreachable' ? 'unhealthy' : 'unknown';
      const ping = a.ping_ms != null ? `${Math.round(a.ping_ms)}ms` : a.status;
      const sr = a.success_rate != null ? ` · ${(a.success_rate * 100).toFixed(0)}% ok` : '';
      row.innerHTML = `<div class="agent-dot ${status}"></div><span class="agent-name">${a.id}</span><span class="agent-ping">${ping}${sr}</span>`;
      el.appendChild(row);
    });
  } catch {}
}

export function addFeedItem(cls, msg, time) {
  const feed = document.getElementById('live-feed');
  if (!feed) return;
  const d = document.createElement('div');
  d.className = `feed-item ${cls}`;
  const t = time ? new Date(time).toLocaleTimeString('en-AU', { hour12: false }) : new Date().toLocaleTimeString('en-AU', { hour12: false });
  d.innerHTML = `<span class="feed-time">${t}</span><span class="feed-msg">${msg}</span>`;
  feed.insertBefore(d, feed.firstChild);
  while (feed.children.length > 50) feed.removeChild(feed.lastChild);
}
