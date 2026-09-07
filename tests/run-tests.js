/* Bistro Builder — offline test suite: rules unit tests, deterministic
 * replay property test, content validators, golden sessions, save migration,
 * and an end-to-end server API smoke test (score replay validation).
 * Run: node tests/run-tests.js
 */
'use strict';

// Keep the server's score-store writes out of the repo fixture during tests.
process.env.BISTRO_DATA_DIR = require('path').join(require('os').tmpdir(), 'bistro-test-data-' + process.pid);

const assert = require('assert');
const R = require('../js/rules.js');
const C = require('../js/content.js');
const S = require('../js/store.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const run = Promise.resolve().then(fn).then(
    () => { passed++; console.log('  ok  ' + name); },
    (e) => { failed++; console.error('FAIL  ' + name + '\n      ' + (e && e.stack || e)); }
  );
  pending.push(run);
  return run;
}

// A deterministic greedy bot; returns an envelope like the client builds.
function playSession(cfg, opts) {
  opts = opts || {};
  const state = R.createGame(cfg);
  const commands = [], hashes = [{ tick: 0, hash: R.hashState(state) }];
  let invalid = 0, n = 0;
  while (!state.terminal && state.tick < 100000) {
    const legal = R.legalActions(state);
    let cmd = null;
    const urgent = legal.filter(a => a.type === 'serve');
    if (urgent.length) cmd = { type: 'serve', table: urgent[0].table };
    else if (legal.some(a => a.type === 'pickup')) cmd = { type: 'pickup' };
    else if (opts.buyer) {
      const buy = legal.find(a => a.type === 'buy');
      if (buy && state.coins > buy.cost + 20) cmd = { type: 'buy', item: buy.item };
    }
    if (cmd) {
      const res = R.applyCommand(state, cmd);
      if (res.ok) commands.push({ tick: state.tick, id: 'c' + state.tick + '-' + (++n), cmd });
      else invalid++;
    }
    R.step(state);
    if (state.tick % 50 === 0) hashes.push({ tick: state.tick, hash: R.hashState(state) });
  }
  if (state.terminal) hashes.push({ tick: state.tick, hash: R.hashState(state) });
  return {
    state, envelope: {
      v: 1, build: 'test', contentVersion: C.CONTENT_VERSION,
      cfgId: cfg.id, seed: cfg.seed >>> 0, initialHash: hashes[0].hash,
      t0: 0, commands, hashes,
      terminal: state.terminal && {
        reason: state.terminal.reason, win: state.terminal.win,
        tick: state.terminal.tick, score: state.terminal.score
      },
      sessionId: 'test-' + cfg.id, invalid, durationMs: state.tick * R.TICK_MS
    }
  };
}

console.log('rules engine');
test('createGame produces serializable initial state', () => {
  const st = R.createGame(C.JOURNEY[0]);
  assert.strictEqual(st.tick, 0);
  assert.strictEqual(st.tables.filter(t => t.open).length, C.JOURNEY[0].openTables);
  assert.strictEqual(st.stoves.length, 1);
  assert.ok(R.hashState(st) > 0);
});

test('serve/pickup legality and invalid reasons', () => {
  const cfg = C.LESSONS[0].cfg; // seated guest, carrying 1
  const st = R.createGame(cfg);
  const legal = R.legalActions(st);
  assert.ok(legal.some(a => a.type === 'serve' && a.table === 0));
  assert.deepStrictEqual(R.applyCommand(st, { type: 'serve', table: 99 }).reason, 'bad-table');
  assert.deepStrictEqual(R.applyCommand(st, { type: 'pickup' }).reason, 'no-dishes-available');
  assert.deepStrictEqual(R.applyCommand(st, {}).reason, 'malformed-command');
  assert.deepStrictEqual(R.applyCommand(st, { type: 'nuke' }).reason, 'unknown-command');
  assert.strictEqual(R.applyCommand(st, { type: 'serve', table: 0 }).ok, true);
});

