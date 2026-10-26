// migrate.test.js — the engine save document and what the browser build left
// in the player's account (js/migrate.js): the foreign cloud save (the SDK's
// checksummed { sum, payload } document) read and merged, the engine save's
// conflict merge, and the per-player settings kept or dropped. The signed-in
// paths cannot run here (no account), so their logic is covered by these.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/store.js');
const M = require('../js/migrate.js');

/** The browser build's cloud save text: S.save's wrapped string. */
function browserSave(doc) {
  const payload = JSON.stringify(doc);
  return JSON.stringify({ sum: S.checksum(payload), payload });
}
const plain = (o) => JSON.parse(JSON.stringify(o));

test('the browser build\'s cloud save reads back whole', () => {
  const doc = S.fresh();
  doc.progress.journeyStars.j01 = 3;
  doc.progress.stats.served = 42;
  doc.settings.theme = 'noir';
  doc.settings.music = 0.2;
  const back = M.docFromBrowserSave(browserSave(doc));
  assert.equal(back.progress.journeyStars.j01, 3);
  assert.equal(back.progress.stats.served, 42);
  assert.equal(back.settings.theme, 'noir');
});
test('a corrupt or future browser save is refused', () => {
  assert.equal(M.docFromBrowserSave('not json'), null);
  assert.equal(M.docFromBrowserSave(JSON.stringify({ sum: 'x', payload: '{}' })), null);
  assert.equal(M.docFromBrowserSave(browserSave({ v: 99, progress: {} })), null);
  assert.equal(M.docFromBrowserSave(null), null);
});
test('the engine save document round-trips its progress', () => {
  const p = S.fresh().progress;
  p.dailiesDone['2026-10-01'] = 120;
  const doc = plain(M.saveDoc(p));
  assert.equal(doc.v, 1);
  assert.equal(M.progressFromSave(doc).dailiesDone['2026-10-01'], 120);
  assert.equal(M.progressFromSave({ v: 2, progress: p }), null);
  assert.equal(M.progressFromSave(null), null);
  assert.equal(M.progressFromSave({ v: 1, progress: [] }), null);
});
test('two devices\' progress merges: better records, every achievement at its earliest', () => {
  const a = S.fresh().progress, b = S.fresh().progress;
  a.journeyStars = { j01: 3, j02: 1 }; b.journeyStars = { j02: 2, j03: 1 };
  a.challengeBest = { 'challenge-frugal': 80 }; b.challengeBest = { 'challenge-frugal': 95 };
  a.tutorialDone = { serve: true }; b.tutorialDone = { pickup: true };
  a.stats.rounds = 7; b.stats.rounds = 4; a.stats.lastDaily = '2026-10-15'; b.stats.lastDaily = '2026-10-12';
  a.achievements = { century: 200 }; b.achievements = { century: 100, regular: 300 };
  const m = plain(M.mergeProgress(a, b));
  assert.deepEqual(m.journeyStars, { j01: 3, j02: 2, j03: 1 });
  assert.equal(m.challengeBest['challenge-frugal'], 95);
  assert.deepEqual(m.tutorialDone, { serve: true, pickup: true });
  assert.equal(m.stats.rounds, 7);
  assert.equal(m.stats.lastDaily, '2026-10-15');
  assert.deepEqual(m.achievements, { century: 100, regular: 300 });
  assert.deepEqual(plain(M.mergeProgress(null, null)), plain(S.fresh().progress));
  assert.equal(M.mergeProgress(a, null).journeyStars.j01, 3);
});
test('the browser build\'s settings: the game\'s own options carry over, the runtime\'s are dropped', () => {
  assert.equal(M.migrateSetting('captions', true), true);
  assert.equal(M.migrateSetting('theme', 'frost'), 'frost');
  assert.equal(M.migrateSetting('theme', 'plaid'), undefined);
  assert.equal(M.migrateSetting('colorPalette', 'high-visibility'), 'high-visibility');
  assert.equal(M.migrateSetting('speed', '2'), 2);
  assert.equal(M.migrateSetting('speed', 3), undefined);
  assert.equal(M.migrateSetting('boardMirror', 1), undefined);
  for (const k of ['music', 'effects', 'ambience', 'voice', 'muted', 'gfx', 'reducedMotion', 'highContrast', 'largeText', 'ui.language']) {
    assert.ok(M.BROWSER_SETTING_KEYS.includes(k), k);
    assert.equal(M.migrateSetting(k, 0.5), undefined, k);
  }
  assert.deepEqual(M.GAME_SETTING_KEYS, ['captions', 'theme', 'colorPalette', 'leftHanded', 'haptics', 'boardMirror', 'speed']);
  for (const k of M.GAME_SETTING_KEYS) assert.notEqual(M.migrateSetting(k, S.DEFAULT_SETTINGS[k]), undefined, k);
});
