// Bistro Builder on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules, content and save document are the
// browser build's unchanged js/*.js (classic.ts); this module is what
// js/main.js did around them — the session (fixed 100 ms ticks, command
// dispatch with idempotent ids, the replay envelope, rewind snapshots,
// lessons, urgency cues, terminal → progression, achievements and the local
// score comparison), the screen state machine (title → modes → setup →
// countdown → service ⇄ paused → results, with settings, help, profile and
// the leaderboard), input routing (actions, gamepad action cycling, board
// taps) and the lifecycle — with the screens and HUD drawn by screens.ts
// (starhermit:ui) and the room by render.ts (starhermit:scene).
//
// The service clock is the runtime's fixed steps (60 a second): a rules tick
// every 6 steps (every 3 at 2× speed), only while the service runs, so
// pausing, a hidden window or a slow frame never moves it.
import { frame, onFixedUpdate, onPreferencesChange, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { bindingLabel, onAction, onPointerButton, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onPlayerChange, onSessionEnded } from "starhermit:platform";
import { Content, RNG, Rules, Store, type BoardEntry, type Cfg, type Command, type Item, type Legal, type Lesson, type State, type Terminal } from "./classic.ts";
import * as audio from "./audio.ts";
import { onLocaleChange, t } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens, loadArt } from "./screens.ts";
import { applyPalette, initStyles } from "./style.ts";

const BUILD = "1.0.0";
const STEPS_PER_TICK = 6; // 60 fixed steps a second, a rules tick every 100 ms

export type ScreenName = "title" | "modes" | "learn" | "journey" | "practice" | "challenge" | "daily" | "settings" | "help" | "profile" | "leaderboard" | "paused" | "results";
export interface ResultsView {
  term: Terminal; unlocked: string[]; envelope: { contentVersion: number; build: string };
  cfg: Cfg; mode: string; lb: { posted: boolean; rank: number | null } | null; posting: boolean;
  local: BoardEntry[];
}
interface LessonRun { id: string; title: string; steps: Lesson["steps"]; step: number; pendingServe: boolean; pendingPickup: boolean }
export interface Game {
  state: State; cfg: Cfg; mode: string; lesson: LessonRun | null;
  commands: { tick: number; id: string; cmd: Command }[]; hashes: { tick: number; hash: string }[];
  cmdIds: Set<string>; cmdSeq: number; undoStack: string[]; over: boolean; paused: boolean;
  prev: { id: number; x: number; y: number }[] | null; invalidCount: number; speed: number;
  urgentSeen: Set<number>; replayT0: number; sub: number;
  countdown: { beat: number; left: number } | null;
  lessonEndIn: number; resultsIn: number; pendingResults: ResultsView | null;
}

export const app = {
  /** The open screen; null while playing (the HUD shows). */
  screen: "title" as ScreenName | null,
  /** Frame the screen opened on (the action that opened it must not also close it). */
  openedFrame: 0,
  focusNext: false,
  toast: null as { text: string; invalid: boolean; until: number } | null,
  banner: null as { text: string; until: number } | null,
  caption: null as { text: string; until: number } | null,
  /** The compact layout's open drawer. */
  drawer: null as "left" | "right" | null,
  results: null as ResultsView | null,
  confirmReset: false,
  signedOut: false,
  /** The gamepad's chosen legal action (D-pad left/right). */
  padIdx: 0,
};
export let game: Game | null = null;
export const settings = platform.settings;
const now = (): number => frame().time;
const sessionId = "s-" + RNG.hashString(String(Math.random()) + Date.now()).toString(36);

