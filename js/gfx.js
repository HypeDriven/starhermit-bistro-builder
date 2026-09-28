/* Bistro Builder — graphics quality model: presets, per-category overrides,
 * GPU detection and a cost summary. Pure (no three.js, no DOM) so the
 * settings panel, the renderer and the unit tests agree on what a setting
 * means. Modelled on root-and-ruin/web/gfx.js.
 */

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],       // image-based lighting (RoomEnvironment)
  particles: ['low', 'high'],       // stove steam puffs
  detail: ['plain', 'detailed'],    // surface grain, pendant lamps, candles, street
  animation: ['static', 'animated'] // candle flicker, lamp sway, idle bob
};

// Each preset is a row of tiers plus a render scale (multiplies the device pixel ratio).
const TABLE = {
  low: { scale: 0.85, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'low', detail: 'plain', animation: 'static' },
  balanced: { scale: 1, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'low', detail: 'detailed', animation: 'animated' },
  high: { scale: 1, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed', animation: 'animated' },
  ultra: { scale: 1.25, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed', animation: 'animated' }
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

export const DEFAULTS = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };

/** Best preset for this GPU (unmasked renderer string). Touch/mobile devices cap at balanced. */
export function detectPreset(gpu, mobile) {
  const g = String(gpu || '').toLowerCase();
  let p;
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  else p = 'balanced';
  if (mobile && p === 'high') p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = { preset, auto, userScale: clampScale(s.render_scale), scale: 0 };
  out.scale = row.scale * out.userScale;
  for (const cat of Object.keys(CATEGORIES)) {
    out[cat] = CATEGORIES[cat].includes(s[cat]) ? s[cat] : row[cat];
  }
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas renders directly.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
    out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every per-category override (keeps scale/adaptive/fps). */
export function choosePreset(saved, preset) {
  const s = Object.assign({}, DEFAULTS, saved || {});
  for (const cat of Object.keys(CATEGORIES)) delete s[cat];
  s.preset = PRESETS.includes(preset) ? preset : 'auto';
  return s;
}

/** Set (or clear with 'preset') one category override. */
export function setOverride(saved, cat, tier) {
  const s = Object.assign({}, DEFAULTS, saved || {});
  if (!CATEGORIES[cat]) return s;
  if (CATEGORIES[cat].includes(tier)) s[cat] = tier; else delete s[cat];
  return s;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  const row = TABLE[preset];
  return row ? row[cat] : undefined;
}

export function clampScale(v) {
  const n = Number(v);
  return Math.min(2, Math.max(0.5, isFinite(n) && n > 0 ? n : 1));
}

/** Short cost summary. `words` optionally localizes the fragments. */
export function describe(r, pixels, words) {
  const w = Object.assign({
    noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
    bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing'
  }, words || {});
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null
  ];
  return parts.filter(Boolean).join(' · ');
}
