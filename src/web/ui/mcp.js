// ui/mcp.js — mcp() fetch, runExplore, runContext, runImpact, loadClusters, activity stream
import { state } from '../state.js';
import { activateByName, activateByFile, systemWave, hubBurst } from './activity.js';
import { addFeedItem, loadAgents } from './panel.js';
import { switchLeftTab } from './panel.js';

let reqId = 1;

export async function mcp(tool, args) {
  const res = await fetch('/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: reqId++, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return JSON.parse(data.result.content[0].text);
}

export function runExplore() {
  // Triggered by button and Enter key — bound in main.js
}

export async function doRunExplore(showNodeDetail) {
  const q = document.getElementById('explore-input').value.trim();
  if (!q) return;
  const el = document.getElementById('explore-results');
  el.innerHTML = '<div class="loading">Searching…</div>';
  try {
    const data = await mcp('theronexus_query', { query: q });
    const flows = data.processes ?? [], defs = data.definitions ?? [];
    if (!flows.length && !defs.length) { el.innerHTML = '<div class="empty">No results found</div>'; return; }
    el.innerHTML = '';
    if (flows.length) {
      const hdr = document.createElement('div'); hdr.className = 'col-header'; hdr.textContent = `Execution Flows (${flows.length})`; el.appendChild(hdr);
      flows.forEach(f => {
        const c = document.createElement('div'); c.className = 'flow-card';
        c.innerHTML = `<div class="flow-title">${f.summary}</div><div class="flow-meta"><span class="badge">${f.process_type}</span><span>${f.step_count} steps</span><span>${f.symbol_count} symbols</span><span>priority ${(f.priority * 100).toFixed(0)}%</span></div>`;
        el.appendChild(c);
      });
    }
    if (defs.length) {
      const hdr = document.createElement('div'); hdr.className = 'col-header'; hdr.style.marginTop = '8px'; hdr.textContent = `Definitions (${defs.length})`; el.appendChild(hdr);
      defs.slice(0, 10).forEach(d => {
        const c = document.createElement('div'); c.className = 'caller-item'; c.style.marginBottom = '2px';
        c.innerHTML = `<span class="caller-name">${d.name}</span><span class="caller-path">${d.filePath}</span>`;
        c.addEventListener('click', () => showNodeDetail({ name: d.name })); el.appendChild(c);
      });
    }
  } catch (e) { el.innerHTML = `<div class="error-msg">${e.message}</div>`; }
}

export async function runContextForName(name, switchLeftTabFn, runImpactFn) {
  document.getElementById('context-input').value = name;
  const el = document.getElementById('context-results');
  el.innerHTML = '<div class="loading">Searching…</div>';
  try {
    const data = await mcp('theronexus_context', { name });
    if (data.status !== 'found') { el.innerHTML = `<div class="empty">Symbol "${name}" not found</div>`; return; }
    const s = data.symbol, incoming = data.incoming?.calls ?? [], outgoing = data.outgoing?.calls ?? [];
    el.innerHTML = '';
    const header = document.createElement('div'); header.className = 'symbol-card';
    header.innerHTML = `<div class="symbol-name">${s.name}</div><div class="symbol-path">${s.filePath}:${s.startLine}–${s.endLine}</div>`;
    el.appendChild(header);
    const cols = document.createElement('div'); cols.className = 'two-col';
    const makeCol = (title, items) => {
      const col = document.createElement('div'); col.className = 'col';
      col.innerHTML = `<div class="col-header">${title} (${items.length})</div>`;
      if (!items.length) { col.innerHTML += `<div style="color:var(--muted);font-size:11px;padding:4px 0">none</div>`; return col; }
      items.forEach(c => {
        const row = document.createElement('div'); row.className = 'caller-item';
        row.innerHTML = `<span class="caller-name">${c.name}</span><span class="caller-path">${c.filePath ?? ''}</span>`;
        row.addEventListener('click', () => runContextForName(c.name, switchLeftTabFn, runImpactFn)); col.appendChild(row);
      }); return col;
    };
    cols.appendChild(makeCol('Callers', incoming)); cols.appendChild(makeCol('Callees', outgoing)); el.appendChild(cols);
    const btn = document.createElement('button'); btn.className = 'secondary'; btn.style.alignSelf = 'flex-start'; btn.style.marginTop = '4px'; btn.textContent = 'Run Impact Analysis →';
    btn.addEventListener('click', () => { document.getElementById('impact-input').value = s.name; switchLeftTabFn('impact'); runImpactFn(); }); el.appendChild(btn);
  } catch (e) { el.innerHTML = `<div class="error-msg">${e.message}</div>`; }
}

export async function doRunImpact() {
  const target = document.getElementById('impact-input').value.trim();
  const direction = document.getElementById('impact-dir').value;
  if (!target) return;
  const el = document.getElementById('impact-results');
  el.innerHTML = '<div class="loading">Searching…</div>';
  try {
    const data = await mcp('theronexus_impact', { target, direction });
    el.innerHTML = '';
    const risk = data.risk ?? 'LOW';
    const header = document.createElement('div'); header.className = 'symbol-card';
    header.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><div class="symbol-name">${data.target?.name ?? target}</div><div class="risk-badge risk-${risk}">${risk}</div></div><div class="symbol-path">${data.target?.filePath ?? ''}</div><div class="impact-summary"><div class="impact-stat"><div class="impact-stat-val">${data.summary?.direct ?? 0}</div><div class="impact-stat-label">Direct</div></div><div class="impact-stat"><div class="impact-stat-val">${data.summary?.processes_affected ?? 0}</div><div class="impact-stat-label">Processes</div></div><div class="impact-stat"><div class="impact-stat-val">${data.summary?.modules_affected ?? 0}</div><div class="impact-stat-label">Modules</div></div></div>`;
    el.appendChild(header);
    (data.affected_modules ?? []).forEach((m, i) => {
      if (i === 0) { const h = document.createElement('div'); h.className = 'col-header'; h.textContent = 'Affected Modules'; el.appendChild(h); }
      const row = document.createElement('div'); row.className = 'caller-item';
      row.innerHTML = `<span class="caller-name">${m.name}</span><span class="badge">${m.impact}</span><span class="caller-path">${m.hits} hit${m.hits !== 1 ? 's' : ''}</span>`; el.appendChild(row);
    });
    (data.affected_processes ?? []).forEach((p, i) => {
      if (i === 0) { const h = document.createElement('div'); h.className = 'col-header'; h.style.marginTop = '10px'; h.textContent = 'Affected Flows'; el.appendChild(h); }
      const row = document.createElement('div'); row.className = 'flow-card';
      row.innerHTML = `<div class="flow-title">${p.summary ?? p.id}</div>`; el.appendChild(row);
    });
  } catch (e) { el.innerHTML = `<div class="error-msg">${e.message}</div>`; }
}

export function handleActivityEvent(evt) {
  const tool = evt.tool_name;
  let input = {};
  try { input = JSON.parse(evt.tool_input_preview ?? '{}'); } catch {}
  const sig = Math.max(0.3, Math.min(1.0, evt.significance_score ?? 0.5));

  if      (tool === 'theronexus_context')       activateByName(input.name ?? '', sig);
  else if (tool === 'theronexus_impact')         activateByName(input.target ?? '', sig);
  else if (tool === 'theronexus_detect_changes') state.allNodes.slice(0, 20).forEach(n => { const { triggerActivation: ta } = window.__activityMod; ta(n.id, sig * 0.3); });
  else if (tool === 'theronexus_query') {
    (input.query ?? '').split(/\s+/).filter(w => w.length > 4).forEach(w => activateByName(w, sig * 0.45));
  }
  else if (tool === 'Read')         activateByFile(input.file_path ?? '', sig * 0.4);
  else if (tool === 'Edit' || tool === 'Write') activateByFile(input.file_path ?? '', sig * 0.9);
  else if (tool === 'Grep') {
    if (input.path) activateByFile(input.path, sig * 0.25);
    const p = input.pattern ?? '';
    if (p.length > 3 && p.length < 30) activateByName(p.replace(/[\\^$.*+?()[\]{}|]/g, ''), sig * 0.3);
  }

  const dot = document.getElementById('activity-dot');
  dot.classList.add('alive');
  clearTimeout(dot._timer);
  dot._timer = setTimeout(() => dot.classList.remove('alive'), 1200);
}

export function handleSystemEvent(evt) {
  const dot = document.getElementById('activity-dot');
  dot.classList.add('alive');
  clearTimeout(dot._timer);
  dot._timer = setTimeout(() => dot.classList.remove('alive'), 1200);

  const evtType = evt.event_type ?? evt.type;
  if (evtType === 'tier_change') {
    const up = ['ACTIVE', 'MILD'].includes(evt.to ?? '');
    const color = up ? '#00e5ff' : '#1c5468';
    const msg = `Concept <b>${(evt.surface_form ?? 'unknown').replace(/`/g, '')}</b> tier: ${evt.from} → ${evt.to}`;
    if (up) { hubBurst(color, 0.5); addFeedItem('tier-up', msg, evt.timestamp); }
    else { systemWave(color, 0.12, 8); addFeedItem('tier-down', msg, evt.timestamp); }
  }
  else if (evtType === 'agent_health_change') {
    const toHealthy = evt.to === 'healthy';
    const color = toHealthy ? '#39ff14' : '#ff2d78';
    const intensity = toHealthy ? 0.45 : 0.35;
    systemWave(color, intensity, toHealthy ? 30 : 15, toHealthy ? 20 : 50);
    const msg = `Agent <b>${evt.agent_id}</b>: ${evt.from} → <b>${evt.to}</b>`;
    addFeedItem(toHealthy ? 'health-up' : 'health-down', msg, evt.timestamp);
    loadAgents();
  }
  else if (evtType === 'outcome_record') {
    const ok = evt.success !== false;
    const color = ok ? '#39ff14' : '#ff0040';
    if (ok) { hubBurst(color, 0.7); }
    else { systemWave(color, 0.3, 10); }
    const src = evt.source ?? 'unknown';
    const msg = ok ? `Outcome <b>${src}</b> ✓ success` : `Outcome <b>${src}</b> ✗ failed`;
    addFeedItem(ok ? 'outcome-ok' : 'outcome-fail', msg, evt.timestamp);
  }
}

export function connectActivityStream() {
  const es = new EventSource('/api/events');
  es.onmessage = e => {
    try {
      const evt = JSON.parse(e.data);
      if (evt.type === 'tool') handleActivityEvent(evt);
      else if (evt.type === 'system_event') handleSystemEvent(evt);
    } catch {}
  };
  es.onerror = () => { es.close(); setTimeout(connectActivityStream, 3000); };
}

// NOTE: makeCodeTexture is defined in graph.js to avoid circular imports.
// graph.js imports connectActivityStream from here; mcp.js does NOT import from graph.js.