// ------------------------------------------------------------------ helpers
export function cfgName(cfg: Cfg | null | undefined): string {
  if (!cfg) return "";
  const id = String(cfg.id || "");
  if (cfg.kind === "journey") return t("j." + id, null, cfg.name);
  if (cfg.kind === "challenge") return t("ch." + id.replace(/^challenge-/, ""), null, cfg.name);
  if (cfg.kind === "practice") return t("pd." + id.replace(/^practice-/, ""), null, cfg.name);
  if (cfg.kind === "daily") return t("daily.name", { date: cfg.date ?? "" }, cfg.name);
  if (cfg.kind === "learn") return t("l." + id.replace(/^learn-/, ""), null, cfg.name);
  return cfg.name || "";
}
export function fmtClock(msRemaining: number): string {
  const s = Math.max(0, Math.ceil(msRemaining / 1000));
  return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
}
/** Journey stars: 1 = goal met, 2 = strong score (75 % of par), 3 = par score. */
export function starsFor(cfg: Cfg, term: Terminal | null): number {
  if (!term || !term.win) return 0;
  const par = cfg.par && cfg.par.score ? cfg.par.score : Infinity;
  if (term.score.total >= par) return 3;
  if (term.score.total >= par * 0.75) return 2;
  return 1;
}
const BUY_LABELS: Record<Item, string> = { capacity: "Bigger tray", helper: "Hire helper", stove: "Extra stove", expand: "Expand floor" };
export function buyLabel(item: Item): string { return t("buy." + item, null, BUY_LABELS[item] ?? item); }
export function hintText(h: ReturnType<typeof Rules.hint> | null): string {
  if (!h) return "";
  let v = h.vars ?? {};
  if (h.key === "hint.upgrade") v = { item: buyLabel(v.item as Item), n: v.n! };
  return h.key ? t(h.key, v, h.text) : h.text;
}
export const utcDate = (): string => new Date(Date.now()).toISOString().slice(0, 10);

/** A key name as the browser build's Help card showed it (native labels are codes, browser labels keys). */
export function keyName(action: string): string {
  const raw = bindingLabel(action, "keyboard");
  if (!raw) return "";
  const named: Record<string, string> = { Space: t("key.Space"), " ": t("key.Space"), Escape: "Esc", Esc: "Esc" };
  const first = raw.split(/\s*[,/]\s*|\s+or\s+/)[0]!;
  const n = named[first] ?? first.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  return n.length === 1 ? n.toUpperCase() : n;
}
export function keysText(): string {
  return t("help.keys", {
    t1: keyName("table1"), t9: keyName("table9"), pickup: keyName("pickup"), hint: keyName("hint"), undo: keyName("undo"),
    camera: keyName("camera"), speed: keyName("speed"),
    pause: bindingLabel("pause", "keyboard").split(/\s*[,/]\s*|\s+or\s+/).map((k) => (/^esc/i.test(k) ? "Esc" : k.replace(/^Key/, "").toUpperCase())).join("/"),
  });
}

export function announce(msg: string): void { if (msg) ui.announce(msg); }
export function toast(text: string, invalid = false): void {
  app.toast = { text, invalid, until: now() + 2.6 };
  if (invalid) announce(t("invalid.announce", { text }));
}
function banner(text: string, ms: number): void { app.banner = { text, until: now() + ms / 1000 }; }
audio.setOnCaption((event) => {
  if (settings.captions) app.caption = { text: "♪ " + t("cap." + event), until: now() + 1.8 };
});

// ------------------------------------------------------------------ screens
export function showScreen(name: ScreenName | null): void {
  // In-round overlays come via pause (the browser build's rule).
  if (name && name !== "paused" && name !== "settings" && name !== "help" && name !== "results" && game && !game.over && !game.paused) return;
  app.screen = name;
  app.openedFrame = frame().frame;
  app.focusNext = !!name;
  app.confirmReset = false;
  if (!name) ui.setFocus(null);
}
/** Back from Settings / Help: to the pause menu during a service, else the title. */
export function backToContext(): void {
  if (game && !game.over) pauseGame(); else showScreen("title");
}

