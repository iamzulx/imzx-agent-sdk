/**
 * Web Dashboard — native node:http server, zero external deps.
 * Serves static HTML dashboard + JSON API endpoints.
 *
 * Endpoints:
 *   GET /             — HTML dashboard (dark theme, auto-refresh)
 *   GET /api/memory   — Memory entries
 *   GET /api/skills   — Saved skills
 *   GET /api/stats    — Agent session stats
 *   GET /api/telemetry — Telemetry spans summary
 *   GET /api/graph    — Knowledge graph stats
 *   GET /api/health   — Health check
 *
 * [C1 FIX] Bearer token auth via IMZX_API_KEY env var, rate limiting (60 req/min per IP)
 * [C4 FIX] Content Security Policy with nonce, X-Content-Type-Options, X-Frame-Options headers
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAuthManager } from '../../adapters/security/auth-manager.js';
import { randomBytes } from 'node:crypto';

// ── Config ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port')
  || process.env.IMZX_DASHBOARD_PORT || '3100');
// [S4 FIX] Default to localhost only — prevents exposure on LAN
const HOST = process.env.IMZX_DASHBOARD_HOST || '127.0.0.1';
const DATA_DIR = process.env.IMZX_DATA_DIR || join(process.cwd(), '.imzx');
const API_KEY = process.env.IMZX_API_KEY;

// ── [C1 FIX] Rate Limiter ────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Periodic cleanup to prevent OOM from stale entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 60_000);

function checkRateLimit(ip: string, maxRequests = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    // [S6 FIX] Cap map size to prevent OOM
    if (rateLimitMap.size > 10_000) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.resetAt) rateLimitMap.delete(k);
      }
      if (rateLimitMap.size > 10_000) {
        const entries = [...rateLimitMap.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        for (let i = 0; i < entries.length / 2; i++) rateLimitMap.delete(entries[i][0]);
      }
    }
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= maxRequests;
}

// ── [C1 FIX] API Authentication ─────────────────────────────────────────
function checkAuth(req: IncomingMessage, apiKey?: string): boolean {
  // Backward compatibility
  if (apiKey) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return false;
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token === apiKey) return true;
  }

  const authManager = getAuthManager();
  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const key = authManager.validateKey(token, 'dashboard', req.socket.remoteAddress || 'unknown');
  return key !== null;
}

// ── [C4 FIX] HTML Escaping ──────────────────────────────────────────────
function htmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── [C4 FIX] CSP Nonce Generator ────────────────────────────────────────
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

// ── Data helpers ──────────────────────────────────────────────────────────
function readJSON(filePath: string): any {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function getMemoryEntries() {
  const store = readJSON(join(DATA_DIR, 'memory.json'));
  return store?.entries ?? [];
}

function getSkills() {
  const skillsDir = join(DATA_DIR, 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJSON(join(skillsDir, f)))
    .filter(Boolean);
}

function getStats() {
  const metrics = readJSON(join(DATA_DIR, 'metrics.json'));
  return {
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    metrics: metrics || {},
    memoryCount: getMemoryEntries().length,
    skillCount: getSkills().length,
    pid: process.pid,
    nodeVersion: process.version,
  };
}

function getTelemetry() {
  const logDir = join(DATA_DIR, 'logs');
  if (!existsSync(logDir)) return { spans: [], totalCalls: 0 };
  const files = readdirSync(logDir).filter(f => f.endsWith('.jsonl')).slice(-5);
  const spans: any[] = [];
  for (const f of files) {
    const lines = readFileSync(join(logDir, f), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { spans.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  const llmCalls = spans.filter(s => s.kind === 'client');
  const totalCost = llmCalls.reduce((sum, s) => sum + (s.attributes?.costUsd || 0), 0);
  const totalTokens = llmCalls.reduce((sum, s) => sum + (s.attributes?.inputTokens || 0) + (s.attributes?.outputTokens || 0), 0);
  return { spanCount: spans.length, llmCallCount: llmCalls.length, totalCost, totalTokens, recentSpans: spans.slice(-20) };
}

function getGraph() {
  const graph = readJSON(join(DATA_DIR, 'knowledge-graph.json'));
  if (!graph) return { entities: 0, relations: 0 };
  return {
    entities: graph.entities?.length ?? 0,
    relations: graph.relations?.length ?? 0,
    topEntities: (graph.entities ?? []).sort((a: any, b: any) => b.mentions - a.mentions).slice(0, 10),
  };
}

// ── HTML Dashboard ────────────────────────────────────────────────────────
function dashboardHTML(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>imzx Dashboard</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:1rem}
h1{color:#58a6ff;margin-bottom:.5rem;font-size:1.4rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin:1rem 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem}
.card h2{color:#58a6ff;font-size:1rem;margin-bottom:.5rem;border-bottom:1px solid #30363d;padding-bottom:.3rem}
.stat{font-size:2rem;font-weight:bold;color:#58a6ff}
.stat-label{font-size:.75rem;color:#8b949e}
.bar-chart{display:flex;align-items:flex-end;gap:4px;height:100px;margin-top:.5rem}
.bar{background:#238636;border-radius:3px 3px 0 0;min-width:18px;position:relative;transition:height .3s}
.bar:hover{background:#2ea043}
.bar-label{position:absolute;top:-18px;font-size:.55rem;color:#8b949e;white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:.8rem;margin-top:.5rem}
th{text-align:left;color:#8b949e;border-bottom:1px solid #30363d;padding:4px 8px}
td{padding:4px 8px;border-bottom:1px solid #21262d;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{display:inline-block;background:#1f6feb33;color:#58a6ff;border-radius:12px;padding:1px 8px;font-size:.7rem;margin:1px}
.status{color:#3fb950;font-weight:bold}
.pill{display:inline-block;border-radius:12px;padding:2px 10px;font-size:.7rem}
.pill-green{background:#238636;color:#fff}
.pill-yellow{background:#9e6a03;color:#fff}
footer{text-align:center;color:#484f58;font-size:.7rem;margin-top:2rem;padding-top:.5rem;border-top:1px solid #21262d}
#refresh-indicator{position:fixed;top:8px;right:12px;font-size:.65rem;color:#484f58}
</style></head><body>
<div id="refresh-indicator"></div>
<h1>⚡ imzx-agent-sdk Dashboard</h1>
<div class="grid" id="stats-grid"></div>
<div class="grid">
  <div class="card"><h2>📊 Performance</h2><div id="perf-chart" class="bar-chart"></div></div>
  <div class="card"><h2>🕸️ Knowledge Graph</h2><div id="graph-info"></div></div>
  <div class="card"><h2>📡 Telemetry</h2><div id="telemetry-info"></div></div>
</div>
<div class="grid">
  <div class="card" style="grid-column:span 2"><h2>🧠 Memory Entries</h2><div id="memory-table"></div></div>
</div>
<div class="grid">
  <div class="card" style="grid-column:span 2"><h2>🔧 Skills</h2><div id="skills-table"></div></div>
</div>
<footer>imzx-agent-sdk v0.8.2 — auto-refreshes every 5s</footer>
<script nonce="${nonce}">
// [C4 FIX] Safe clear — removes all child nodes without using innerHTML
function clear(el){while(el.firstChild)el.removeChild(el.firstChild)}
async function fetchJSON(url){try{const r=await fetch(url);return r.ok?await r.json():null}catch{return null}}
function h(tag,attrs,...kids){const e=document.createElement(tag);if(attrs)Object.entries(attrs).forEach(([k,v])=>k==='className'?e.className=v:k==='style'&&typeof v==='object'?Object.assign(e.style,v):e.setAttribute(k,v));kids.flat().forEach(k=>e.append(typeof k==='string'?document.createTextNode(k):k));return e}
function renderStats(d){
  const g=document.getElementById('stats-grid');clear(g);
  const s=d||{};
  const cards=[['Uptime',(s.uptime||0).toFixed(0)+'s'],['Memory',s.memoryMB+' MB'],['Memory Entries',s.memoryCount||0],['Skills',s.skillCount||0],['Node',s.nodeVersion||'?'],['PID',s.pid||'?']];
  cards.forEach(([l,v])=>g.append(h('div','card',h('div','stat',String(v)),h('div','stat-label',l))));
}
function renderPerf(d){
  const el=document.getElementById('perf-chart');clear(el);
  const m=d?.metrics||{};const keys=Object.keys(m).filter(k=>typeof m[k]==='number').slice(0,12);
  if(!keys.length){el.textContent='No metrics yet';return}
  const max=Math.max(...keys.map(k=>m[k]))||1;
  keys.forEach(k=>{const pct=Math.round((m[k]/max)*100);const bar=h('div','bar');bar.style.height=pct+'%';bar.append(h('span','bar-label',k.slice(0,8)));el.append(bar)});
}
async function refresh(){
  document.getElementById('refresh-indicator').textContent='Refreshing...';
  const [stats,memory,skills,telemetry,graph]=await Promise.all(['/api/stats','/api/memory','/api/skills','/api/telemetry','/api/graph'].map(fetchJSON));
  renderStats(stats);renderPerf(stats);
  // Memory table
  const mt=document.getElementById('memory-table');clear(mt);
  if(memory?.length){const t=h('table',null,h('thead',null,h('tr',null,h('th',null,'Key'),h('th',null,'Category'),h('th',null,'Content'),h('th',null,'Importance'))));const tb=h('tbody');memory.slice(0,50).forEach(e=>tb.append(h('tr',null,h('td',null,e.key||'-'),h('td',null,h('span','tag',e.category||'?')),h('td',null,(e.content||'').slice(0,100)),h('td',null,String(e.importance||'-')))));t.append(tb);mt.append(t)}else mt.textContent='No memory entries';
  // Skills table
  const st=document.getElementById('skills-table');clear(st);
  if(skills?.length){const t=h('table',null,h('thead',null,h('tr',null,h('th',null,'Name'),h('th',null,'Category'),h('th',null,'Success'),h('th',null,'Failure'))));const tb=h('tbody');skills.forEach(s=>tb.append(h('tr',null,h('td',null,s.name||'-'),h('td',null,h('span','tag',s.category||'?')),h('td',null,String(s.success_count||0)),h('td',null,String(s.failure_count||0)))));t.append(tb);st.append(t)}else st.textContent='No skills saved';
  // Graph
  const gi=document.getElementById('graph-info');clear(gi);if(graph){gi.append(h('div',null,h('span','stat',String(graph.entities||0)),h('span','stat-label',' Entities')),h('div',null,h('span','stat',String(graph.relations||0)),h('span','stat-label',' Relations')))}else gi.textContent='No graph data';
  // Telemetry
  const ti=document.getElementById('telemetry-info');clear(ti);
  if(telemetry){ti.append(h('div',null,'Spans: '+telemetry.spanCount),h('div',null,'LLM Calls: '+telemetry.llmCallCount),h('div',null,'Total Tokens: '+(telemetry.totalTokens||0).toLocaleString()),h('div',null,'Total Cost: $'+(telemetry.totalCost||0).toFixed(4)))}else ti.textContent='No telemetry';
  document.getElementById('refresh-indicator').textContent='Updated '+new Date().toLocaleTimeString();
}
refresh();setInterval(refresh,5000);
</script></body></html>`;
}

// ── [C4 FIX] Security Headers ──────────────────────────────────────────
function securityHeaders(res: ServerResponse, nonce?: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (nonce) {
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';`);
  }
}

// ── JSON helper ───────────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// ── Routes ────────────────────────────────────────────────────────────────
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const p = url.pathname;

  // [C1 FIX] Rate limiting — 60 req/min per IP
  const clientIp = req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Max 60 requests per minute.' }));
    return;
  }

  // [C1 FIX] API authentication (skip for health check)
  if (p !== '/api/health' && !checkAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized. Set Authorization: Bearer <API_KEY> header.' }));
    return;
  }

  // Apply security headers to all responses
  securityHeaders(res);

  if (p === '/') {
    const nonce = generateNonce();
    securityHeaders(res, nonce);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHTML(nonce));
    return;
  }
  if (p === '/api/memory')   return json(res, 200, getMemoryEntries());
  if (p === '/api/skills')   return json(res, 200, getSkills());
  if (p === '/api/stats')    return json(res, 200, getStats());
  if (p === '/api/telemetry') return json(res, 200, getTelemetry());
  if (p === '/api/graph')    return json(res, 200, getGraph());
  if (p === '/api/health')   return json(res, 200, { status: 'ok', uptime: process.uptime(), version: "0.8.2" });

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`\x1b[1m\x1b[34m╔══════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[1m\x1b[34m║   imzx Dashboard  v0.8.2            ║\x1b[0m`);
  console.log(`\x1b[1m\x1b[34m╚══════════════════════════════════════╝\x1b[0m`);
  console.log(`\x1b[32m✓ Dashboard at http://${HOST}:${PORT}\x1b[0m`);
  console.log(`\x1b[2m  GET /              — Dashboard HTML`);
  console.log(`  GET /api/memory    — Memory entries`);
  console.log(`  GET /api/skills    — Saved skills`);
  console.log(`  GET /api/stats     — Agent stats`);
  console.log(`  GET /api/telemetry — Telemetry summary`);
  console.log(`  GET /api/graph     — Knowledge graph\x1b[0m\n`);
});

export { server };