test('serve resolves, pays price + patience tip', () => {
  const st = R.createGame(C.LESSONS[0].cfg);
  R.applyCommand(st, { type: 'serve', table: 0 });
  let guard = 0;
  while (st.score.served === 0 && guard++ < 2000) R.step(st);
  assert.strictEqual(st.score.served, 1);
  assert.ok(st.score.servePoints >= cfg_price(st));
  assert.ok(st.score.tips > 0, 'tip paid for fast service');
  assert.strictEqual(st.score.total, st.score.servePoints + st.score.tips + st.score.timeBonus - st.score.lost * 10);
  function cfg_price(s) { return s.cfg.price; }
});

test('buy upgrades obey funds, caps, and mechanics flags', () => {
  const st = R.createGame(C.LESSONS[3].cfg); // 30 coins, capacity enabled
  assert.strictEqual(R.buyInfo(st, 'helper').reason, 'mechanic-not-available');
  assert.deepStrictEqual(R.applyCommand(st, { type: 'buy', item: 'capacity' }).ok, true);
  assert.strictEqual(st.waiters[0].capacity, 3);
  assert.strictEqual(st.coins, 0);
  assert.strictEqual(R.buyInfo(st, 'capacity').reason, 'insufficient-coins');
  const st2 = R.createGame(C.LESSONS[3].cfg);
  R.applyCommand(st2, { type: 'buy', item: 'capacity' });
  st2.coins = 1000;
  R.applyCommand(st2, { type: 'buy', item: 'capacity' });
  R.applyCommand(st2, { type: 'buy', item: 'capacity' });
  assert.strictEqual(R.buyInfo(st2, 'capacity').reason, 'cap-reached');
});

test('expand opens walled tables; helper automates service', () => {
  const st = R.createGame(C.LESSONS[4].cfg);
  const closed = st.tables.filter(t => !t.open).length;
  assert.ok(closed > 0);
  R.applyCommand(st, { type: 'buy', item: 'expand' });
  assert.ok(st.tables.filter(t => !t.open).length < closed);
  assert.strictEqual(R.applyCommand(st, { type: 'buy', item: 'helper' }).ok, true);
  assert.strictEqual(st.waiters.length, 2);
  assert.strictEqual(st.score.helpers, 1);
});

test('terminal states: goal win, day fail, resign', () => {
  const easy = Object.assign({}, C.JOURNEY[0], { goal: 1 });
  const st = R.createGame(easy);
  let guard = 0;
  while (!st.terminal && guard++ < 20000) {
    const legal = R.legalActions(st);
    const s = legal.find(a => a.type === 'serve');
    if (s) R.applyCommand(st, { type: 'serve', table: s.table });
    else if (legal.some(a => a.type === 'pickup')) R.applyCommand(st, { type: 'pickup' });
    R.step(st);
  }
  assert.ok(st.terminal, 'terminated');
  assert.strictEqual(st.terminal.reason, 'goal-reached');
  assert.strictEqual(st.terminal.win, true);
  assert.ok(st.terminal.score.timeBonus >= 0);
  assert.strictEqual(R.applyCommand(st, { type: 'pickup' }).reason, 'game-ended');

  const hard = Object.assign({}, C.JOURNEY[0], { goal: 99999, daySec: 40 });
  const st2 = R.createGame(hard);
  while (!st2.terminal) R.step(st2);
  assert.strictEqual(st2.terminal.reason, 'day-failed');
  assert.strictEqual(st2.terminal.win, false);

  const st3 = R.createGame(C.JOURNEY[1]);
  R.applyCommand(st3, { type: 'resign' });
  assert.strictEqual(st3.terminal.reason, 'resigned');
});

test('lost guests cost score', () => {
  const cfg = Object.assign({}, C.JOURNEY[0], { daySec: 60, patienceSec: [3, 3] });
  const st = R.createGame(cfg);
  let guard = 0;
  while (!st.terminal && guard++ < 20000) R.step(st);
  assert.ok(st.score.lost > 0);
  assert.strictEqual(st.score.total, st.score.servePoints + st.score.tips + st.score.timeBonus - st.score.lost * 10);
});