// ------------------------------------------------------------------ session
export function themeNow(): (typeof Content.THEMES)[string] {
  return Content.THEMES[settings.theme] ?? Content.THEMES.ember!;
}
export function startGame(cfg: Cfg, mode: string, lesson?: Lesson | null): void {
  const state = Rules.createGame(cfg);
  game = {
    state, cfg, mode, lesson: lesson ? { id: lesson.id, title: lesson.title, steps: lesson.steps, step: 0, pendingServe: false, pendingPickup: false } : null,
    commands: [], hashes: [{ tick: 0, hash: Rules.hashState(state) }], cmdIds: new Set(), cmdSeq: 0, undoStack: [],
    over: false, paused: true, prev: null, invalidCount: 0, speed: Number(settings.speed) || 1, urgentSeen: new Set(),
    replayT0: Date.now(), sub: 0, countdown: { beat: 0, left: 0 }, lessonEndIn: -1, resultsIn: -1, pendingResults: null,
  };
  app.screen = null;
  app.drawer = null;
  app.results = null;
  app.padIdx = 0;
  ui.setFocus(null);
  audio.start();
  audio.setPaused(false);
  audio.setAvRng(RNG.derive(cfg.seed >>> 0, RNG.STREAM_AV));
  render.build(state, themeNow(), cfg.seed);
  refreshHighlights();
  announce(t("an.start", { name: cfgName(cfg), goal: cfg.goal > 0 ? t("an.goalCoins", { n: cfg.goal }) : t("an.goalServe") }));
  if (game.lesson) announce(t("an.lessonStep", { text: lessonStepText() }));
}
export function lessonStepText(): string {
  const l = game?.lesson;
  if (!l) return "";
  const step = l.steps[l.step];
  return step ? t("ls." + l.id + "." + l.step, null, step.text) : "";
}

/** One beat of the 3-2-1 countdown every 640 ms (200 ms with reduced motion). */
function countdownStep(g: Game): void {
  const cd = g.countdown!;
  if (cd.left > 0) { cd.left--; return; }
  const seq = ["3", "2", "1", t("banner.start")];
  if (cd.beat < seq.length) {
    const last = cd.beat === seq.length - 1;
    banner(seq[cd.beat]!, last ? 900 : 620);
    audio.play(last ? "service-start" : "ui"); // the hand bell opens service
    cd.beat++;
    cd.left = preferences().reducedMotion ? 12 : 38;
    return;
  }
  g.countdown = null;
  if (!app.screen) g.paused = false; // a pause menu opened during the countdown stays paused
}

export function dispatch(cmd: Command, silent = false): { ok: boolean; reason?: string } {
  const g = game;
  if (!g || g.over || g.paused) return { ok: false, reason: "not-active" };
  const id = "c" + g.state.tick + "-" + (++g.cmdSeq); // monotonic: survives undo filtering
  if (g.cmdIds.has(id)) return { ok: false, reason: "duplicate" };
  const res = Rules.applyCommand(g.state, cmd);
  if (!res.ok) {
    g.invalidCount++;
    if (!silent) { audio.play("invalid"); toast(t("inv." + res.reason, null, String(res.reason)), true); }
    return res;
  }
  g.cmdIds.add(id);
  g.commands.push({ tick: g.state.tick, id, cmd: { type: cmd.type, table: cmd.table, item: cmd.item, x: cmd.x, y: cmd.y } });
  if (cmd.type === "buy" && cmd.item === "expand") audio.play("expand"); // the wall comes down
  else if (cmd.type === "buy" && cmd.item === "helper") audio.play("hire"); // apron on
  else if (cmd.type === "buy" || cmd.type === "resign") audio.play("buy");
  else audio.play("cmd"); // every committed action gets an ack
  if (g.mode === "practice" || g.mode === "learn") pushUndo();
  checkLessonEvent(cmd);
  refreshHighlights();
  render.sync(g.state, g.prev, 1);
  return res;
}

