/* Bistro Builder — authoritative host script (StarHermit `server=` entry).
 * Serves the static distribution and the /api surface:
 *   GET  /api/v1/time     — authoritative time for daily boundaries
 *   GET  /api/v1/scores   — validated leaderboard entries (?cfgId=)
 *   POST /api/v1/scores   — replay-validated score submission
 *   POST /api/v1/events   — anonymous funnel counters
 * Competitive claims are never trusted: every ranked submission is replayed
 * deterministically through the shared rules engine and must reproduce the
 * claimed periodic state hashes and terminal score exactly.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const R = require('./js/rules.js');
const C = require('./js/content.js');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(ROOT, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const MAX_BODY = 256 * 1024;
const MAX_TICKS = 120000; // absolute simulation bound for replays

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.opus': 'audio/ogg'
};

// ---------- durable store ----------
let boards = { entries: [] };
try { boards = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch (e) { /* first boot */ }
function saveBoards() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SCORES_FILE, JSON.stringify(boards));
  } catch (e) { /* read-only distribution: keep in memory */ }
}

// ---------- rate limiting (per IP, sliding window) ----------
const buckets = new Map();
function rateLimited(ip, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(ip, b); }
  b.count++;
  return b.count > limit;
}

// ---------- content lookup: only ranked configs accept scores ----------
function cfgById(id) {
  if (!id || typeof id !== 'string' || id.length > 80) return null;
  const j = C.JOURNEY.find(c => c.id === id); // journey isn't ranked but harmless
  if (j) return j;
  const ch = C.CHALLENGES.find(c => c.id === id);
  if (ch) return ch;
  const m = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (m) return C.dailyCfg(m[1]); // daily seeds immutable: derived from the date
  return null;
}

// ---------- deterministic replay validation ----------
function replayEnvelope(env) {
  if (!env || typeof env !== 'object') return { ok: false, error: 'malformed-envelope' };
  if (env.v !== 1) return { ok: false, error: 'unsupported-schema-version' };
  if (env.contentVersion !== C.CONTENT_VERSION) return { ok: false, error: 'stale-content-version' };
  const cfg = cfgById(env.cfgId);
  if (!cfg) return { ok: false, error: 'unknown-content' };
  if (!cfg.ranked) return { ok: false, error: 'content-not-ranked' };
  if ((env.seed >>> 0) !== (cfg.seed >>> 0)) return { ok: false, error: 'seed-mismatch' };
  if (!Array.isArray(env.commands) || env.commands.length > 5000) return { ok: false, error: 'bad-command-log' };

  let state;
  try { state = R.createGame(cfg); } catch (e) { return { ok: false, error: 'init-failed' }; }
  if (R.hashState(state) !== env.initialHash) return { ok: false, error: 'initial-hash-mismatch' };

  const cmds = env.commands.slice().sort((a, b) => a.tick - b.tick);
  const seen = new Set();
  let ci = 0;
  const claimedHashes = Array.isArray(env.hashes) ? env.hashes : [];
  let hi = 0;

  while (!state.terminal && state.tick < MAX_TICKS) {
    while (ci < cmds.length && cmds[ci].tick === state.tick) {
      const c = cmds[ci++];
      if (typeof c.id !== 'string' || c.id.length > 64) return { ok: false, error: 'bad-command-id' };
      if (seen.has(c.id)) { continue; } // duplicates rejected idempotently
      seen.add(c.id);
      R.applyCommand(state, c.cmd); // illegal commands are inert in the engine
    }
    R.step(state);
    if (hi < claimedHashes.length && claimedHashes[hi].tick === state.tick) {
      if (claimedHashes[hi].hash !== R.hashState(state)) return { ok: false, error: 'hash-mismatch' };
      hi++;
    }
  }
  if (!state.terminal) return { ok: false, error: 'replay-did-not-terminate' };
  const t = env.terminal || {};
  if (t.reason !== state.terminal.reason || !!t.win !== !!state.terminal.win)
    return { ok: false, error: 'terminal-mismatch' };
  if (!t.score || t.score.total !== state.terminal.score.total)
    return { ok: false, error: 'score-mismatch' };
  return { ok: true, score: state.terminal.score, tick: state.tick };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

// ---------- static files ----------
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const blocked = !file.startsWith(ROOT) || file.includes('data' + path.sep) ||
    file === path.join(ROOT, 'server.js') || file === path.join(ROOT, 'spec.md');
  if (blocked) { json(res, 403, { error: 'forbidden' }); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { json(res, 404, { error: 'not-found' }); return; }
    const ext = path.extname(file).toLowerCase();
    const immutable = ext === '.js' || ext === '.css';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': immutable ? 'public, max-age=3600' : 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- router ----------
const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const ip = req.socket.remoteAddress || 'unknown';

  if (url.startsWith('/api/')) {
    if (url === '/api/v1/time' && req.method === 'GET') {
      json(res, 200, { now: Date.now() });
      return;
    }
    if (url.startsWith('/api/v1/scores') && req.method === 'GET') {
      const cfgId = (url.split('cfgId=')[1] || '').split('&')[0];
      const id = decodeURIComponent(cfgId || '');
      const entries = boards.entries
        .filter(e => !id || e.cfgId === id)
        .sort((a, b) => b.score - a.score ||
          (a.invalid || 0) - (b.invalid || 0) ||
          (a.durationMs || 0) - (b.durationMs || 0) ||
          String(a.sessionId).localeCompare(String(b.sessionId)))
        .slice(0, 50);
      json(res, 200, { entries, cfgId: id || null });
      return;
    }
    if (url === '/api/v1/scores' && req.method === 'POST') {
      if (rateLimited('scores:' + ip, 12, 60000)) { json(res, 429, { error: 'rate-limited' }); return; }
      readBody(req).then(env => {
        const verdict = replayEnvelope(env);
        if (!verdict.ok) { json(res, 422, { error: verdict.error }); return; }
        const entry = {
          cfgId: env.cfgId, score: verdict.score.total,
          invalid: env.invalid | 0, durationMs: env.durationMs | 0,
          sessionId: String(env.sessionId || '').slice(0, 40),
          name: String(env.name || 'Player').slice(0, 24),
          date: new Date().toISOString().slice(0, 10),
          ruleset: env.contentVersion, seed: env.seed >>> 0,
          win: !!env.terminal.win
        };
        // idempotent: same session + content replaces rather than duplicates
        boards.entries = boards.entries.filter(e => !(e.sessionId === entry.sessionId && e.cfgId === entry.cfgId));
        boards.entries.push(entry);
        boards.entries = boards.entries.slice(-2000);
        saveBoards();
        json(res, 200, { ok: true, entry });
      }).catch(err => json(res, 400, { error: err.message }));
      return;
    }
    if (url === '/api/v1/events' && req.method === 'POST') {
      if (rateLimited('events:' + ip, 60, 60000)) { json(res, 429, { error: 'rate-limited' }); return; }
      readBody(req).then(() => json(res, 202, { ok: true }))
        .catch(() => json(res, 400, { error: 'bad-body' }));
      return;
    }
    json(res, 404, { error: 'not-found' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'method-not-allowed' }); return; }
  serveStatic(req, res, url);
});

if (require.main === module) {
  server.listen(PORT, () => console.log('Bistro Builder server on http://localhost:' + PORT));
}

module.exports = { server, replayEnvelope, cfgById };
