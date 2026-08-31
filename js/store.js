/* Bistro Builder — persistence: versioned, checksummed local save document.
 * Never stores credentials or tokens. Browser global: window.BBStore.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAVE_VERSION = 1;
  var KEY = 'bistrobuilder.save.v1';
  var LB_KEY = 'bistrobuilder.leaderboards.v1';

  var DEFAULT_SETTINGS = {
    music: 0.5, effects: 0.9, ambience: 0.5, voice: 0.8,
    muted: false, captions: false,
    graphicsTier: 'auto',       // auto | low | medium | high
    theme: 'ember',
    reducedMotion: false,
    highContrast: false,
    colorPalette: 'standard',   // standard | high-visibility
    largeText: false,
    leftHanded: false,
    haptics: true,
    boardMirror: false,         // always-visible DOM station panel
    speed: 1                    // 1 | 2 — fast-forward settles the same end state
  };

  function defaultProgress() {
    return {
      tutorialDone: {},        // lessonId -> true
      journeyStars: {},        // stageId -> 0..3
      journeyBest: {},         // stageId -> score
      challengeBest: {},       // challengeId -> score
      dailiesDone: {},         // dateStr -> score
      practiceBest: {},        // difficulty -> score
      achievements: {},        // key -> unlockedAtMs
      stats: { rounds: 0, wins: 0, served: 0, lost: 0, hires: 0,
               expansions: 0, bestScore: 0, playMs: 0, dailyStreak: 0, lastDaily: '' },
      cosmetics: { theme: 'ember' }
    };
  }

  function checksum(str) { // FNV-1a, decimal string
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function migrate(doc) {
    // v1 is current; older shapes are upgraded field-by-field here.
    if (!doc || typeof doc !== 'object') return null;
    if (doc.v > SAVE_VERSION) return null; // future format: don't clobber
    doc.v = SAVE_VERSION;
    doc.settings = Object.assign({}, DEFAULT_SETTINGS, doc.settings || {});
    doc.progress = Object.assign(defaultProgress(), doc.progress || {});
    return doc;
  }

  function fresh() {
    return { v: SAVE_VERSION, settings: Object.assign({}, DEFAULT_SETTINGS), progress: defaultProgress() };
  }

  var memoryFallback = null; // used when localStorage is unavailable

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (raw == null && memoryFallback) raw = memoryFallback;
    if (raw == null) return fresh();
    try {
      var doc = JSON.parse(raw);
      if (!doc || doc.sum !== checksum(doc.payload)) return fresh(); // corrupt → clean slate
      var migrated = migrate(JSON.parse(doc.payload));
      return migrated || fresh();
    } catch (e) { return fresh(); }
  }

  function save(doc) {
    doc.v = SAVE_VERSION;
    var payload = JSON.stringify(doc);
    var wrapped = JSON.stringify({ sum: checksum(payload), payload: payload });
    memoryFallback = wrapped;
    try { localStorage.setItem(KEY, wrapped); } catch (e) { /* memory fallback keeps session */ }
  }

  // ---------- leaderboards (local; host adapter may sync) ----------
  function loadBoards() {
    try {
      var raw = localStorage.getItem(LB_KEY);
      return raw ? JSON.parse(raw) : { entries: [] };
    } catch (e) { return { entries: [] }; }
  }
  function saveBoards(b) {
    try { localStorage.setItem(LB_KEY, JSON.stringify(b)); } catch (e) {}
  }

  // Ties: higher score, then fewer invalid actions, then lower elapsed,
  // then stable session id. Returns sorted copy.
  function sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if ((a.invalid || 0) !== (b.invalid || 0)) return (a.invalid || 0) - (b.invalid || 0);
      if ((a.durationMs || 0) !== (b.durationMs || 0)) return (a.durationMs || 0) - (b.durationMs || 0);
      return String(a.sessionId).localeCompare(String(b.sessionId));
    });
  }

  // ---------- achievements (stable lowercase keys, idempotent unlocks) ----------
  var ACHIEVEMENTS = [
    { key: 'first-service', name: 'First Service', desc: 'Complete your first day of service.' },
    { key: 'full-house', name: 'Full House', desc: 'Finish a day without losing a single guest (8+ served).' },
    { key: 'century', name: 'Century', desc: 'Serve 100 guests in total.' },
    { key: 'crew-chief', name: 'Crew Chief', desc: 'Hire 5 helper waiters in total.' },
    { key: 'mastery-row', name: 'Mastery Row', desc: 'Complete every fifth (mastery) journey stage.' },
    { key: 'regular', name: 'Regular', desc: 'Complete daily challenges on 3 different days.' }
  ];

  return {
    SAVE_VERSION: SAVE_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    load: load, save: save, fresh: fresh, migrate: migrate,
    checksum: checksum,
    loadBoards: loadBoards, saveBoards: saveBoards, sortEntries: sortEntries
  };
});