// Rewind (where the rules allow it): a snapshot before every accepted command.
function pushUndo(): void {
  const g = game!;
  if (!g.cfg.mechanics.undo) return;
  g.undoStack.push(Rules.serialize(g.state));
  if (g.undoStack.length > 120) g.undoStack.shift();
}
export function undo(): void {
  const g = game;
  if (!g || g.over || g.paused) return;
  if (!g.cfg.mechanics.undo || !g.undoStack.length) { toast(t(g.cfg.mechanics.undo ? "undo.none" : "undo.na"), true); return; }
  g.state = Rules.deserialize(g.undoStack.pop()!);
  g.prev = null; // positions jumped: no interpolation from the old timeline
  g.commands = g.commands.filter((c) => c.tick <= g.state.tick);
  render.build(g.state, themeNow(), g.cfg.seed);
  audio.play("undo");
  toast(t("undo.done"));
  refreshHighlights();
}
export function doHint(): void {
  const g = game;
  if (!g || g.over) return;
  const h = Rules.hint(g.state);
  toast(hintText(h));
  audio.play("hint");
  if (h.action && h.action.type === "serve") render.setHighlights(["table:" + h.action.table]);
}
export function toggleSpeed(): void {
  const g = game;
  if (!g || g.over) return;
  g.speed = g.speed === 1 ? 2 : 1;
  toast(t("toast.speed", { n: g.speed }));
}
export function serveTable(id: number): void {
  if (game && id < game.state.tables.length) dispatch({ type: "serve", table: id });
}

// ------------------------------------------------------------------ lessons
function checkLessonEvent(cmd: Command): void {
  const l = game?.lesson;
  if (!l) return;
  const step = l.steps[l.step];
  if (!step) return;
  if (step.event === "buy" && cmd.type === "buy" && cmd.item === step.item) advanceLesson();
  // Any successful serve advances a serve step: a strict table order would
  // soft-lock the lesson if the player served the patient guest first.
  else if (step.event === "serve" && cmd.type === "serve") l.pendingServe = true; // confirmed on the event
  else if (step.event === "pickup" && cmd.type === "pickup") l.pendingPickup = true;
}
function advanceLesson(): void {
  const g = game!, l = g.lesson!;
  l.step++;
  audio.play("dish-ready");
  if (l.step >= l.steps.length) {
    banner(t("banner.lessonDone"), 1400);
    platform.progress.tutorialDone[l.id] = true;
    platform.persist();
    g.lessonEndIn = 54; // 900 ms
  } else announce(t("an.lessonStep", { text: lessonStepText() }));
}

// ------------------------------------------------------------------ the simulation
function tick(g: Game): void {
  g.prev = g.state.waiters.map((w) => ({ id: w.id, x: w.x, y: w.y }));
  Rules.step(g.state);
  drainEvents(g);
  if (g.state.tick % 50 === 0) g.hashes.push({ tick: g.state.tick, hash: Rules.hashState(g.state) });
  if (g.state.terminal) onTerminal();
}
function drainEvents(g: Game): void {
  const evs = g.state.events;
  for (const e of evs) {
    if (e.t === "cmd") continue;
    audio.play(e.t);
    if (e.t === "serve" || e.t === "win" || e.t === "lose") render.event(e.t);
    const l = g.lesson;
    if (l) {
      if (e.t === "serve" && l.pendingServe) { l.pendingServe = false; advanceLesson(); }
      if (e.t === "pickup" && l.pendingPickup) { l.pendingPickup = false; advanceLesson(); }
    }
    if (e.t === "serve") announce(t("an.served", { n: e.pay ?? 0 }));
    if (e.t === "leave-angry") announce(t("an.angry"));
  }
  evs.length = 0;
}
/** One warning cue per guest the first time their patience drops under 30 %
 * (the threshold legalActions marks as urgent). Presentation only. */
function checkUrgent(g: Game): void {
  for (const guest of g.state.guests) {
    if (guest.status !== "seated" || g.urgentSeen.has(guest.id)) continue;
    if (guest.patience <= guest.maxPatience * 0.3) {
      g.urgentSeen.add(guest.id);
      audio.play("urgent");
      announce(t("an.urgent", { n: (guest.tableId ?? 0) + 1 }));
    }
  }
}
/** Legal targets glow (tables with a waiting guest you can serve). */
function refreshHighlights(): void {
  if (!game) return;
  render.setHighlights(Rules.legalActions(game.state).map((a) => (a.type === "serve" ? "table:" + a.table : a.type)));
}

