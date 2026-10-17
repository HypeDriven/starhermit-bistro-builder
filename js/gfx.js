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

// StarHermit hardware level (0–20, gpu-level.js) at which Auto starts choosing each preset.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

// Per-preset asset and effect budgets, each tuned to hold 60 FPS on the weakest GPU Auto gives the
// preset (Low: level 0 phones / Intel UHD; Balanced: level 4 Iris Xe; High: level 10 GTX 1070;
// Ultra: level 17 RTX 4080). Gameplay is identical on every preset.
//   maxDpr    — device-pixel-ratio cap
//   material  — 'lambert' (Lambert surfaces, Phong gloss), 'standard' (PBR, no clearcoat) or
//               'physical' (clearcoat table tops, plates and counter)
//   segments  — multiplier on every curved mesh's segment counts (guests, tables, plates, stove, lamps)
//   texture   — multiplier on the procedural tile / wood / plaster / street texture sizes
//   steam     — steam puffs per stove with Particles: high (Particles: low keeps one), scaled by level
//   bloomRes  — bloom resolution as a fraction of the canvas
export const BUDGETS = {
  low: { maxDpr: 1, material: 'lambert', segments: 0.5, texture: 0.5, steam: 2, bloomRes: 0.5 },
  balanced: { maxDpr: 1.5, material: 'standard', segments: 0.75, texture: 1, steam: 3, bloomRes: 0.5 },
  high: { maxDpr: 2, material: 'physical', segments: 1, texture: 1, steam: 6, bloomRes: 0.75 },
  ultra: { maxDpr: 2, material: 'physical', segments: 1.5, texture: 2, steam: 10, bloomRes: 1 }
};

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for a renderer string (system: detectSystem() fields, e.g. { mobile }). */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  return G ? G.detectLevel(Object.assign({ webgl: true, webgl2: true }, system || {}, { gpu: String(gpu || '') })) : 0;
}

/** Auto preset for a hardware level: Low 0, Balanced 4, High 10, Ultra 17. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : (PRESETS.filter(p => LEVELS[p] <= level).pop() || 'low');
}

/** Best preset for this GPU (hardware level → preset); `mobile` caps it at Balanced. */
export function detectPreset(gpu, mobile) {
  return presetForLevel(detectLevel(gpu, { mobile: !!mobile }));
}

/** The preset's budget; steam puffs scale by the hardware level within the preset (≤ 2×). */
export function budget(preset, level) {
  const b = BUDGETS[preset] || BUDGETS.balanced;
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Number.isFinite(level) ? level : floor;
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  return Object.assign({}, b, { steam: Math.max(1, Math.round(b.steam * k)) });
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = { preset, auto, userScale: clampScale(s.render_scale), scale: 0 };
  out.scale = row.scale * out.userScale;
  for (const cat of Object.keys(CATEGORIES)) {
    out[cat] = CATEGORIES[cat].includes(s[cat]) ? s[cat] : row[cat];
  }
  out.budget = budget(preset, level);
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
