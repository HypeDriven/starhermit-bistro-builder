/* Bistro Builder — versioned content: lessons, journey stages, challenges,
 * daily generator, visual themes, and offline validators.
 * Usable from browser (window.BBContent) and Node.
 *
 * Every config is plain data: identifier, version, seed, initial state,
 * goals, allowed mechanics, par values, tutorial flags, and theme.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.BBRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBContent = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var CONTENT_VERSION = 1;

  var DEFAULT_COSTS = {
    capacity: [30, 60, 100],
    helper: [50, 90, 140],
    stove: [45, 80],
    expand: [40, 90, 150]
  };

  function allMechanics() {
    return { capacity: true, helper: true, stove: true, expand: true, undo: true, hint: true };
  }

  // ---------- journey ----------

  var JOURNEY_DEFAULTS = {
    version: CONTENT_VERSION, kind: 'journey',
    daySec: 150, coins: 10,
    grid: { w: 9, h: 7 },
    openTables: 3, closedTables: 1, stoves: 1,
    spawnSec: [7, 10], patienceSec: [24, 32],
    maxQueue: 3, price: 8, tipMax: 6,
    startCapacity: 2, maxCapacity: 5, maxHelpers: 3, maxStoves: 3, expandSize: 2,
    costs: DEFAULT_COSTS,
    mechanics: allMechanics(),
    ranked: false, endless: false
  };

  // 40 authored stages. Only deltas from JOURNEY_DEFAULTS are listed; each
  // row was tuned by hand along the arc: introduce → combine → mastery (x5).
  var JOURNEY = [
    { id: 'j01', name: 'First Service', daySec: 120, goal: 60, openTables: 2, closedTables: 0,
      spawnSec: [8, 11], patienceSec: [30, 38],
      mechanics: { capacity: false, helper: false, stove: false, expand: false, undo: true, hint: true },
      seed: 101, par: { score: 90 } },
    { id: 'j02', name: 'Steady Trickle', daySec: 130, goal: 90, openTables: 2, closedTables: 0,
      spawnSec: [7, 10], mechanics: { capacity: true, helper: false, stove: false, expand: false, undo: true, hint: true },
      seed: 102, par: { score: 130 } },
    { id: 'j03', name: 'Full Trays', daySec: 140, goal: 120, openTables: 3, closedTables: 0,
      spawnSec: [7, 9], coins: 20,
      mechanics: { capacity: true, helper: false, stove: false, expand: false, undo: true, hint: true },
      seed: 103, par: { score: 165 } },
    { id: 'j04', name: 'Knock at the Wall', daySec: 140, goal: 140, openTables: 3, closedTables: 2,
      spawnSec: [6, 9], coins: 25,
      mechanics: { capacity: true, helper: false, stove: false, expand: true, undo: true, hint: true },
      seed: 104, par: { score: 190 } },
    { id: 'j05', name: 'Mastery: Two Rooms', daySec: 160, goal: 200, openTables: 3, closedTables: 3,
      spawnSec: [6, 8], coins: 30,
      mechanics: { capacity: true, helper: false, stove: false, expand: true, undo: true, hint: true },
      seed: 105, par: { score: 260 } },
    { id: 'j06', name: 'An Extra Pair of Hands', daySec: 150, goal: 170, openTables: 3, closedTables: 1,
      spawnSec: [6, 8], coins: 50,
      mechanics: { capacity: true, helper: true, stove: false, expand: true, undo: true, hint: true },
      seed: 106, par: { score: 230 } },
    { id: 'j07', name: 'Lunch Bell', daySec: 150, goal: 190, openTables: 4, closedTables: 1,
      spawnSec: [6, 8], patienceSec: [22, 30], coins: 40,
      mechanics: { capacity: true, helper: true, stove: false, expand: true, undo: true, hint: true },
      seed: 107, par: { score: 250 } },
    { id: 'j08', name: 'Second Stove', daySec: 150, goal: 200, openTables: 4, closedTables: 1,
      spawnSec: [5, 8], coins: 45,
      mechanics: { capacity: true, helper: true, stove: true, expand: true, undo: true, hint: true },
      seed: 108, par: { score: 265 } },
    { id: 'j09', name: 'Dinner Crowd', daySec: 160, goal: 230, openTables: 4, closedTables: 2,
      spawnSec: [5, 7], patienceSec: [22, 28], coins: 40,
      mechanics: allMechanics(), seed: 109, par: { score: 300 } },
    { id: 'j10', name: 'Mastery: Rush Line', daySec: 170, goal: 300, openTables: 4, closedTables: 2,
      spawnSec: [5, 7], maxQueue: 4, coins: 50,
      mechanics: allMechanics(), seed: 110, par: { score: 380 } },
    { id: 'j11', name: 'Impatient Regulars', daySec: 150, goal: 220, openTables: 4, closedTables: 2,
      spawnSec: [6, 8], patienceSec: [18, 24], coins: 40,
      mechanics: allMechanics(), seed: 111, par: { score: 290 } },
    { id: 'j12', name: 'Big Room Energy', daySec: 170, goal: 260, openTables: 5, closedTables: 2,
      grid: { w: 11, h: 7 }, spawnSec: [5, 8], coins: 45,
      mechanics: allMechanics(), seed: 112, par: { score: 330 } },
    { id: 'j13', name: 'Thin Margins', daySec: 160, goal: 240, openTables: 4, closedTables: 2,
      spawnSec: [5, 7], price: 7, coins: 35,
      mechanics: allMechanics(), seed: 113, par: { score: 300 } },
    { id: 'j14', name: 'Queue Control', daySec: 160, goal: 250, openTables: 5, closedTables: 1,
      grid: { w: 11, h: 7 }, spawnSec: [4, 7], maxQueue: 5, coins: 45,
      mechanics: allMechanics(), seed: 114, par: { score: 320 } },
    { id: 'j15', name: 'Mastery: Full House', daySec: 180, goal: 340, openTables: 5, closedTables: 3,
      grid: { w: 11, h: 7 }, spawnSec: [4, 6], maxQueue: 5, coins: 60,
      mechanics: allMechanics(), seed: 115, par: { score: 430 } },
    { id: 'j16', name: 'Slow Cooker', daySec: 160, goal: 230, openTables: 4, closedTables: 2,
      spawnSec: [6, 8], stoves: 1, coins: 50,
      mechanics: allMechanics(), seed: 116, par: { score: 295 } },
    { id: 'j17', name: 'Two Deep', daySec: 170, goal: 280, openTables: 6, closedTables: 0,
      grid: { w: 11, h: 9 }, spawnSec: [5, 7], coins: 50,
      mechanics: allMechanics(), seed: 117, par: { score: 350 } },
    { id: 'j18', name: 'Fickle Foodies', daySec: 160, goal: 250, openTables: 5, closedTables: 1,
      grid: { w: 11, h: 7 }, spawnSec: [5, 7], patienceSec: [16, 22], coins: 50,
      mechanics: allMechanics(), seed: 118, par: { score: 310 } },
    { id: 'j19', name: 'Expansion Debt', daySec: 170, goal: 300, openTables: 3, closedTables: 4,
      grid: { w: 11, h: 9 }, spawnSec: [5, 7], coins: 20,
      mechanics: allMechanics(), seed: 119, par: { score: 370 } },
    { id: 'j20', name: 'Mastery: Grand Reopen', daySec: 190, goal: 400, openTables: 4, closedTables: 4,
      grid: { w: 11, h: 9 }, spawnSec: [4, 6], maxQueue: 5, coins: 55,
      mechanics: allMechanics(), seed: 120, par: { score: 500 } },
    { id: 'j21', name: 'Small Plates', daySec: 160, goal: 240, openTables: 5, closedTables: 1,
      grid: { w: 11, h: 7 }, spawnSec: [5, 7], price: 6, tipMax: 8, coins: 45,
      mechanics: allMechanics(), seed: 121, par: { score: 305 } },
    { id: 'j22', name: 'The Long Hall', daySec: 170, goal: 290, openTables: 4, closedTables: 2,
      grid: { w: 13, h: 7 }, spawnSec: [5, 7], coins: 50,
      mechanics: allMechanics(), seed: 122, par: { score: 360 } },
    { id: 'j23', name: 'Double Shift', daySec: 200, goal: 360, openTables: 5, closedTables: 2,
      grid: { w: 11, h: 7 }, spawnSec: [5, 7], coins: 55,
      mechanics: allMechanics(), seed: 123, par: { score: 445 } },
    { id: 'j24', name: 'Hot Kitchen', daySec: 160, goal: 260, openTables: 5, closedTables: 2,
      grid: { w: 11, h: 7 }, spawnSec: [4, 6], patienceSec: [20, 26], coins: 55,
      mechanics: allMechanics(), seed: 124, par: { score: 330 } },
    { id: 'j25', name: 'Mastery: No Empty Seats', daySec: 190, goal: 430, openTables: 6, closedTables: 2,
      grid: { w: 11, h: 9 }, spawnSec: [4, 6], maxQueue: 6, coins: 65,
      mechanics: allMechanics(), seed: 125, par: { score: 540 } },
    { id: 'j26', name: 'Shoestring', daySec: 170, goal: 280, openTables: 4, closedTables: 3,
      grid: { w: 11, h: 7 }, spawnSec: [5, 7], coins: 5,
      costs: { capacity: [40, 70, 110], helper: [60, 100, 150], stove: [50, 90], expand: [50, 100, 160] },
      mechanics: allMechanics(), seed: 126, par: { score: 350 } },
    { id: 'j27', name: 'Food Critic Week', daySec: 170, goal: 320, openTables: 5, closedTables: 2,
      grid: { w: 11, h: 7 }, spawnSec: [5, 7], patienceSec: [16, 22], coins: 55,
      mechanics: allMechanics(), seed: 127, par: { score: 395 } },
    { id: 'j28', name: 'Corner Pocket', daySec: 170, goal: 300, openTables: 3, closedTables: 3,
      grid: { w: 9, h: 9 }, spawnSec: [5, 7], coins: 45,
      mechanics: allMechanics(), seed: 128, par: { score: 370 } },
    { id: 'j29', name: 'Banquet Preview', daySec: 180, goal: 360, openTables: 6, closedTables: 2,
      grid: { w: 13, h: 9 }, spawnSec: [4, 6], maxQueue: 6, coins: 60,
      mechanics: allMechanics(), seed: 129, par: { score: 445 } },
    { id: 'j30', name: 'Mastery: Critic’s Table', daySec: 200, goal: 440, openTables: 6, closedTables: 2,
      grid: { w: 13, h: 9 }, spawnSec: [4, 6], patienceSec: [16, 22], maxQueue: 6, coins: 70,
      mechanics: allMechanics(), seed: 130, par: { score: 545 } },
    { id: 'j31', name: 'Morning Rush', daySec: 150, goal: 260, openTables: 5, closedTables: 1,
      grid: { w: 11, h: 7 }, spawnSec: [3, 6], patienceSec: [20, 26], coins: 50,
      mechanics: allMechanics(), seed: 131, par: { score: 330 } },
    { id: 'j32', name: 'Heavy Doors', daySec: 180, goal: 340, openTables: 4, closedTables: 4,
      grid: { w: 13, h: 9 }, spawnSec: [4, 7], coins: 55,
      mechanics: allMechanics(), seed: 132, par: { score: 420 } },
    { id: 'j33', name: 'Tight Apron Strings', daySec: 170, goal: 300, openTables: 5, closedTables: 2,
      grid: { w: 11, h: 7 }, spawnSec: [4, 6], startCapacity: 1, coins: 45,
      mechanics: allMechanics(), seed: 133, par: { score: 370 } },
    { id: 'j34', name: 'Festival Day', daySec: 190, goal: 420, openTables: 6, closedTables: 3,
      grid: { w: 13, h: 9 }, spawnSec: [3, 5], maxQueue: 6, coins: 70,
      mechanics: allMechanics(), seed: 134, par: { score: 515 } },
    { id: 'j35', name: 'Mastery: Festival Peak', daySec: 200, goal: 520, openTables: 7, closedTables: 2,
      grid: { w: 13, h: 9 }, spawnSec: [3, 5], maxQueue: 7, coins: 80,
      mechanics: allMechanics(), seed: 135, par: { score: 640 } },
    { id: 'j36', name: 'After Hours', daySec: 170, goal: 330, openTables: 5, closedTables: 2,
      grid: { w: 11, h: 9 }, spawnSec: [4, 6], price: 9, coins: 60,
      mechanics: allMechanics(), seed: 136, par: { score: 405 } },
    { id: 'j37', name: 'No Reservations', daySec: 180, goal: 380, openTables: 6, closedTables: 2,
      grid: { w: 13, h: 9 }, spawnSec: [3, 5], patienceSec: [16, 22], maxQueue: 6, coins: 65,
      mechanics: allMechanics(), seed: 137, par: { score: 465 } },
    { id: 'j38', name: 'The Gauntlet', daySec: 190, goal: 440, openTables: 5, closedTables: 4,
      grid: { w: 13, h: 9 }, spawnSec: [3, 5], coins: 60,
      mechanics: allMechanics(), seed: 138, par: { score: 540 } },
    { id: 'j39', name: 'Standing Room Only', daySec: 200, goal: 500, openTables: 7, closedTables: 2,
      grid: { w: 13, h: 11 }, spawnSec: [3, 5], maxQueue: 8, coins: 75,
      mechanics: allMechanics(), seed: 139, par: { score: 610 } },
    { id: 'j40', name: 'Mastery: Star Service', daySec: 220, goal: 600, openTables: 8, closedTables: 2,
      grid: { w: 13, h: 11 }, spawnSec: [3, 4], patienceSec: [16, 22], maxQueue: 8, coins: 90,
      mechanics: allMechanics(), seed: 140, par: { score: 730 } }
  ];

  function buildJourney() {
    return JOURNEY.map(function (delta, i) {
      var cfg = Object.assign({}, JOURNEY_DEFAULTS, delta);
      cfg.grid = Object.assign({}, delta.grid || JOURNEY_DEFAULTS.grid);
      cfg.costs = delta.costs || JOURNEY_DEFAULTS.costs;
      cfg.mechanics = Object.assign({}, delta.mechanics || JOURNEY_DEFAULTS.mechanics);
      cfg.index = i;
      return cfg;
    });
  }

  // ---------- learn (interactive lessons) ----------

  function lessonCfg(id, name, over) {
    return Object.assign({
      id: id, version: CONTENT_VERSION, kind: 'learn', name: name, seed: 7,
      daySec: 600, goal: 0, coins: 0,
      grid: { w: 9, h: 7 }, openTables: 2, closedTables: 0, stoves: 1,
      spawnSec: [999, 999], patienceSec: [40, 50], maxQueue: 2,
      price: 8, tipMax: 6, startCapacity: 2, maxCapacity: 5, maxHelpers: 2,
      maxStoves: 2, expandSize: 2, costs: DEFAULT_COSTS,
      mechanics: { capacity: false, helper: false, stove: false, expand: false, undo: false, hint: true },
      ranked: false, endless: false, par: { score: 0 }
    }, over || {});
  }

  var LESSONS = [
    {
      id: 'serve', title: 'Serve a guest',
      text: 'A guest is waiting at a table and you are carrying a dish. Tap the table (or use the Serve button) to deliver it.',
      cfg: lessonCfg('learn-serve', 'Serve a guest', {
        setup: { carrying: 1, seated: [{ table: 0, patience: 400 }] }
      }),
      steps: [{ event: 'serve', text: 'Serve the waiting guest.' }]
    },
    {
      id: 'pickup', title: 'Stock up',
      text: 'The kitchen has finished a dish. Walk to the kitchen and pick it up, then serve the waiting guest.',
      cfg: lessonCfg('learn-pickup', 'Stock up', {
        setup: { stock: 1, seated: [{ table: 0, patience: 500 }] }
      }),
      steps: [
        { event: 'pickup', text: 'Pick up the dish from the kitchen.' },
        { event: 'serve', text: 'Now serve the waiting guest.' }
      ]
    },
    {
      id: 'patience', title: 'Watch patience',
      text: 'Two guests are waiting. The amber one is running out of patience — serve the urgent table first.',
      cfg: lessonCfg('learn-patience', 'Watch patience', {
        openTables: 2,
        setup: { stock: 2, seated: [{ table: 0, patience: 60 }, { table: 1, patience: 500 }] }
      }),
      steps: [
        { event: 'serve', table: 0, text: 'Serve the urgent (amber) guest first.' },
        { event: 'serve', table: 1, text: 'Now serve the patient guest.' }
      ]
    },
    {
      id: 'upgrade', title: 'Carry more',
      text: 'You have 30 coins. Buy a tray upgrade so you can carry three dishes at once.',
      cfg: lessonCfg('learn-upgrade', 'Carry more', {
        coins: 30,
        mechanics: { capacity: true, helper: false, stove: false, expand: false, undo: false, hint: true }
      }),
      steps: [{ event: 'buy', item: 'capacity', text: 'Buy the tray upgrade (30 coins).' }]
    },
    {
      id: 'crew', title: 'Hire and expand',
      text: 'A growing bistro needs help. Hire a helper waiter, then knock down the wall to open two more tables.',
      cfg: lessonCfg('learn-crew', 'Hire and expand', {
        coins: 100, openTables: 2, closedTables: 2,
        mechanics: { capacity: false, helper: true, stove: false, expand: true, undo: false, hint: true }
      }),
      steps: [
        { event: 'buy', item: 'helper', text: 'Hire a helper waiter (50 coins).' },
        { event: 'buy', item: 'expand', text: 'Expand the dining room (40 coins).' }
      ]
    }
  ];

  // ---------- challenges ----------

  function challengeCfg(id, name, desc, over) {
    return Object.assign({
      id: 'challenge-' + id, version: CONTENT_VERSION, kind: 'challenge',
      name: name, desc: desc, seed: RNG.hashString('bistro-challenge-' + id),
      daySec: 150, goal: 150, coins: 20,
      grid: { w: 9, h: 7 }, openTables: 3, closedTables: 1, stoves: 1,
      spawnSec: [6, 9], patienceSec: [22, 30], maxQueue: 3,
      price: 8, tipMax: 6, startCapacity: 2, maxCapacity: 5, maxHelpers: 3,
      maxStoves: 3, expandSize: 2, costs: DEFAULT_COSTS,
      mechanics: allMechanics(), ranked: true, endless: false, par: { score: 200 }
    }, over || {});
  }

  var CHALLENGES = [
    challengeCfg('solo-sprint', 'Solo Sprint', 'No helpers, ninety seconds, big goal.',
      { daySec: 90, goal: 130, coins: 15, spawnSec: [5, 7],
        mechanics: { capacity: true, helper: false, stove: true, expand: true, undo: false, hint: false },
        par: { score: 210 } }),
    challengeCfg('one-tray', 'One Tray', 'Your tray never upgrades — one dish per trip.',
      { goal: 120, startCapacity: 1, maxCapacity: 1, spawnSec: [6, 8],
        mechanics: { capacity: false, helper: true, stove: true, expand: true, undo: false, hint: true },
        par: { score: 185 } }),
    challengeCfg('tiny-room', 'Tiny Room', 'Two tables, no walls to knock down.',
      { goal: 110, openTables: 2, closedTables: 0, spawnSec: [5, 8],
        mechanics: { capacity: true, helper: true, stove: true, expand: false, undo: false, hint: true },
        par: { score: 175 } }),
    challengeCfg('rush-hour', 'Rush Hour', 'Relentless door, short fuses.',
      { goal: 240, daySec: 170, openTables: 5, closedTables: 1, grid: { w: 11, h: 7 },
        spawnSec: [3, 5], patienceSec: [14, 20], maxQueue: 6, coins: 50,
        par: { score: 320 } }),
    challengeCfg('frugal', 'Frugal', 'Everything costs double. Make every coin count.',
      { goal: 160, coins: 15,
        costs: { capacity: [60, 120, 200], helper: [100, 180, 280], stove: [90, 160], expand: [80, 180, 300] },
        par: { score: 230 } }),
    challengeCfg('marathon', 'Marathon', 'A five-minute grand service.',
      { goal: 520, daySec: 300, openTables: 6, closedTables: 3, grid: { w: 13, h: 9 },
        spawnSec: [3, 5], maxQueue: 7, coins: 70,
        par: { score: 640 } })
  ];

  // ---------- practice ----------

  var PRACTICE = {
    calm: { name: 'Calm service', daySec: 180, goal: 0, endless: true, coins: 30,
      spawnSec: [8, 12], patienceSec: [30, 40], openTables: 3, closedTables: 2 },
    normal: { name: 'Normal service', daySec: 180, goal: 0, endless: true, coins: 20,
      spawnSec: [6, 9], patienceSec: [24, 32], openTables: 3, closedTables: 2 },
    rush: { name: 'Rush service', daySec: 180, goal: 0, endless: true, coins: 30,
      spawnSec: [4, 6], patienceSec: [18, 26], maxQueue: 5, openTables: 4, closedTables: 2 }
  };

  function practiceCfg(difficulty, seed) {
    var d = PRACTICE[difficulty] || PRACTICE.normal;
    return {
      id: 'practice-' + difficulty, version: CONTENT_VERSION, kind: 'practice',
      name: d.name, seed: (seed == null ? 1 : seed) >>> 0,
      daySec: d.daySec, goal: d.goal, coins: d.coins,
      grid: { w: 11, h: 7 }, openTables: d.openTables, closedTables: d.closedTables, stoves: 1,
      spawnSec: d.spawnSec, patienceSec: d.patienceSec, maxQueue: d.maxQueue || 3,
      price: 8, tipMax: 6, startCapacity: 2, maxCapacity: 5, maxHelpers: 3,
      maxStoves: 3, expandSize: 2, costs: DEFAULT_COSTS,
      mechanics: allMechanics(), ranked: false, endless: d.endless, par: { score: 0 }
    };
  }

  // ---------- daily (one shared seed + ruleset per UTC day) ----------

  function dailyCfg(dateStr) { // 'YYYY-MM-DD' (UTC)
    var seed = RNG.hashString('bistro-daily-' + dateStr);
    var rng = RNG.derive(seed, RNG.STREAM_RULES);
    var openTables = 4 + rng.int(2);          // 4–5
    var spawnLo = 4 + rng.int(2);             // 4–5
    var spawnHi = spawnLo + 2 + rng.int(2);   // +2..3
    var patLo = 18 + rng.int(5);              // 18–22
    var daySec = 150;
    var avgSpawn = (spawnLo + spawnHi) / 2;
    var guests = Math.floor(daySec / avgSpawn);
    var goal = Math.round(guests * (8 + 3) * (0.55 + rng.next() * 0.15) / 5) * 5;
    return {
      id: 'daily-' + dateStr, version: CONTENT_VERSION, kind: 'daily',
      name: 'Daily ' + dateStr, seed: seed, date: dateStr,
      daySec: daySec, goal: goal, coins: 30,
      grid: { w: 11, h: 7 }, openTables: openTables, closedTables: 2, stoves: 1,
      spawnSec: [spawnLo, spawnHi], patienceSec: [patLo, patLo + 8],
      maxQueue: 4, price: 8, tipMax: 6, startCapacity: 2, maxCapacity: 5,
      maxHelpers: 3, maxStoves: 3, expandSize: 2, costs: DEFAULT_COSTS,
      mechanics: allMechanics(), ranked: true, endless: false,
      par: { score: Math.round(goal * 1.25) }
    };
  }

  // Deterministic local comparison board ("house regulars") for a config.
  var RIVAL_NAMES = ['Marlow', 'Petra', 'Sunil', 'Aoife', 'Dario', 'Wren', 'Kazuo', 'Belén'];
  function rivalScores(cfg) {
    var rng = RNG.derive((cfg.seed >>> 0) ^ 0x5bd1e995, RNG.STREAM_DECOR);
    var base = cfg.goal > 0 ? cfg.goal : 150;
    var out = [];
    for (var i = 0; i < 5; i++) {
      out.push({
        name: RIVAL_NAMES[rng.int(RIVAL_NAMES.length)],
        score: Math.max(10, Math.round(base * (0.6 + rng.next() * 0.9)))
      });
    }
    return out;
  }

  // ---------- themes (five visual palettes; cosmetic only) ----------

  var THEMES = {
    ember: {
      name: 'Ember', accent: '#e8a54b', css: '#e8a54b',
      floor: 0x4a3527, floorAlt: 0x54402f, wall: 0x2e2018, table: 0x8a5a34,
      wood: 0x6b452a, cloth: 0xa33b2e, metal: 0x8f9096, glow: 0xffb35c
    },
    mint: {
      name: 'Mint', accent: '#6fd6a8', css: '#6fd6a8',
      floor: 0x2f4a42, floorAlt: 0x38564d, wall: 0x1e302b, table: 0x5f8a6e,
      wood: 0x47705c, cloth: 0x2e6e5c, metal: 0x9aa5a0, glow: 0xa8f0cd
    },
    noir: {
      name: 'Noir', accent: '#9aa7ff', css: '#9aa7ff',
      floor: 0x2b2b33, floorAlt: 0x34343d, wall: 0x1a1a20, table: 0x4d4d5c,
      wood: 0x3d3d47, cloth: 0x5c2e4d, metal: 0x7d7d8a, glow: 0xbdc7ff
    },
    sunset: {
      name: 'Sunset', accent: '#ff8a6b', css: '#ff8a6b',
      floor: 0x54343a, floorAlt: 0x613e44, wall: 0x33222a, table: 0x8a5a48,
      wood: 0x6e463c, cloth: 0xb3503e, metal: 0x96898a, glow: 0xffb08a
    },
    frost: {
      name: 'Frost', accent: '#7ec8e8', css: '#7ec8e8',
      floor: 0x36444f, floorAlt: 0x40505c, wall: 0x232e36, table: 0x5c7484,
      wood: 0x4a5e6c, cloth: 0x3e6e8a, metal: 0x9aa5ad, glow: 0xbfe4f5
    }
  };

  // ---------- offline validators ----------

  // Basic legality, reachable goals, bounded duration, no soft locks.
  function validateCfg(cfg) {
    var errors = [];
    if (!cfg.id || !cfg.kind) errors.push('missing id/kind');
    if (!(cfg.seed >>> 0) && cfg.seed !== 0) errors.push('bad seed');
    if (!cfg.grid || cfg.grid.w < 7 || cfg.grid.h < 5) errors.push('grid too small');
    if (cfg.openTables < 1) errors.push('no open tables: soft lock');
    if (cfg.stoves < 1) errors.push('no stoves: soft lock');
    var spots = Math.floor((cfg.grid.w - 2) / 2) * Math.max(1, Math.floor((cfg.grid.h - 2) / 2));
    if (cfg.openTables + cfg.closedTables > spots) errors.push('too many tables for grid');
    if (cfg.daySec < 30 || cfg.daySec > 900) errors.push('unbounded/absurd duration');
    if (cfg.goal > 0) {
      var avgSpawn = (cfg.spawnSec[0] + cfg.spawnSec[1]) / 2;
      var maxGuests = cfg.daySec / avgSpawn + (cfg.setup && cfg.setup.seated ? cfg.setup.seated.length : 0);
      var maxEarn = maxGuests * (cfg.price + cfg.tipMax);
      if (cfg.goal > maxEarn * 0.85) errors.push('goal likely unreachable (' + cfg.goal + ' vs ceiling ' + Math.round(maxEarn) + ')');
    }
    ['capacity', 'helper', 'stove', 'expand'].forEach(function (k) {
      if (!Array.isArray(cfg.costs[k])) errors.push('missing costs.' + k);
    });
    return errors;
  }

  function validateAll() {
    var report = {};
    buildJourney().forEach(function (cfg) { report[cfg.id] = validateCfg(cfg); });
    CHALLENGES.forEach(function (cfg) { report[cfg.id] = validateCfg(cfg); });
    LESSONS.forEach(function (l) { report[l.cfg.id] = validateCfg(l.cfg); });
    ['calm', 'normal', 'rush'].forEach(function (d) {
      report['practice-' + d] = validateCfg(practiceCfg(d, 1));
    });
    report['daily-sample'] = validateCfg(dailyCfg('2026-01-15'));
    return report;
  }

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    DEFAULT_COSTS: DEFAULT_COSTS,
    JOURNEY: buildJourney(),
    LESSONS: LESSONS,
    CHALLENGES: CHALLENGES,
    PRACTICE: PRACTICE,
    THEMES: THEMES,
    practiceCfg: practiceCfg,
    dailyCfg: dailyCfg,
    rivalScores: rivalScores,
    validateCfg: validateCfg,
    validateAll: validateAll
  };
});
