// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, the event table of sfx/manifest.txt) on the runtime's
// mixer with the seeded pitch variants, the bistro room-tone loop with its
// seeded-random soft clinks, and the warm generative pad walking C–Dm–G/B–Am
// every 4.8 s. Every event also emits a caption (onCaption).
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music → "music", effects and
// ambience → "effects", the countdown tap → "interface". The old default
// bus levels (music 50 %, effects 90 %, ambience 50 %) are folded into each
// sound's gain.
//
// The browser build made the pad, the clinks and the stand-in room tone with
// Web Audio nodes; here the pad chords and the clinks are rendered once into
// clips (createClip) with the same shapes, the room tone is the authored clip
// looped whole (streaming it with the old loop points made headless Chrome's
// mixer warn that a stream's turn failed), and the synthesized stand-ins it played
// while a sample loaded are not ported: the engine's browser runtime drops
// clip loads and plays while a synthesis graph changes (the arrow-exodus
// port's finding). Clips load once the mixer runs (natively at once, in a
// browser after the first press).
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
import type { RngStream } from "./classic.ts";

const LEVEL = { music: 0.5, effects: 0.9, ambience: 0.5 };
// Event → clip basename (sfx/manifest.json).
const SAMPLES: Record<string, string> = {
  ui: "ui-tap", cmd: "order-noted", spawn: "guest-arrive", seat: "chair-scrape", "dish-ready": "dish-ready-bell",
  pickup: "tray-pickup", serve: "plate-serve", "leave-angry": "door-slam", "leave-happy": "guest-thanks",
  buy: "cash-register", invalid: "error-buzz", win: "day-complete-fanfare", lose: "day-missed", undo: "rewind-swoosh",
  hint: "hint-sparkle", "service-start": "service-open-bell", expand: "wall-knock", urgent: "patience-tick", hire: "helper-hired",
};
/** Events with a seeded ±6 % pitch variant (replay-consistent takes). */
const VARIANT = new Set(["cmd", "spawn", "pickup", "serve", "leave-happy"]);
/** Events with a caption (the browser build's CAPTIONS). */
const CAPTIONED = new Set(["cmd", "spawn", "dish-ready", "pickup", "serve", "leave-angry", "buy", "invalid", "win", "lose", "undo", "hint", "service-start", "expand", "urgent", "hire"]);

const clips = new Map<string, AudioClip>();
let onCaption: ((event: string) => void) | null = null;
let avRng: RngStream | null = null;
let wantClips = false;

function load(name: string): void {
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
export function setOnCaption(cb: (event: string) => void): void { onCaption = cb; }
export function setAvRng(rng: RngStream): void { avRng = rng; }

/** Plays an event's clip and emits its caption. */
export function play(name: string): void {
  if (CAPTIONED.has(name) && onCaption) onCaption(name);
  const file = SAMPLES[name];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  const bus: Bus = name === "ui" ? "interface" : "effects";
  const pitch = VARIANT.has(name) ? 0.94 + (avRng ? avRng.next() : Math.random()) * 0.12 : 1;
  try { playClip(clip, { bus, gain: LEVEL.effects, pitch }); }
  catch { clips.delete(file!); load(file!); } // a clip the mixer lost: load it again
}

// -- rendered beds ------------------------------------------------------------------------
const RATE = 11025;
/** RBJ biquad lowpass over `x` in place (Web Audio's BiquadFilterNode, Q ≈ 0.707). */
function lowpass(x: Float32Array, freq: number, q = Math.SQRT1_2): void {
  const w = (2 * Math.PI * freq) / RATE, alpha = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}
const CHORDS = [
  [261.63, 329.63, 392.0], // C E G
  [293.66, 349.23, 440.0], // D F A
  [246.94, 293.66, 392.0], // B D G
  [220.0, 261.63, 329.63], // A C E
];
/** One pad chord: a triangle root and two sines an octave down, lowpassed at
 * 650 Hz, rising to 0.045 over 1.6 s and falling to silence by 5.8 s. */
function chordClip(chord: number[]): AudioClip {
  const n = Math.round(6 * RATE);
  const out = new Float32Array(n);
  chord.forEach((freq, v) => {
    const f = freq * 0.5;
    const voice = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ph = (f * i / RATE) % 1;
      voice[i] = v === 0 ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(2 * Math.PI * ph);
    }
    lowpass(voice, 650);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env = t < 1.6 ? 0.045 * (t / 1.6) : t < 5.8 ? 0.045 + (0.0001 - 0.045) * ((t - 1.6) / 4.2) : 0;
      out[i]! += voice[i]! * env;
    }
  });
  return createClip([out], RATE);
}
/** A soft clink: a sine pinged to 0.02 in 5 ms, gone in 0.12 s. */
function clinkClip(freq: number): AudioClip {
  const n = Math.round(0.15 * RATE * 4);
  const rate = RATE * 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = t < 0.005 ? 0.02 * (t / 0.005) : 0.02 * Math.pow(0.0001 / 0.02, Math.min(1, (t - 0.005) / 0.115));
    out[i] = Math.sin(2 * Math.PI * freq * t) * env;
  }
  return createClip([out], rate);
}

let started = false;
let paused = false;
let ambience: Sound | null = null;
let ambienceClip: AudioClip | null = null;
const chords: AudioClip[] = [];
const clinks: AudioClip[] = [];
let chordIdx = 0;
let nextChord = 0;
let nextClink = 0;

/** The beds start with the first service (the browser build's BBAudio.start). */
export function start(): void { started = true; }
/** Pause: the beds hold (the browser build suspended its context). */
export function setPaused(on: boolean): void {
  paused = on;
  if (!ambience) return;
  try { ambience.fade(on ? 0 : 0.9 * LEVEL.ambience, 0.3); } catch { ambience = null; }
}

/** Each frame: what waited for the mixer, one rendered clip a frame, then
 * the pad's next chord every 4.8 s and a clink every 2.5–7.5 s of mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const name of new Set(Object.values(SAMPLES))) load(name);
    loadClip("sfx/bistro-ambience.opus").then((c) => { ambienceClip = c; }, (e: unknown) => console.warn(`ambience: ${String(e)}`));
    return;
  }
  if (!started) return;
  try {
    if (chords.length < CHORDS.length) { chords.push(chordClip(CHORDS[chords.length]!)); return; }
    if (clinks.length < 3) { clinks.push(clinkClip(2000 + clinks.length * 600)); return; }
    if (!ambience && ambienceClip) {
      // The authored 10 s room tone on the ambience level.
      ambience = playClip(ambienceClip, { bus: "effects", gain: paused ? 0 : 0.9 * LEVEL.ambience, loop: true });
      return;
    }
  } catch (e) { console.warn(`beds: ${String(e)}`); started = false; return; }
  if (paused) return;
  const now = context.currentTime;
  if (now >= nextChord) {
    nextChord = now + 4.8;
    try { playClip(chords[chordIdx++ % chords.length]!, { bus: "music", gain: LEVEL.music }); } catch { /* the mixer is full */ }
  }
  if (now >= nextClink) {
    const first = nextClink === 0;
    nextClink = now + (first ? 2 : 2.5 + Math.random() * 5);
    if (!first) {
      try { playClip(clinks[Math.floor(Math.random() * clinks.length)]!, { bus: "effects", gain: LEVEL.ambience, pitch: 0.9 + Math.random() * 0.6 }); } catch { /* full */ }
    }
  }
}