// ------------------------------------------------------------------ terminal / results
function onTerminal(): void {
  const g = game!;
  if (g.over) return;
  g.over = true;
  const st = g.state, term = st.terminal!;
  g.hashes.push({ tick: st.tick, hash: Rules.hashState(st) });
  audio.play(term.win ? "win" : "lose");

  const p = platform.progress;
  p.stats.rounds++;
  p.stats.served += st.score.served;
  p.stats.lost += st.score.lost;
  p.stats.hires += st.score.helpers;
  p.stats.expansions += st.score.expansions;
  p.stats.playMs += st.tick * Rules.TICK_MS;
  if (term.win) p.stats.wins++;
  if (st.score.total > p.stats.bestScore) p.stats.bestScore = st.score.total;
  if (g.mode === "journey") {
    const stars = starsFor(g.cfg, term);
    if (stars > (p.journeyStars[g.cfg.id] ?? 0)) p.journeyStars[g.cfg.id] = stars;
    if (st.score.total > (p.journeyBest[g.cfg.id] ?? 0)) p.journeyBest[g.cfg.id] = st.score.total;
  } else if (g.mode === "challenge") {
    if (st.score.total > (p.challengeBest[g.cfg.id] ?? 0)) p.challengeBest[g.cfg.id] = st.score.total;
  } else if (g.mode === "daily") {
    const date = g.cfg.date!;
    const prevBest = p.dailiesDone[date];
    if (prevBest == null || st.score.total > prevBest) p.dailiesDone[date] = st.score.total;
    if (p.stats.lastDaily !== date) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      p.stats.dailyStreak = p.stats.lastDaily === yesterday ? p.stats.dailyStreak + 1 : 1;
      p.stats.lastDaily = date;
    }
  } else if (g.mode === "practice") {
    const key = g.cfg.id.replace("practice-", "");
    if (st.score.total > (p.practiceBest[key] ?? 0)) p.practiceBest[key] = st.score.total;
  }
  const unlocked = checkAchievements(term);
  platform.persist();

  const envelope = {
    v: 1, build: BUILD, contentVersion: Content.CONTENT_VERSION, cfgId: g.cfg.id, seed: g.cfg.seed >>> 0,
    initialHash: g.hashes[0]!.hash, t0: g.replayT0, commands: g.commands, hashes: g.hashes,
    terminal: { reason: term.reason, win: term.win, tick: term.tick, score: term.score },
    sessionId, invalid: g.invalidCount, durationMs: term.elapsedMs, playerId: platform.userId() ?? undefined,
  };
  if (g.cfg.ranked) recordLocal(envelope);
  const local = g.cfg.ranked ? Store.loadBoards().entries.filter((e) => e.cfgId === g.cfg.id) : [];
  g.pendingResults = { term, unlocked, envelope, cfg: g.cfg, mode: g.mode, lb: null, posting: false, local };
  g.resultsIn = 54; // 900 ms
}
function recordLocal(env: { terminal: { score: { total: number } }; sessionId: string; invalid: number; durationMs: number; cfgId: string; playerId?: string }): void {
  const entry: BoardEntry = {
    name: "You", you: true, score: env.terminal.score.total, date: new Date().toISOString().slice(0, 10),
    sessionId: env.sessionId, invalid: env.invalid, durationMs: env.durationMs, cfgId: env.cfgId,
  };
  if (env.playerId) entry.playerId = env.playerId;
  const boards = Store.loadBoards();
  boards.entries.push(entry);
  boards.entries = Store.sortEntries(boards.entries).slice(0, 100);
  Store.saveBoards(boards);
}
function checkAchievements(term: Terminal): string[] {
  const p = platform.progress, unlocked: string[] = [];
  const grant = (key: string): void => { if (!p.achievements[key]) { p.achievements[key] = Date.now(); unlocked.push(key); } };
  const st = game!.state;
  grant("first-service");
  if (term.win && st.score.lost === 0 && st.score.served >= 8) grant("full-house");
  if (p.stats.served >= 100) grant("century");
  if (p.stats.hires >= 5) grant("crew-chief");
  if (["j05", "j10", "j15", "j20", "j25", "j30", "j35", "j40"].every((id) => (p.journeyStars[id] ?? 0) > 0)) grant("mastery-row");
  if (Object.keys(p.dailiesDone).length >= 3) grant("regular");
  return unlocked;
}
function openResults(view: ResultsView): void {
  app.results = view;
  game = null;
  app.screen = null;
  showScreen("results");
  // Signed in, every finished run but a lesson goes to the StarHermit high-score board.
  if (view.mode !== "learn" && platform.signedIn()) {
    view.posting = true;
    void platform.postLeaderboard(view.term.score.total).then((r) => { view.lb = r; view.posting = false; });
  }
}
/** Leave service (resign) or a finished lesson. */
export function endGame(): void {
  const g = game;
  if (!g || g.over) return;
  g.paused = false;
  Rules.applyCommand(g.state, { type: "resign" });
  if (g.state.terminal) onTerminal();
}
export function playAgain(): void {
  const r = app.results;
  if (!r) return;
  const lesson = r.mode === "learn" ? Content.LESSONS.find((l) => l.cfg.id === r.cfg.id) ?? null : null;
  startGame(r.cfg, r.mode, lesson);
}
export function nextStage(): Cfg | null {
  const r = app.results;
  if (!r || r.mode !== "journey" || !(r.term.win)) return null;
  const idx = Content.JOURNEY.findIndex((c) => c.id === r.cfg.id);
  return idx >= 0 && idx + 1 < Content.JOURNEY.length ? Content.JOURNEY[idx + 1]! : null;
}
export function startPractice(difficulty: string): void {
  startGame(Content.practiceCfg(difficulty, RNG.hashString(sessionId + Date.now()) >>> 0), "practice");
}

