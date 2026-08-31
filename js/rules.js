/* Bistro Builder — pure deterministic rules engine.
 * No rendering, no DOM, no Date.now(): every transition derives from
 * (state, command) only. Usable from browser (window.BBRules) and Node.
 *
 * Core loop: guests arrive at the door and seat themselves at free tables;
 * stoves cook dishes into the kitchen stock; waiters carry dishes from the
 * kitchen to waiting tables; served guests pay coins plus a patience tip.
 * Coins buy carry capacity, helper waiters (deterministic automation),
 * extra stoves, and floor expansions that open more tables. Reach the
 * day's earnings goal before service ends.
 *
 * Simulation: fixed 100 ms tick. All randomness flows through the seeded
 * rules stream whose state is serialized with the game.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.BBRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBRules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var STATE_VERSION = 1;
  var TICK_MS = 100;          // 10 ticks per second
  var MOVE_TICKS = 2;         // ticks per tile walked
  var INTERACT_TICKS = 2;     // pickup / serve resolution time
  var PREP_TICKS = 40;        // one stove cooks one dish in 4 s
  var SEAT_TICKS = 12;        // walking from door to table
  var EAT_TICKS = 30;         // eating before the table frees
  var HELPER_CAPACITY = 2;
  var LOST_PENALTY = 10;      // score points per guest lost
  var TIME_BONUS_DIV = 10;    // win bonus = ticks remaining / this

  var TERMINAL = {
    GOAL: 'goal-reached',
    DAY_COMPLETE: 'day-complete',
    DAY_FAILED: 'day-failed',
    RESIGN: 'resigned'
  };

  var INVALID = {
    ENDED: 'game-ended',
    BAD_CMD: 'unknown-command',
    BAD_SHAPE: 'malformed-command',
    BAD_TABLE: 'bad-table',
    NOT_OPEN: 'table-not-open',
    NO_GUEST: 'no-waiting-guest',
    NO_DISHES: 'no-dishes-available',
    NOT_AVAILABLE: 'mechanic-not-available',
    CAP_REACHED: 'cap-reached',
    NO_FUNDS: 'insufficient-coins',
    BAD_TILE: 'tile-not-walkable'
  };

  var DIRS = [[0, -1], [-1, 0], [1, 0], [0, 1]]; // fixed order: up, left, right, down

  // ---------- helpers ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Stable stringify: object keys sorted recursively → canonical hashing.
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      var out = '[';
      for (var i = 0; i < v.length; i++) out += (i ? ',' : '') + stableStringify(v[i]);
      return out + ']';
    }
    var keys = Object.keys(v).sort(), s = '{';
    for (var k = 0; k < keys.length; k++) {
      s += (k ? ',' : '') + JSON.stringify(keys[k]) + ':' + stableStringify(v[keys[k]]);
    }
    return s + '}';
  }

  function hashState(state) {
    var copy = clone(state);
    delete copy.events;
    return RNG.hashString(stableStringify(copy));
  }

  function recomputeTotal(state) {
    var s = state.score;
    s.total = s.servePoints + s.tips + s.timeBonus - s.lost * LOST_PENALTY;
  }

  function tableById(state, id) {
    for (var i = 0; i < state.tables.length; i++)
      if (state.tables[i].id === id) return state.tables[i];
    return null;
  }

  function guestById(state, id) {
    for (var i = 0; i < state.guests.length; i++)
      if (state.guests[i].id === id) return state.guests[i];
    return null;
  }

  function waiterById(state, id) {
    for (var i = 0; i < state.waiters.length; i++)
      if (state.waiters[i].id === id) return state.waiters[i];
    return null;
  }

  function blockedAt(state, x, y) {
    var i;
    for (i = 0; i < state.tables.length; i++)
      if (state.tables[i].x === x && state.tables[i].y === y) return true;
    for (i = 0; i < state.stoves.length; i++)
      if (state.stoves[i].x === x && state.stoves[i].y === y) return true;
    return false;
  }

  function walkable(state, x, y) {
    return x >= 0 && y >= 0 && x < state.cfg.grid.w && y < state.cfg.grid.h &&
      !blockedAt(state, x, y);
  }

  // BFS shortest path between walkable tiles; fixed visit order → deterministic.
  function findPath(state, fx, fy, tx, ty) {
    if (fx === tx && fy === ty) return [];
    if (!walkable(state, tx, ty)) return null;
    var w = state.cfg.grid.w, h = state.cfg.grid.h;
    var prev = new Int32Array(w * h).fill(-1);
    var seen = new Uint8Array(w * h);
    var q = [fy * w + fx];
    seen[q[0]] = 1;
    var target = ty * w + tx;
    for (var head = 0; head < q.length; head++) {
      var cur = q[head];
      if (cur === target) break;
      var cx = cur % w, cy = (cur / w) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (!walkable(state, nx, ny)) continue;
        var ni = ny * w + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (!seen[target]) return null;
    var path = [];
    for (var c = target; c !== fy * w + fx; c = prev[c]) path.push([c % w, (c / w) | 0]);
    path.reverse();
    return path;
  }

  // Walkable neighbor tiles of a blocked entity tile, in fixed order.
  function adjacentTiles(state, x, y) {
    var out = [];
    for (var d = 0; d < 4; d++) {
      var nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (walkable(state, nx, ny)) out.push([nx, ny]);
    }
    return out;
  }

  // Shortest path to any tile adjacent to (x,y); deterministic tie-break.
  function pathToAdjacent(state, w2, x, y) {
    var adj = adjacentTiles(state, x, y);
    var best = null;
    for (var i = 0; i < adj.length; i++) {
      var p = findPath(state, w2.x, w2.y, adj[i][0], adj[i][1]);
      if (p && (best === null || p.length < best.length)) best = p;
    }
    return best;
  }

  function nearestStove(state, w2) {
    var best = null, bestLen = -1;
    for (var i = 0; i < state.stoves.length; i++) {
      var st = state.stoves[i];
      var p = pathToAdjacent(state, w2, st.x, st.y);
      if (p && (best === null || p.length < bestLen)) { best = st; bestLen = p.length; }
    }
    return best;
  }

  // Most urgent waiting table: lowest patience ratio, then lowest id.
  function urgentTable(state) {
    var best = null, bestKey = Infinity;
    for (var i = 0; i < state.guests.length; i++) {
      var g = state.guests[i];
      if (g.status !== 'seated') continue;
      var key = (g.patience / g.maxPatience) * 1000 + g.id * 0.001;
      if (key < bestKey) { bestKey = key; best = g; }
    }
    return best ? tableById(state, best.tableId) : null;
  }

  // ---------- game creation ----------

  // cfg (content.js builds these; seconds are converted to ticks here):
  // { id, version, kind, name, seed, daySec, goal, coins, grid:{w,h},
  //   openTables, closedTables, stoves, spawnSec:[lo,hi], patienceSec:[lo,hi],
  //   maxQueue, price, tipMax, startCapacity, maxCapacity, maxHelpers,
  //   maxStoves, expandSize, costs:{capacity,helper,stove,expand},
  //   mechanics:{capacity,helper,stove,expand,undo,hint},
  //   ranked, endless, par:{score}, setup? }
  function createGame(cfg) {
    var seed = cfg.seed >>> 0;
    var rng = RNG.derive(seed, RNG.STREAM_RULES);
    var w = cfg.grid.w, h = cfg.grid.h;

    // Tables: authored spots from a deterministic two-row floor plan.
    var spots = tableSpots(w, h);
    var need = cfg.openTables + cfg.closedTables;
    if (need > spots.length) throw new Error('layout cannot fit ' + need + ' tables');
    var tables = [];
    for (var i = 0; i < need; i++) {
      tables.push({
        id: i, x: spots[i][0], y: spots[i][1],
        open: i < cfg.openTables, guestId: null, reservedBy: null
      });
    }

    // Stoves along the kitchen wall (top row), deterministic slots.
    var stoveSlots = stoveSpots(w);
    if (cfg.maxStoves > stoveSlots.length) throw new Error('layout cannot fit stoves');
    var stoves = [];
    for (var s = 0; s < cfg.stoves; s++) {
      stoves.push({ id: s, x: stoveSlots[s][0], y: stoveSlots[s][1], progress: 0 });
    }

    var state = {
      v: STATE_VERSION,
      cfg: clone(cfg),
      seed: seed,
      rngState: rng.state,
      tick: 0,
      dayTicks: cfg.daySec * 10,
      spawn: { lo: cfg.spawnSec[0] * 10, hi: cfg.spawnSec[1] * 10 },
      patience: { lo: cfg.patienceSec[0] * 10, hi: cfg.patienceSec[1] * 10 },
      spawnTimer: 20, // first guest after 2 s
      coins: cfg.coins,
      earned: 0,
      stock: 0,
      stockCap: cfg.stoves * 3,
      tables: tables,
      stoves: stoves,
      guests: [],
      nextGuestId: 1,
      waiters: [{
        id: 0, kind: 'player', x: 1, y: h - 1, homeX: 1, homeY: h - 1,
        path: [], cool: 0, interact: 0, task: null,
        carrying: 0, capacity: cfg.startCapacity
      }],
      expansions: 0,
      capacityLevel: 0,
      score: { served: 0, servePoints: 0, tips: 0, lost: 0,
               expansions: 0, helpers: 0, timeBonus: 0, total: 0 },
      terminal: null,
      events: []
    };

    // Optional scripted setup (used by Learn lessons and challenges).
    if (cfg.setup) applySetup(state, cfg.setup);
    return state;
  }

  // Two-row floor plan: tables face the kitchen wall; fixed ordering.
  function tableSpots(w, h) {
    var spots = [];
    var rows = [];
    for (var y = 2; y <= h - 2; y += 2) rows.push(y);
    for (var r = 0; r < rows.length; r++)
      for (var x = 2; x <= w - 2; x += 2) spots.push([x, rows[r]]);
    return spots;
  }

  function stoveSpots(w) {
    var spots = [];
    for (var x = 1; x <= w - 1; x += 2) spots.push([x, 0]);
    return spots;
  }

  function applySetup(state, setup) {
    var p = state.waiters[0];
    if (setup.carrying) p.carrying = Math.min(setup.carrying, p.capacity);
    if (setup.stock) state.stock = setup.stock;
    if (setup.coins != null) state.coins = setup.coins;
    (setup.seated || []).forEach(function (entry) {
      var t = tableById(state, entry.table);
      if (!t || !t.open) return;
      var g = {
        id: state.nextGuestId++, status: 'seated', tableId: t.id,
        patience: entry.patience != null ? entry.patience : state.patience.hi,
        maxPatience: state.patience.hi, eatTicks: 0, seatTicks: 0
      };
      t.guestId = g.id;
      state.guests.push(g);
    });
    (setup.queue || []).forEach(function (entry) {
      state.guests.push({
        id: state.nextGuestId++, status: 'queue', tableId: null,
        patience: entry.patience != null ? entry.patience : state.patience.hi,
        maxPatience: state.patience.hi, eatTicks: 0, seatTicks: 0
      });
    });
  }

  function rngFrom(state) {
    var r = RNG.derive(0, 0);
    r.state = state.rngState;
    return r;
  }

  // ---------- legality ----------

  function dishesAvailable(state) {
    return state.stock + state.waiters[0].carrying;
  }

  function waitingTable(state, id) {
    var t = tableById(state, id);
    if (!t || !t.open || t.guestId == null) return null;
    var g = guestById(state, t.guestId);
    return g && g.status === 'seated' ? t : null;
  }

  function buyInfo(state, item) {
    var cfg = state.cfg;
    if (!cfg.mechanics[item]) return { ok: false, reason: INVALID.NOT_AVAILABLE };
    var level, cost, cap;
    if (item === 'capacity') {
      level = state.capacityLevel; cap = cfg.costs.capacity.length;
      cost = cfg.costs.capacity[level];
    } else if (item === 'helper') {
      level = state.waiters.length - 1; cap = cfg.maxHelpers;
      cost = cfg.costs.helper[Math.min(level, cfg.costs.helper.length - 1)];
      cap = Math.min(cap, cfg.costs.helper.length);
    } else if (item === 'stove') {
      level = state.stoves.length - cfg.stoves; cap = cfg.maxStoves - cfg.stoves;
      cost = cfg.costs.stove[Math.min(level, cfg.costs.stove.length - 1)];
      cap = Math.min(cap, cfg.costs.stove.length);
    } else if (item === 'expand') {
      var closed = 0;
      for (var i = 0; i < state.tables.length; i++) if (!state.tables[i].open) closed++;
      level = state.expansions;
      cap = Math.min(cfg.costs.expand.length, Math.ceil(closed / cfg.expandSize));
      cost = cfg.costs.expand[Math.min(level, cfg.costs.expand.length - 1)];
    } else {
      return { ok: false, reason: INVALID.BAD_CMD };
    }
    if (level >= cap) return { ok: false, reason: INVALID.CAP_REACHED, item: item };
    if (state.coins < cost) return { ok: false, reason: INVALID.NO_FUNDS, item: item, cost: cost };
    return { ok: true, item: item, cost: cost, level: level };
  }

  // Legal-action query — the same API tutorials and hints use.
  function legalActions(state) {
    if (state.terminal) return [];
    var out = [];
    var i, t;
    for (i = 0; i < state.tables.length; i++) {
      t = state.tables[i];
      if (waitingTable(state, t.id) && dishesAvailable(state) > 0) {
        var g = guestById(state, t.guestId);
        out.push({ type: 'serve', table: t.id, urgent: g.patience <= g.maxPatience * 0.3 });
      }
    }
    if (state.stock > 0 && state.waiters[0].carrying < state.waiters[0].capacity)
      out.push({ type: 'pickup' });
    ['capacity', 'helper', 'stove', 'expand'].forEach(function (item) {
      var info = buyInfo(state, item);
      if (info.ok) out.push({ type: 'buy', item: item, cost: info.cost, level: info.level });
    });
    return out;
  }

  // Contextual hint built purely from the legal-action query.
  function hint(state) {
    var legal = legalActions(state);
    var i;
    for (i = 0; i < legal.length; i++)
      if (legal[i].type === 'serve' && legal[i].urgent)
        return { action: legal[i], text: 'Table ' + (legal[i].table + 1) + ' is about to walk out — serve it now.' };
    for (i = 0; i < legal.length; i++)
      if (legal[i].type === 'serve')
        return { action: legal[i], text: 'A guest is waiting at table ' + (legal[i].table + 1) + '.' };
    for (i = 0; i < legal.length; i++)
      if (legal[i].type === 'pickup')
        return { action: legal[i], text: 'Dishes are ready — pick them up from the kitchen.' };
    if (state.stock === 0 && state.waiters[0].carrying === 0) {
      var anyWaiting = state.guests.some(function (g) { return g.status === 'seated'; });
      if (anyWaiting) return { action: null, text: 'The kitchen is still cooking — a dish will be ready soon.' };
    }
    for (i = 0; i < legal.length; i++)
      if (legal[i].type === 'buy')
        return { action: legal[i], text: 'You can afford an upgrade: ' + legal[i].item + ' for ' + legal[i].cost + ' coins.' };
    return { action: null, text: 'Seat is open — wait for the next guest at the door.' };
  }

  // ---------- commands ----------

  function assignTask(state, w2, task) {
    w2.task = task;
    w2.interact = 0;
    var target = null;
    if (task.kind === 'serve' && task.stage === 'deliver') {
      var t = tableById(state, task.table);
      target = t ? pathToAdjacent(state, w2, t.x, t.y) : null;
    } else if (task.kind === 'pickup' || (task.kind === 'serve' && task.stage === 'pickup')) {
      var st = nearestStove(state, w2);
      target = st ? pathToAdjacent(state, w2, st.x, st.y) : null;
      if (task.kind === 'serve') task.stage = 'pickup';
    } else if (task.kind === 'goto') {
      target = findPath(state, w2.x, w2.y, task.x, task.y);
    } else if (task.kind === 'home') {
      target = findPath(state, w2.x, w2.y, w2.homeX, w2.homeY);
    }
    w2.path = target || [];
    if (target === null) w2.task = null; // unreachable: stay idle
  }

  // cmd: {type:'serve',table} | {type:'pickup'} | {type:'goto',x,y} |
  //      {type:'buy',item} | {type:'resign'}
  function applyCommand(state, cmd) {
    if (state.terminal) return { ok: false, reason: INVALID.ENDED };
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string')
      return { ok: false, reason: INVALID.BAD_SHAPE };
    var p = state.waiters[0];

    if (cmd.type === 'serve') {
      if (!Number.isInteger(cmd.table)) return { ok: false, reason: INVALID.BAD_SHAPE };
      var t = tableById(state, cmd.table);
      if (!t) return { ok: false, reason: INVALID.BAD_TABLE };
      if (!t.open) return { ok: false, reason: INVALID.NOT_OPEN };
      if (!waitingTable(state, t.id)) return { ok: false, reason: INVALID.NO_GUEST };
      if (dishesAvailable(state) <= 0) return { ok: false, reason: INVALID.NO_DISHES };
      if (p.task && p.task.kind === 'serve' && p.task.table === t.id)
        return { ok: true }; // idempotent re-issue: keep walk/interact progress
      assignTask(state, p, { kind: 'serve', table: t.id, stage: p.carrying > 0 ? 'deliver' : 'pickup' });
      state.events.push({ t: 'cmd', kind: 'serve', table: t.id });
      return { ok: true };
    }

    if (cmd.type === 'pickup') {
      if (state.stock <= 0) return { ok: false, reason: INVALID.NO_DISHES };
      if (p.carrying >= p.capacity) return { ok: false, reason: INVALID.CAP_REACHED };
      if (p.task && p.task.kind === 'pickup') return { ok: true }; // idempotent
      assignTask(state, p, { kind: 'pickup' });
      state.events.push({ t: 'cmd', kind: 'pickup' });
      return { ok: true };
    }

    if (cmd.type === 'goto') {
      if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.y))
        return { ok: false, reason: INVALID.BAD_SHAPE };
      if (!walkable(state, cmd.x, cmd.y)) return { ok: false, reason: INVALID.BAD_TILE };
      assignTask(state, p, { kind: 'goto', x: cmd.x, y: cmd.y });
      state.events.push({ t: 'cmd', kind: 'goto' });
      return { ok: true };
    }

    if (cmd.type === 'buy') {
      var info = buyInfo(state, cmd.item);
      if (!info.ok) return info;
      state.coins -= info.cost;
      if (cmd.item === 'capacity') {
        state.capacityLevel++;
        p.capacity++;
      } else if (cmd.item === 'helper') {
        var n = state.waiters.length;
        var hx = Math.min(1 + n, state.cfg.grid.w - 1), hy = state.cfg.grid.h - 1;
        state.waiters.push({
          id: n, kind: 'helper', x: hx, y: hy, homeX: hx, homeY: hy,
          path: [], cool: 0, interact: 0, task: null,
          carrying: 0, capacity: HELPER_CAPACITY
        });
        state.score.helpers++;
      } else if (cmd.item === 'stove') {
        var slots = stoveSpots(state.cfg.grid.w);
        var slot = slots[state.stoves.length];
        state.stoves.push({ id: state.stoves.length, x: slot[0], y: slot[1], progress: 0 });
        state.stockCap += 3;
      } else if (cmd.item === 'expand') {
        var opened = 0;
        for (var i = 0; i < state.tables.length && opened < state.cfg.expandSize; i++) {
          if (!state.tables[i].open) { state.tables[i].open = true; opened++; }
        }
        state.expansions++;
        state.score.expansions++;
      }
      state.events.push({ t: 'buy', item: cmd.item, cost: info.cost });
      return { ok: true };
    }

    if (cmd.type === 'resign') {
      finish(state, TERMINAL.RESIGN, false);
      return { ok: true };
    }

    return { ok: false, reason: INVALID.BAD_CMD };
  }

  function finish(state, reason, win) {
    if (state.terminal) return;
    if (win && reason === TERMINAL.GOAL)
      state.score.timeBonus = Math.floor((state.dayTicks - state.tick) / TIME_BONUS_DIV);
    recomputeTotal(state);
    state.terminal = {
      reason: reason, win: win, tick: state.tick,
      elapsedMs: state.tick * TICK_MS,
      score: clone(state.score)
    };
    state.events.push({ t: win ? 'win' : 'lose', reason: reason });
  }

  // ---------- per-tick simulation ----------

  function step(state) {
    if (state.terminal) return state;
    var rng = rngFrom(state);
    var cfg = state.cfg;
    state.tick++;
    var i, g, t;

    // 1. Stoves cook into shared stock.
    for (i = 0; i < state.stoves.length; i++) {
      var st = state.stoves[i];
      if (state.stock >= state.stockCap) { st.progress = 0; continue; }
      st.progress++;
      if (st.progress >= PREP_TICKS) {
        st.progress = 0;
        state.stock++;
        state.events.push({ t: 'dish-ready', stock: state.stock });
      }
    }

    // 2. Guest spawns at the door.
    state.spawnTimer--;
    if (state.spawnTimer <= 0) {
      state.spawnTimer = rng.range(state.spawn.lo, state.spawn.hi);
      var queued = 0;
      for (i = 0; i < state.guests.length; i++)
        if (state.guests[i].status === 'queue') queued++;
      if (queued < cfg.maxQueue) {
        var pat = rng.range(state.patience.lo, state.patience.hi);
        state.guests.push({
          id: state.nextGuestId++, status: 'queue', tableId: null,
          patience: pat, maxPatience: pat, eatTicks: 0, seatTicks: 0
        });
        state.events.push({ t: 'spawn', id: state.nextGuestId - 1 });
      }
    }
    state.rngState = rng.state;

    // 3. Seating: earliest queued guest takes the lowest free table.
    for (i = 0; i < state.tables.length; i++) {
      t = state.tables[i];
      if (!t.open || t.guestId != null || t.reservedBy != null) continue;
      for (var j = 0; j < state.guests.length; j++) {
        g = state.guests[j];
        if (g.status === 'queue' && g.tableId == null) {
          g.tableId = t.id;
          t.reservedBy = g.id;
          g.seatTicks = SEAT_TICKS;
          break;
        }
      }
    }

    // 4. Guest lifecycle: seating walk, patience, eating.
    for (i = state.guests.length - 1; i >= 0; i--) {
      g = state.guests[i];
      if (g.status === 'queue' && g.tableId != null) {
        g.seatTicks--;
        if (g.seatTicks <= 0) {
          g.status = 'seated';
          t = tableById(state, g.tableId);
          if (t) { t.reservedBy = null; t.guestId = g.id; }
          state.events.push({ t: 'seat', id: g.id, table: g.tableId });
        }
        continue; // patience starts once seated
      }
      if (g.status === 'queue' || g.status === 'seated') {
        g.patience--;
        if (g.patience <= 0) {
          t = g.tableId != null ? tableById(state, g.tableId) : null;
          if (t) { t.guestId = null; t.reservedBy = null; }
          state.guests.splice(i, 1);
          state.score.lost++;
          recomputeTotal(state);
          state.events.push({ t: 'leave-angry', id: g.id, table: g.tableId });
        }
        continue;
      }
      if (g.status === 'eating') {
        g.eatTicks--;
        if (g.eatTicks <= 0) {
          t = tableById(state, g.tableId);
          if (t) t.guestId = null;
          state.guests.splice(i, 1);
          state.events.push({ t: 'leave-happy', id: g.id, table: g.tableId });
        }
      }
    }

    // 5. Helpers pick deterministic tasks when idle.
    for (i = 1; i < state.waiters.length; i++) {
      var hp = state.waiters[i];
      if (hp.task || hp.path.length || hp.interact > 0) continue;
      var target = urgentTable(state);
      if (hp.carrying > 0 && target) {
        assignTask(state, hp, { kind: 'serve', table: target.id, stage: 'deliver' });
      } else if (hp.carrying < hp.capacity && state.stock > 0) {
        assignTask(state, hp, { kind: 'pickup' });
      } else if (hp.x !== hp.homeX || hp.y !== hp.homeY) {
        assignTask(state, hp, { kind: 'home' });
      }
    }

    // 6. Movement and interactions for every waiter.
    for (i = 0; i < state.waiters.length; i++) {
      var w2 = state.waiters[i];
      if (w2.path.length > 0) {
        if (w2.cool > 0) { w2.cool--; continue; }
        var next = w2.path.shift();
        w2.x = next[0]; w2.y = next[1];
        w2.cool = MOVE_TICKS - 1;
        if (w2.path.length > 0) continue;
      }
      if (w2.task && (w2.task.kind === 'serve' || w2.task.kind === 'pickup')) {
        if (w2.path.length === 0) {
          w2.interact++;
          if (w2.interact >= INTERACT_TICKS) {
            w2.interact = 0;
            resolveTask(state, w2);
          }
        }
      }
    }

    // 7. Terminal checks.
    if (cfg.goal > 0 && state.earned >= cfg.goal) {
      finish(state, TERMINAL.GOAL, true);
    } else if (state.tick >= state.dayTicks) {
      if (cfg.endless || cfg.goal <= 0) finish(state, TERMINAL.DAY_COMPLETE, true);
      else finish(state, TERMINAL.DAY_FAILED, false);
    }
    return state;
  }

  function resolveTask(state, w2) {
    var task = w2.task;
    if (!task) return;
    if (task.kind === 'pickup' || (task.kind === 'serve' && task.stage === 'pickup')) {
      var take = Math.min(w2.capacity - w2.carrying, state.stock);
      if (take > 0) {
        state.stock -= take;
        w2.carrying += take;
        state.events.push({ t: 'pickup', waiter: w2.id, n: take });
      }
      if (task.kind === 'serve') {
        task.stage = 'deliver';
        var t = tableById(state, task.table);
        var p = t ? pathToAdjacent(state, w2, t.x, t.y) : null;
        if (p) { w2.path = p; return; }
      }
      w2.task = null;
      return;
    }
    if (task.kind === 'serve' && task.stage === 'deliver') {
      var t2 = waitingTable(state, task.table);
      if (t2 && w2.carrying > 0) {
        var g = guestById(state, t2.guestId);
        w2.carrying--;
        g.status = 'eating';
        g.eatTicks = EAT_TICKS;
        var tip = Math.round(state.cfg.tipMax * Math.max(0, g.patience) / g.maxPatience);
        var pay = state.cfg.price + tip;
        state.coins += pay;
        state.earned += pay;
        state.score.served++;
        state.score.servePoints += state.cfg.price;
        state.score.tips += tip;
        recomputeTotal(state);
        state.events.push({ t: 'serve', waiter: w2.id, table: t2.id, id: g.id, pay: pay, tip: tip });
      } else {
        state.events.push({ t: 'fizzle', waiter: w2.id, kind: 'serve', table: task.table });
      }
      w2.task = null;
    }
  }

  // ---------- serialization ----------

  function serialize(state) { return JSON.stringify(state); }
  function deserialize(json) {
    var s = JSON.parse(json);
    if (!s || s.v !== STATE_VERSION) throw new Error('unsupported state version');
    s.events = s.events || [];
    return s;
  }

  return {
    TICK_MS: TICK_MS,
    TERMINAL: TERMINAL,
    INVALID: INVALID,
    createGame: createGame,
    legalActions: legalActions,
    applyCommand: applyCommand,
    step: step,
    hint: hint,
    hashState: hashState,
    serialize: serialize,
    deserialize: deserialize,
    stableStringify: stableStringify,
    buyInfo: buyInfo
  };
});
