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
// The pad chords and the clinks are rendered once into clips by the engine's
// OfflineAudioContext at start; the room tone is the authored clip looped whole.
// Every clip loads at start (onStart); a cue whose clip is still loading is
// silent (its caption still shows).
import { OfflineAudioContext, SoundBank, context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
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

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SAMPLES))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
  loadClip("sfx/bistro-ambience.opus").then((c) => { ambienceClip = c; }, (e: unknown) => console.warn(`ambience: ${String(e)}`));
  Promise.all(CHORDS.map(renderChord)).then((c) => { chords = c; }, (e: unknown) => console.warn(`pad: ${String(e)}`));
  Promise.all(CLINKS.map(renderClink)).then((clips) => { clinks = new SoundBank({ clips, bus: "effects", gain: LEVEL.ambience, pitch: 1.2, pitchJitter: 0.25 }); }, (e: unknown) => console.warn(`clinks: ${String(e)}`));
}
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
  catch { /* the mixer is full this frame: skip it */ }
}

// -- rendered beds ------------------------------------------------------------------------
const RATE = 11025;
const CHORDS = [
  [261.63, 329.63, 392.0], // C E G
  [293.66, 349.23, 440.0], // D F A
  [246.94, 293.66, 392.0], // B D G
  [220.0, 261.63, 329.63], // A C E
];
const CLINKS = [2000, 2600, 3200];
/** One pad chord: a triangle root and two sines an octave down, lowpassed at
 * 650 Hz, rising to 0.045 over 1.6 s and falling to silence by 5.8 s. */
async function renderChord(chord: number[]): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(6 * RATE), RATE);
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 650;
  const g = off.createGain();
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.045, 1.6); g.gain.linearRampToValueAtTime(0.0001, 5.8); g.gain.setValueAtTime(0, 5.8);
  lp.connect(g).connect(off.destination);
  chord.forEach((freq, v) => {
    const osc = off.createOscillator(); osc.type = v === 0 ? "triangle" : "sine"; osc.frequency.value = freq * 0.5;
    osc.connect(lp); osc.start();
  });
  return createClip(await off.startRendering());
}
/** A soft clink: a sine pinged to 0.02 in 5 ms, gone in 0.12 s. */
async function renderClink(freq: number): Promise<AudioClip> {
  const rate = RATE * 4;
  const off = new OfflineAudioContext(1, Math.round(0.15 * rate), rate);
  const osc = off.createOscillator(); osc.frequency.value = freq;
  const g = off.createGain();
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.02, 0.005); g.gain.exponentialRampToValueAtTime(0.0001, 0.12);
  osc.connect(g).connect(off.destination); osc.start();
  return createClip(await off.startRendering());
}

let started = false;
let paused = false;
let ambience: Sound | null = null;
let ambienceClip: AudioClip | null = null;
let chords: AudioClip[] = [];
let clinks: SoundBank | null = null;
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

/** Each frame, once the mixer runs: the pad's next chord every 4.8 s and a
 * clink every 2.5–7.5 s of mixer time, once their clips are rendered. */
export function update(): void {
  if (context.state !== "running" || !started) return; // starting the beds still waits for the mixer
  if (!chords.length || !clinks) return;
  try {
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
      try { clinks.play(); } catch { /* full */ }
    }
  }
}
