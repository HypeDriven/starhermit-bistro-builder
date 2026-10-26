// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the steam puffs scaled within the tier by the level (frame().levelIndex),
// as the browser build scaled them by its hardware level (at most 2×). The
// runtime owns the rest of what the old Graphics panel did: Auto and the
// level choice, render scale and the pixel-ratio cap, adaptive resolution,
// the frame-rate limit and readout, and the shadow-map size and MSAA samples
// it holds to the level.
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lambert surfaces with Lambert gloss, standard PBR, or clearcoat physical tops, plates and counter. */
  material: "lambert" | "standard" | "physical";
  /** Multiplier on every curved mesh's segment counts (never below 3). */
  segments: number;
  /** Multiplier on the procedural tile / wood / plaster / street texture sizes. */
  texture: number;
  /** Steam puffs per cooking stove with particles high. */
  steam: number;
  /** Bloom resolution as a fraction of the frame. */
  bloomRes: number;
}
export interface Look {
  preset: Preset;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based lighting (reflections on metal, trays and glossy pieces). */
  reflections: boolean;
  /** Stove steam: one bobbing puff (low) or rising, swelling puffs (high). */
  particles: "low" | "high";
  /** Procedural textures, cap rails, stone counter slab, candles, festoon, street. */
  detailed: boolean;
  /** Candle, bulb and burner flicker and the guests' idle bob. */
  animated: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "low", detailed: false, animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "low", detailed: true, animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true, animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true, animated: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", segments: 0.5, texture: 0.5, steam: 2, bloomRes: 0.5 },
  balanced: { material: "standard", segments: 0.75, texture: 1, steam: 3, bloomRes: 0.5 },
  high: { material: "physical", segments: 1, texture: 1, steam: 6, bloomRes: 0.75 },
  ultra: { material: "physical", segments: 1.5, texture: 2, steam: 10, bloomRes: 1 },
};
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: the steam grows with the
  // level above the tier's first, at most twice the tier's budget.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.steam = Math.max(1, Math.round(b.steam * k));
  return { preset, ...TABLE[preset], budget: b };
}