test('serialization round-trip preserves state and hash', () => {
  const st = R.createGame(C.JOURNEY[2]);
  for (let i = 0; i < 300; i++) R.step(st);
  const back = R.deserialize(R.serialize(st));
  assert.strictEqual(R.hashState(back), R.hashState(st));
  assert.throws(() => R.deserialize('{"v":999}'), /version/);
});

test('deterministic replay: same seed + commands → identical hashes', () => {
  const cfg = C.JOURNEY[4];
  const a = playSession(cfg, { buyer: true });
  const b = playSession(cfg, { buyer: true });
  assert.strictEqual(a.envelope.hashes.length, b.envelope.hashes.length);
  a.envelope.hashes.forEach((h, i) => assert.strictEqual(h.hash, b.envelope.hashes[i].hash));
  assert.deepStrictEqual(a.state.terminal, b.state.terminal);
});

test('fuzz: malformed commands never hang or corrupt', () => {
  const st = R.createGame(C.JOURNEY[0]);
  const junk = [null, undefined, 5, 'x', {}, { type: 1 }, { type: 'serve' },
    { type: 'serve', table: -1 }, { type: 'serve', table: 1.5 },
    { type: 'goto', x: 'a', y: 0 }, { type: 'goto', x: 0, y: 99 },
    { type: 'buy' }, { type: 'buy', item: 'yacht' }, { type: 'pickup', extra: {} }];
  for (let round = 0; round < 50; round++) {
    junk.forEach(c => {
      const res = R.applyCommand(st, c);
      if (res.ok) assert.ok(['goto', 'pickup', 'serve', 'resign'].includes(c.type));
    });
    for (let i = 0; i < 10; i++) R.step(st);
    assert.ok(Number.isFinite(st.score.total));
  }
});

console.log('content');
test('all content passes offline validators (legality, reachable goals, bounded)', () => {
  const report = C.validateAll();
  const bad = Object.keys(report).filter(k => report[k].length);
  assert.deepStrictEqual(bad, [], 'invalid content: ' + JSON.stringify(bad.map(k => [k, report[k]])));
});

test('journey has 40 stages with mastery every fifth', () => {
  assert.strictEqual(C.JOURNEY.length, 40);
  [4, 9, 14, 19, 24, 29, 34, 39].forEach(i => assert.ok(C.JOURNEY[i].name.includes('Mastery')));
});

test('daily config is deterministic per UTC date', () => {
  const a = C.dailyCfg('2026-03-14');
  const b = C.dailyCfg('2026-03-14');
  assert.deepStrictEqual(a, b);
  assert.notStrictEqual(a.seed, C.dailyCfg('2026-03-15').seed);
});

test('golden sessions: easy/medium/hard all terminable by the bot', () => {
  [C.JOURNEY[0], C.JOURNEY[14], C.JOURNEY[29], C.CHALLENGES[0], C.dailyCfg('2026-01-15')].forEach(cfg => {
    const r = playSession(cfg, { buyer: true });
    assert.ok(r.state.terminal, cfg.id + ' did not terminate');
    assert.ok(r.state.terminal.score.total > 0, cfg.id + ' scored zero');
    assert.ok(Number.isFinite(r.state.terminal.score.total));
  });
});

console.log('persistence');
test('save migration fills defaults and rejects future versions', () => {
  const doc = S.migrate({ v: 0, settings: { music: 0.2 } });
  assert.strictEqual(doc.v, S.SAVE_VERSION);
  assert.strictEqual(doc.settings.music, 0.2);
  assert.strictEqual(doc.settings.effects, S.DEFAULT_SETTINGS.effects);
  assert.ok(doc.progress.stats);
  assert.strictEqual(S.migrate({ v: 999 }), null);
});

