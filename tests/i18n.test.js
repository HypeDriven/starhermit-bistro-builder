// i18n.test.js — every string the engine client (native/*.ts) shows exists in
// the nine StarHermit locales (js/i18n.js) with the placeholders of US
// English: the keys its code names, the keys it builds (refusal reasons,
// captions, modes, upgrades, content names, lesson steps, achievements) and
// every key of the US English table.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../js/i18n.js');
const C = require('../js/content.js');
const S = require('../js/store.js');
const R = require('../js/rules.js');

const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const dir = path.join(__dirname, '..', 'native');
const code = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const used = new Set();
for (const m of code.matchAll(/\btx?\("([A-Za-z0-9.\-]+)"(?!\s*\+)/g)) used.add(m[1]);
// keys built from data
for (const r of Object.values(R.INVALID)) used.add('inv.' + r);
used.add('inv.not-active');
for (const c of ['cmd', 'spawn', 'dish-ready', 'pickup', 'serve', 'leave-angry', 'buy', 'invalid', 'win', 'lose', 'undo', 'hint', 'service-start', 'expand', 'urgent', 'hire']) used.add('cap.' + c);
for (const m of ['learn', 'journey', 'daily', 'practice', 'challenge']) { used.add('mode.' + m); used.add('mode.' + m + '.d'); used.add('mode.' + m + '.dur'); }
for (const i of ['capacity', 'helper', 'stove', 'expand']) used.add('buy.' + i);
for (const k of ['hint.urgent', 'hint.waiting', 'hint.pickup', 'hint.cooking', 'hint.upgrade', 'hint.idle']) used.add(k);
for (const c of C.JOURNEY) used.add('j.' + c.id);
for (const c of C.CHALLENGES) { const id = c.id.replace(/^challenge-/, ''); used.add('ch.' + id); used.add('chd.' + id); }
for (const l of C.LESSONS) { used.add('l.' + l.id); used.add('lx.' + l.id); l.steps.forEach((_, i) => used.add('ls.' + l.id + '.' + i)); }
for (const d of Object.keys(C.PRACTICE)) used.add('pd.' + d);
for (const k of Object.keys(C.THEMES)) used.add('theme.' + k);
for (const a of S.ACHIEVEMENTS) { used.add('ach.' + a.key); used.add('ach.' + a.key + '.d'); }
for (const k of ['speed.1', 'speed.2', 'pal.standard', 'pal.hv']) used.add(k);
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine StarHermit locales', () => assert.deepEqual(I.LOCALES, LOCALES));
test('found the keys in code', () => assert.ok(used.size > 250, String(used.size)));
test('every key the code names is in US English', () => {
  assert.deepEqual([...used].filter((k) => typeof I.STRINGS['en-US'][k] !== 'string'), []);
});
for (const loc of LOCALES) {
  test(`${loc}: every used and every US English key, matching placeholders`, () => {
    const T = I.STRINGS[loc];
    const keys = new Set([...used, ...Object.keys(I.STRINGS['en-US'])]);
    assert.deepEqual([...keys].filter((k) => typeof T[k] !== 'string' || !T[k]), []);
    for (const k of keys) assert.equal(vars(T[k]), vars(I.STRINGS['en-US'][k]), `${loc}.${k}`);
  });
}
test('content names in US English are the authored data', () => {
  const en = I.STRINGS['en-US'];
  for (const c of C.JOURNEY) assert.equal(en['j.' + c.id], c.name);
  for (const a of S.ACHIEVEMENTS) assert.equal(en['ach.' + a.key], a.name);
});
test('the non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => I.STRINGS[loc][k] === I.STRINGS['en-US'][k] && !/^(j|ch|theme)\./.test(k));
    assert.ok(same.length < 25, `${loc}: ${same.join(', ')}`);
  }
});
test('setLocale switches and falls back to US English', () => {
  I.setLocale('de-DE');
  assert.equal(I.lang, 'de-DE');
  assert.equal(I.t('acct.signIn'), 'Mit StarHermit anmelden');
  I.setLocale('xx-YY');
  assert.equal(I.lang, 'en-US');
  assert.equal(I.t('obj.goal', { earned: 3, goal: 60 }), '3 / 60 coins');
});