// ------------------------------------------------------------------ pause
export function pauseGame(): void {
  const g = game;
  if (!g || g.over) return;
  g.paused = true;
  audio.setPaused(true);
  showScreen("paused");
}
export function resumeGame(): void {
  const g = game;
  if (!g || g.over) return;
  if (!g.countdown) g.paused = false;
  audio.setPaused(false);
  showScreen(null);
}

// ------------------------------------------------------------------ gamepad: cycle the legal actions
function describeAction(a: Legal): string {
  if (a.type === "serve") return t("gp.serve", { n: (a.table ?? 0) + 1 });
  if (a.type === "pickup") return t("gp.pickup");
  return t("gp.buy", { item: buyLabel(a.item!), n: a.cost ?? 0 });
}
function cycle(step: number): void {
  const legal = game ? Rules.legalActions(game.state) : [];
  if (!legal.length) return;
  app.padIdx = (app.padIdx + step + legal.length) % legal.length;
  toast(describeAction(legal[app.padIdx]!));
}
function commitPad(): void {
  const legal = game ? Rules.legalActions(game.state) : [];
  if (!legal.length) return;
  const a = legal[app.padIdx % legal.length]!;
  dispatch(a.type === "serve" ? { type: "serve", table: a.table } : a.type === "buy" ? { type: "buy", item: a.item } : { type: "pickup" });
}

// ------------------------------------------------------------------ input
const playing = (): boolean => !!game && !game.over && !game.paused && !app.screen;
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  if (a === "pause") {
    if (frame().frame === app.openedFrame) return;
    if (app.screen && game && !game.over) {
      // An in-round overlay (pause, settings, help) closes to play.
      resumeGame();
    } else if (game && !game.over && !app.screen) pauseGame();
    else if (app.screen && app.screen !== "title" && app.screen !== "results") showScreen("title");
    return;
  }
  if (!playing()) return;
  if (ui.focused()) ui.setFocus(null);
  const m = /^table(\d)$/.exec(a);
  if (m) { serveTable(Number(m[1]) - 1); return; }
  switch (a) {
    case "pickup": dispatch({ type: "pickup" }); break;
    case "hint": doHint(); break;
    case "undo": undo(); break;
    case "speed": toggleSpeed(); break;
    case "camera": render.reframe(); break;
    case "prev_action": cycle(-1); break;
    case "next_action": cycle(1); break;
    case "commit": commitPad(); break;
  }
});

