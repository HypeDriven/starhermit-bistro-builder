// Unit tests for the graphics quality model (js/gfx.js) and its save migration.
// Run: node --test tests/gfx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PRESETS, CATEGORIES, detectPreset, resolve, presetTier, choosePreset, setOverride, describe, clampScale } from '../js/gfx.js';
import { LOCALES, strings, pickLocale } from '../js/gfx-strings.js';

const require = createRequire(import.meta.url);
const S = require('../js/store.js');

test('detectPreset: software renderers → low, discrete/Apple M → high, others → balanced', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('llvmpipe, or similar'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset: touch/mobile caps Auto at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('llvmpipe', true), 'low');
});

test('resolve: auto uses the detected preset; explicit preset wins', () => {
  const a = resolve({ preset: 'auto' }, 'low');
  assert.equal(a.preset, 'low'); assert.equal(a.auto, true);
  assert.equal(a.shadows, 'off'); assert.equal(a.post, false);
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high'); assert.equal(h.auto, false);
  assert.equal(h.shadows, 'medium'); assert.equal(h.ao, 'on'); assert.equal(h.post, true);
  assert.equal(resolve({}, undefined).preset, 'balanced');
});

test('resolve: per-category overrides apply, invalid tiers fall back to the preset', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'high', ao: 'bogus' }, 'low');
  assert.equal(r.bloom, 'on'); assert.equal(r.shadows, 'high'); assert.equal(r.ao, 'off');
  assert.equal(r.post, true); // bloom needs the post chain
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }).scale, 1);
  assert.equal(clampScale(1.5), 1.5);
});

test('resolve: adaptive defaults on, show_fps defaults off', () => {
  const r = resolve({}, 'low');
  assert.equal(r.adaptive, true); assert.equal(r.showFps, false);
  const r2 = resolve({ adaptive: false, show_fps: true }, 'low');
  assert.equal(r2.adaptive, false); assert.equal(r2.showFps, true);
});

test('choosePreset clears overrides but keeps scale/adaptive/fps', () => {
  const saved = { preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, show_fps: true };
  const next = choosePreset(saved, 'ultra');
  assert.equal(next.preset, 'ultra');
  for (const cat of Object.keys(CATEGORIES)) assert.equal(next[cat], undefined, cat);
  assert.equal(next.render_scale, 1.5); assert.equal(next.show_fps, true);
  assert.equal(choosePreset(saved, 'nonsense').preset, 'auto');
});

test('setOverride sets and clears one category', () => {
  const a = setOverride({ preset: 'high' }, 'shadows', 'off');
  assert.equal(resolve(a).shadows, 'off');
  const b = setOverride(a, 'shadows', 'preset');
  assert.equal(b.shadows, undefined);
  assert.equal(resolve(b).shadows, 'medium');
});

test('presetTier and describe', () => {
  for (const p of PRESETS) for (const c of Object.keys(CATEGORIES)) assert.ok(CATEGORIES[c].includes(presetTier(p, c)), p + '/' + c);
  const d = describe(resolve({ preset: 'high' }), [1280, 720]);
  assert.match(d, /2048² shadows/); assert.match(d, /SMAA/); assert.match(d, /1280×720 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('Low preset is no costlier than the pre-upgrade renderer (no shadows, no post)', () => {
  const r = resolve({ preset: 'low' });
  assert.equal(r.shadows, 'off'); assert.equal(r.post, false); assert.ok(r.scale <= 1);
});

test('graphics strings exist for every required locale and key', () => {
  for (const l of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) assert.ok(LOCALES.includes(l), l);
  const en = strings('en-US');
  for (const l of LOCALES) {
    const s = strings(l);
    for (const k of Object.keys(en)) assert.ok(s[k] != null, l + '.' + k);
    for (const c of Object.keys(CATEGORIES)) assert.ok(s.cat[c], l + '.cat.' + c);
    for (const c of Object.keys(CATEGORIES)) for (const t of CATEGORIES[c]) assert.ok(s.tier[t], l + '.tier.' + t);
    for (const p of PRESETS) assert.ok(s.preset[p], l + '.preset.' + p);
  }
  assert.equal(pickLocale('es-MX'), 'es-419'); assert.equal(pickLocale('es-ES'), 'es-ES');
  assert.equal(pickLocale('fr-ca'), 'fr-CA'); assert.equal(pickLocale('en-AU'), 'en-GB'); assert.equal(pickLocale('ja-JP'), 'en-US');
});

test('save: gfx defaults are per-document and legacy graphicsTier migrates to a preset', () => {
  const a = S.fresh(), b = S.fresh();
  a.settings.gfx.preset = 'ultra';
  assert.equal(b.settings.gfx.preset, 'auto');
  assert.equal(S.DEFAULT_SETTINGS.gfx.preset, 'auto');
  const m = S.migrate({ v: 1, settings: { graphicsTier: 'medium' } });
  assert.equal(m.settings.gfx.preset, 'balanced');
  assert.equal(m.settings.graphicsTier, undefined);
  const k = S.migrate({ v: 1, settings: { gfx: { preset: 'low', bloom: 'on' } } });
  assert.equal(k.settings.gfx.bloom, 'on'); assert.equal(k.settings.gfx.adaptive, true);
});
