// The browser build's pure game scripts, unchanged and shared with the Node
// tests: rng, rules, content, store and the string tables (js/*.js, UMD),
// plus js/migrate.js (the engine save document and what the browser build
// left in the account), evaluated as classic scripts so their globals
// (BBRNG, BBRules, BBContent, BBStore, BBI18n, BBMigrate) are this module's
// exports.
//
// js/store.js keeps the device's local leaderboard in `localStorage`: here
// that is a small shim over the device's starhermit:storage, installed
// before the scripts run. Progress is the game's save (platform.ts).
import { storage } from "starhermit:storage";
import { loadClassic } from "starhermit:script";

const shim = {
  getItem(key: string): string | null {
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;

for (const f of ["js/rng.js", "js/rules.js", "js/content.js", "js/store.js", "js/i18n.js", "js/migrate.js"]) loadClassic(f);

// -- The shapes this client reads -------------------------------------------------
export type Item = "capacity" | "helper" | "stove" | "expand";
export interface Cfg {
  id: string; kind: string; name: string; seed: number; date?: string; desc?: string;
  grid: { w: number; h: number }; openTables: number; closedTables: number; expandSize: number;
  stoves: number; maxStoves: number; maxHelpers: number; startCapacity: number; coins: number;
  goal: number; daySec: number; spawnSec: [number, number]; patienceSec: [number, number];
  price: number; tipMax: number; ranked: boolean; endless?: boolean;
  par?: { score: number } | null; mechanics: Record<Item | "undo", boolean>;
  costs: Record<Item, number[]>;
}
export interface Table { id: number; x: number; y: number; open: boolean; guestId: number | null; reservedBy: number | null }
export interface Stove { id: number; x: number; y: number; progress: number }
export interface Guest { id: number; status: "queue" | "seated" | "eating"; tableId: number | null; patience: number; maxPatience: number }
export interface Waiter { id: number; kind: "player" | "helper"; x: number; y: number; carrying: number; capacity: number }
export interface Score { served: number; servePoints: number; tips: number; lost: number; expansions: number; helpers: number; timeBonus: number; total: number }
export interface Terminal { reason: string; win: boolean; tick: number; score: Score; elapsedMs: number }
export interface GameEvent { t: string; pay?: number }
export interface State {
  v: number; cfg: Cfg; tick: number; dayTicks: number; coins: number; earned: number; stock: number;
  tables: Table[]; stoves: Stove[]; guests: Guest[]; waiters: Waiter[];
  score: Score; terminal: Terminal | null; events: GameEvent[];
}
export interface Command { type: string; table?: number; item?: Item; x?: number; y?: number }
export interface Legal { type: "serve" | "pickup" | "buy"; table?: number; urgent?: boolean; item?: Item; cost?: number }
export interface Hint { action: Legal | null; key: string; vars?: Record<string, string | number>; text: string }
export interface BuyInfo { ok: boolean; reason?: string; cost?: number; level?: number }
export interface Lesson { id: string; title: string; text: string; cfg: Cfg; steps: { text: string; event: string; item?: Item }[] }
export interface Theme { name: string; accent: string; floor: number; floorAlt: number; wall: number; table: number; wood: number; cloth: number; metal: number; glow: number }
export interface Progress {
  tutorialDone: Record<string, boolean>; journeyStars: Record<string, number>; journeyBest: Record<string, number>;
  challengeBest: Record<string, number>; dailiesDone: Record<string, number>; practiceBest: Record<string, number>;
  achievements: Record<string, number>;
  stats: { rounds: number; wins: number; served: number; lost: number; hires: number; expansions: number; bestScore: number; playMs: number; dailyStreak: number; lastDaily: string };
  cosmetics?: { theme: string };
}
export interface Settings {
  captions: boolean; theme: string; colorPalette: string; leftHanded: boolean; haptics: boolean; boardMirror: boolean; speed: number;
  [key: string]: unknown;
}
export interface Doc { v: number; settings: Settings; progress: Progress }
export interface BoardEntry { name?: string; you?: boolean; score: number; date?: string; sessionId: string; invalid?: number; durationMs?: number; cfgId: string; playerId?: string }
export interface RngStream { next(): number; state: number }

interface RulesApi {
  TICK_MS: number;
  createGame(cfg: Cfg): State;
  legalActions(s: State): Legal[];
  applyCommand(s: State, cmd: Command): { ok: boolean; reason?: string };
  step(s: State): void;
  hint(s: State): Hint;
  hashState(s: State): string;
  serialize(s: State): string;
  deserialize(json: string): State;
  buyInfo(s: State, item: Item): BuyInfo;
}
interface ContentApi {
  CONTENT_VERSION: number;
  JOURNEY: Cfg[]; LESSONS: Lesson[]; CHALLENGES: Cfg[];
  PRACTICE: Record<string, { name: string; spawnSec: [number, number]; patienceSec: [number, number]; daySec: number }>;
  THEMES: Record<string, Theme>;
  practiceCfg(difficulty: string, seed: number): Cfg;
  dailyCfg(date: string): Cfg;
  rivalScores(cfg: Cfg): { name: string; score: number }[];
}
interface StoreApi {
  DEFAULT_SETTINGS: Settings;
  ACHIEVEMENTS: { key: string; name: string; desc: string }[];
  fresh(): Doc;
  loadBoards(): { entries: BoardEntry[] };
  saveBoards(b: { entries: BoardEntry[] }): void;
  sortEntries(e: BoardEntry[]): BoardEntry[];
}
interface RngApi { derive(seed: number, stream: number): RngStream; hashString(s: string): number; STREAM_DECOR: number; STREAM_AV: number }
interface I18nApi {
  t(key: string, vars?: Record<string, string | number> | null, fallback?: string): string;
  setLocale(tag: string): void;
  LOCALES: string[];
  readonly lang: string;
}
interface MigrateApi {
  GAME_SETTING_KEYS: string[];
  BROWSER_SETTING_KEYS: string[];
  progressFromSave(doc: unknown): Progress | null;
  docFromBrowserSave(text: string | null): Doc | null;
  saveDoc(progress: Progress): { v: 1; progress: Progress };
  mergeProgress(remote: Progress | null, local: Progress | null): Progress;
  migrateSetting(key: string, value: unknown): unknown;
}

const g = globalThis as unknown as { BBRules: RulesApi; BBContent: ContentApi; BBStore: StoreApi; BBRNG: RngApi; BBI18n: I18nApi; BBMigrate: MigrateApi };
export const Rules = g.BBRules;
export const Content = g.BBContent;
export const Store = g.BBStore;
export const RNG = g.BBRNG;
export const I18n = g.BBI18n;
export const Migrate = g.BBMigrate;
