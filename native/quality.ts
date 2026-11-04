// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, segments, textures, reflections, steam, detail,
// flicker) is the browser build's four presets and budgets (js/gfx.js TABLE /
// BUDGETS, each tuned to hold 60 FPS on the weakest GPU Auto gave it) keyed
// by the level's quality tier, with the steam puffs scaled within the tier by
// the level's particle budget against the tier's anchor level (quantum,
// molecular, terrestrial, galactic), at most 2×. The runtime owns the rest of
// what the old Graphics panel did: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout.
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: Preset;
  /** Key-light shadow map: the level's size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
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

type Art = Pick<Look, "reflections" | "particles" | "detailed" | "animated">;
const ART: Record<Preset, Art> = {
  low: { reflections: false, particles: "low", detailed: false, animated: false },
  balanced: { reflections: true, particles: "low", detailed: true, animated: true },
  high: { reflections: true, particles: "high", detailed: true, animated: true },
  ultra: { reflections: true, particles: "high", detailed: true, animated: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", segments: 0.5, texture: 0.5, steam: 2 },
  balanced: { material: "standard", segments: 0.75, texture: 1, steam: 3 },
  high: { material: "physical", segments: 1, texture: 1, steam: 6 },
  ultra: { material: "physical", segments: 1.5, texture: 2, steam: 10 },
};
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  // The steam grows with the level's particle budget above the tier's anchor, at most twice the tier's budget.
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.steam = Math.max(1, Math.round(b.steam * k));
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    // Engine issue (1.36.1, reported 2026-11-04; fix due in 1.36.2): antialias "off" recolours fog,
    // haze and translucent overlays, so Low keeps the MSAA it always had until that release.
    antialias: s.antialias === "off" ? "msaa" : s.antialias,
    budget: b,
  };
}