test('leaderboard tie-break order: score, invalid, elapsed, session id', () => {
  const sorted = S.sortEntries([
    { score: 100, invalid: 2, durationMs: 5000, sessionId: 'b' },
    { score: 100, invalid: 1, durationMs: 9000, sessionId: 'a' },
    { score: 100, invalid: 1, durationMs: 4000, sessionId: 'c' },
    { score: 120, invalid: 9, durationMs: 9000, sessionId: 'd' }
  ]);
  assert.deepStrictEqual(sorted.map(e => e.sessionId), ['d', 'c', 'a', 'b']);
});

test('achievement keys are stable lowercase identifiers', () => {
  S.ACHIEVEMENTS.forEach(a => assert.match(a.key, /^[a-z0-9-]+$/));
  const keys = S.ACHIEVEMENTS.map(a => a.key);
  assert.strictEqual(new Set(keys).size, keys.length);
});

console.log('server');
function startServer() {
  const srv = require('../server.js');
  return new Promise(resolve => {
    const s = srv.server.listen(0, () => resolve({ server: s, port: s.address().port }));
  });
}

test('server: time, static files, replay-validated scores, rejection of cheats', async () => {
  const { server, port } = await startServer();
  const base = 'http://127.0.0.1:' + port;
  try {
    const t = await fetch(base + '/api/v1/time').then(r => r.json());
    assert.ok(Math.abs(t.now - Date.now()) < 5000);

    const idx = await fetch(base + '/index.html');
    assert.strictEqual(idx.status, 200);
    assert.ok((await idx.text()).includes('Bistro Builder'));
    const rulesJs = await fetch(base + '/js/rules.js');
    assert.strictEqual(rulesJs.status, 200);
    const three = await fetch(base + '/vendor/three.module.min.js');
    assert.strictEqual(three.status, 200);
    assert.strictEqual((await fetch(base + '/server.js')).status, 403, 'server.js not served'); // path check
    assert.strictEqual((await fetch(base + '/../server.js')).status >= 400, true);

    // honest envelope passes
    const cfg = C.CHALLENGES[0];
    const r = playSession(cfg, { buyer: true });
    const okRes = await fetch(base + '/api/v1/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r.envelope)
    });
    const okBody = await okRes.json();
    assert.strictEqual(okRes.status, 200, JSON.stringify(okBody));
    assert.strictEqual(okBody.entry.score, r.state.terminal.score.total);

    // duplicate session replaces idempotently
    await fetch(base + '/api/v1/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r.envelope) });
    const board = await fetch(base + '/api/v1/scores?cfgId=' + cfg.id).then(x => x.json());
    assert.strictEqual(board.entries.filter(e => e.sessionId === r.envelope.sessionId).length, 1);

    // inflated score is rejected
    const cheat = JSON.parse(JSON.stringify(r.envelope));
    cheat.terminal.score = { total: 999999 };
    cheat.sessionId = 'cheater-1';
    const cheatRes = await fetch(base + '/api/v1/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cheat)
    });
    assert.strictEqual(cheatRes.status, 422);
    assert.strictEqual((await cheatRes.json()).error, 'score-mismatch');

    // stale content version rejected
    const stale = JSON.parse(JSON.stringify(r.envelope));
    stale.contentVersion = 999;
    stale.sessionId = 'stale-1';
    assert.strictEqual((await fetch(base + '/api/v1/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stale)
    })).status, 422);

    // unknown content rejected
    const ghost = JSON.parse(JSON.stringify(r.envelope));
    ghost.cfgId = 'daily-1999-13-99';
    ghost.sessionId = 'ghost-1';
    assert.strictEqual((await fetch(base + '/api/v1/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ghost)
    })).status, 422);

    // structured error shape
    const nf = await fetch(base + '/api/v1/nope');
    assert.strictEqual(nf.status, 404);
    assert.ok((await nf.json()).error);
  } finally {
    server.close();
  }
});

Promise.all(pending).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