// Board taps: a table serves it, a stove picks up, the floor walks there. A
// drag over 10 px or a hold over 600 ms is a camera / scroll gesture and
// commits nothing. Touch and the mouse can both report one tap: a pointer
// press right after a touch is skipped.
let down: { at: number; x: number; y: number } | null = null;
let lastTouch = -1e9;
function boardDown(x: number, y: number): void {
  down = playing() && !ui.pointerOver() ? { at: now(), x, y } : null;
}
function boardUp(x: number, y: number): void {
  const d = down;
  down = null;
  if (!d || !playing()) return;
  if (now() - d.at > 0.6 || Math.hypot(x - d.x, y - d.y) > 10 * frame().scale) return;
  const hit = render.pick(x, y);
  if (!hit) return;
  if (hit.kind === "table") dispatch({ type: "serve", table: hit.id });
  else if (hit.kind === "stove") dispatch({ type: "pickup" });
  else dispatch({ type: "goto", x: hit.x, y: hit.y });
}
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  if (e.pressed) boardDown(e.x, e.y); else boardUp(e.x, e.y);
});
onTouch((e) => {
  if (!e.primary) return;
  lastTouch = now();
  if (e.phase === "start") boardDown(e.x, e.y);
  else if (e.phase === "end") boardUp(e.x, e.y);
  else if (e.phase === "cancel") down = null;
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const key = `${f.quality}:${f.levelIndex}`;
  if (key === lookKey) return;
  lookKey = key;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
function applyPrefs(): void {
  const p = preferences();
  render.setReducedMotion(p.reducedMotion);
  applyPalette(p.highContrast, settings.colorPalette === "high-visibility");
}

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  applyPrefs();
  applyLook();
  loadArt();
  showScreen("title");
});
onPreferencesChange(() => applyPrefs());
onLocaleChange(() => { if (game?.lesson) announce(t("an.lessonStep", { text: lessonStepText() })); });
platform.onSettingsChange(() => {
  applyPrefs();
  if (game && render.hasRoom()) render.build(game.state, themeNow(), game.cfg.seed);
});
onSessionEnded(() => { app.signedOut = true; toast(t("acct.signedOut")); });
onPlayerChange((p) => { if (p) app.signedOut = false; });
onSuspend(() => {
  // Backgrounding pauses the service; nothing is lost.
  if (game && !game.over && !game.paused) pauseGame();
  platform.flush();
});
onResume(() => { if (game && !game.over) toast(t("toast.away")); });
onQuit(() => platform.flush());

onFixedUpdate(() => {
  const g = game;
  if (!g) return;
  if (g.countdown) countdownStep(g);
  if (g.lessonEndIn > 0 && --g.lessonEndIn === 0 && g.lesson) endGame();
  if (g.resultsIn > 0 && --g.resultsIn === 0 && g.pendingResults) { openResults(g.pendingResults); return; }
  if (g.paused || g.over) return;
  g.sub += g.speed;
  let ticked = false;
  while (g.sub >= STEPS_PER_TICK && !g.over) {
    g.sub -= STEPS_PER_TICK;
    tick(g);
    ticked = true;
  }
  if (ticked && !g.over) { refreshHighlights(); checkUrgent(g); }
});
let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
  const t0 = now();
  if (app.toast && t0 > app.toast.until) app.toast = null;
  if (app.banner && t0 > app.banner.until) app.banner = null;
  if (app.caption && t0 > app.caption.until) app.caption = null;
});
onRender((alpha) => {
  const g = game;
  if (g) {
    const a = g.paused || g.over ? 1 : Math.min(1, (g.sub + alpha * g.speed) / STEPS_PER_TICK);
    render.sync(g.state, g.prev, a);
  }
  drawScreens();
  render.frame(frameDt);
});

