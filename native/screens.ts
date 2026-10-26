// The browser build's DOM shell (index.html + js/ui.js + css/game.css) as
// starhermit:ui, built every frame: the header status bar (title, Coins /
// Earned / Clock / Served chips, the drawer and menu buttons), the left rail
// (objective, progress bar, hint, lesson step), the right rail (the station
// mirror — tray, door queue, every open table with its Serve button, the
// kitchen with Pick up — and the upgrade grid), the action tray over the
// playfield, the countdown banner, the toast and the caption line, and the
// full-window screens (title over its key art, modes, Learn, the Journey
// grid, Practice, Challenges, the daily, settings, help, profile, the
// leaderboard, pause, results with the score table). The browser's media
// queries are layouts picked by the window's logical size: wide (≥ 1024 px:
// both rails docked, swapped when left-handed), compact (rails as drawers
// from the header buttons; "Always show station panel" docks the right one),
// portrait phone (≤ 700 px: the tray's buttons in rows of three across the
// bottom) and short landscape (≤ 500 px tall: the tray a column at the
// right, the title without its key art). The room is framed into what the
// rails and the tray leave (render.frameRoom).
import { clipboard, frame, openMenu } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import { TextureLoader, type Texture } from "starhermit:scene";
import { Content, Rules, Store, type BoardEntry, type Cfg, type Item, type State, type Table } from "./classic.ts";
import { t, tx } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  app, backToContext, buyLabel, cfgName, dispatch, doHint, endGame, fmtClock, game, hintText, keysText, lessonStepText,
  nextStage, pauseGame, playAgain, resumeGame, serveTable, settings, showScreen, starsFor, startGame, startPractice,
  toast, toggleSpeed, undo, utcDate, type ScreenName,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; portrait: boolean; shortLand: boolean; ox: number; oy: number }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const shortLand = lw > lh && lh <= 500;
  return { lw, lh, sc, wide: lw >= 1024, portrait: lw <= 700 && lh > lw, shortLand, ox: sa.left, oy: sa.top };
}
const lastHeight = new Map<string, number>();
const cw = (L: Layout, max: number): number => Math.max(120, Math.min(max, L.lw - (L.portrait ? 26 : 38)));

function textWidth(text: string, style: string | readonly string[], kind?: "button"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: typeof style === "string" ? style : [...style] }).width / ui.preferences().scale;
}
const buttonWidth = (text: string, style: readonly string[]): number => textWidth(text, style, "button") + 2;

interface Btn { id: string; text: string; style?: string[]; disabled?: boolean; act: () => void }
const PLAIN = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = b.disabled ? { disabled: true } : {};
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = width - 34;
    const bold = style.includes("btn-primary");
    opts.content = () => { ui.paragraph(b.text, inner, bold ? { weight: "700", ...(style.includes("btn-big") ? { size: 18 } : {}) } : {}); };
  }
  if (ui.style(...style, s).id(b.id).button(b.text, opts)) b.act();
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, align: "start" | "center" = "start", gap = 9.6): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, buttonWidth(b.text, b.style ?? PLAIN));
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, buttonWidth(b.text, b.style ?? PLAIN) > width ? width : null);
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align: align === "center" ? "center" : "start", width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls?: string, id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = cls ? [cls] : [];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / ui.preferences().scale <= width) u.label(text);
  else u.paragraph(text, width);
}

/** A full-window screen (the browser's `.screen` over `.sheet`): its content
 * centred, scrolling from the top when taller than the window. */
function screen(key: string, L: Layout, build: (width: number) => void, width = cw(L, 720), spacing = 12, align: "start" | "center" = "start"): void {
  const avail = L.lh - (L.portrait ? 26 : 38);
  const h = lastHeight.get(key) ?? 0;
  ui.place(`scr-${key}`, "top-start", () => {
    const body = (): void => {
      const r = ui.column(`${key}-body`, () => build(width), { width, spacing, align });
      lastHeight.set(key, r.height / L.sc);
    };
    if (h > avail) ui.scrollArea(`${key}-scroll`, { width: Math.min(L.lw - 8, width + 16), height: avail }, body);
    else ui.column(`${key}-center`, body, { height: avail, justify: h > avail * 0.7 ? "start" : "center", align: "center" });
  }, { style: "screen", width: L.lw, height: L.lh, align: "center" });
}
function heading(text: string, cls = "screen-h"): void { ui.style(cls).heading(text); }
function backBtn(id: string, text: string, act: () => void): void { button({ id, text, act }); }
const back = (): void => showScreen("title");

// ------------------------------------------------------------------ art
let keyArt: Texture | null = null, winArt: Texture | null = null, loseArt: Texture | null = null;
export function loadArt(): void {
  const loader = new TextureLoader();
  // Missing art never breaks a screen: it is left out.
  loader.loadAsync("assets/key-art.webp").then((tex) => { keyArt = tex; }, () => undefined);
  loader.loadAsync("assets/results-win.webp").then((tex) => { winArt = tex; }, () => undefined);
  loader.loadAsync("assets/results-lose.webp").then((tex) => { loseArt = tex; }, () => undefined);
}
function art(tex: Texture | null, cls: string, width: number, aspect: number): void {
  if (!tex || tex.width <= 0) return;
  ui.style(cls).image("", tex, { width, height: Math.round(width / aspect) });
}

// ------------------------------------------------------------------ the frame
function firstLabel(name: ScreenName): string | null {
  switch (name) {
    case "title": return t("title.play");
    case "modes": return t("mode.learn");
    case "learn": return t("l.serve", null, "Serve a guest");
    case "journey": return t("jcell.aria", { n: 1, name: cfgName(Content.JOURNEY[0]), stars: platform.progress.journeyStars[Content.JOURNEY[0]!.id] ?? 0 });
    case "practice": return t("pd.calm");
    case "challenge": return cfgName(Content.CHALLENGES[0]);
    case "daily": return t(platform.progress.dailiesDone[utcDate()] != null ? "daily.replay" : "daily.start");
    case "settings": return t("set.captions");
    case "help": case "leaderboard": return t("back");
    case "profile": return t("profile.reset");
    case "paused": return t("pause.resume");
    case "results": return null;
  }
}

export function drawScreens(): void {
  const L = layoutNow();
  if (app.focusNext && app.screen && frame().frame - app.openedFrame >= 2) {
    const first = firstLabel(app.screen);
    if (first) ui.setFocus(first);
    app.focusNext = false;
  }
  const g = game;
  if (g) hud(L, g.state);
  if (app.screen) {
    switch (app.screen) {
      case "title": titleScreen(L); break;
      case "modes": modesScreen(L); break;
      case "learn": learnScreen(L); break;
      case "journey": journeyScreen(L); break;
      case "practice": practiceScreen(L); break;
      case "challenge": challengeScreen(L); break;
      case "daily": dailyScreen(L); break;
      case "settings": settingsScreen(L); break;
      case "help": helpScreen(L); break;
      case "profile": profileScreen(L); break;
      case "leaderboard": leaderboardScreen(L); break;
      case "paused": pauseScreen(L); break;
      case "results": resultsScreen(L); break;
    }
  }
  if (app.toast) {
    // Over a screen the toast floats at the window's bottom; in play above the tray.
    const over = !!app.screen || !g;
    const w = over ? Math.min(L.lw * 0.9, 560) : Math.max(160, Math.min(pf.w * 0.9, 560));
    const x = over ? (L.lw - w) / 2 : pf.x + (pf.w - w) / 2;
    const y = over ? L.lh - 16 - toastH : pf.y + pf.h - trayH - 12 - toastH;
    const style = app.toast.invalid ? "toast-invalid" : "toast";
    ui.place("toast", { anchor: "top-start", x, y: Math.max(0, y) }, () => {
      const r = ui.column("toast-box", () => {
        if (textWidth(app.toast!.text, style) + 34 <= w) ui.style(style).label(app.toast!.text);
        else ui.style(style).paragraph(app.toast!.text, w - 34);
      }, { align: "center" });
      toastH = r.height / L.sc;
    }, { width: w, align: "center" });
  }
}
let toastH = 40;

// ------------------------------------------------------------------ HUD
/** The playfield (logical, safe-area relative) and the tray's extent, last frame. */
const pf = { x: 0, y: 0, w: 1, h: 1 };
let trayH = 0;
let topH = 48;

function hud(L: Layout, st: State): void {
  const g = game!;
  const cfg = g.cfg;
  // --- header status bar
  const chips: { id: string; label: string; value: string; cls: string }[] = [
    { id: "chip-coins", label: t("chip.coins"), value: String(st.coins), cls: "chip-value" },
    { id: "chip-earned", label: t("chip.earned"), value: st.earned + (cfg.goal > 0 ? "/" + cfg.goal : ""), cls: cfg.goal > 0 && st.earned >= cfg.goal ? "chip-ok" : "chip-value" },
    { id: "chip-clock", label: "", value: fmtClock(Math.max(0, (st.dayTicks - st.tick) * Rules.TICK_MS)), cls: (st.dayTicks - st.tick) * Rules.TICK_MS < 30000 ? "chip-low" : "chip-value" },
    { id: "chip-served", label: t("chip.served"), value: String(st.score.served), cls: "chip-value" },
  ];
  const chipW = (c: (typeof chips)[number]): number => (c.label ? textWidth(c.label, "chip-label") + 5 : 0) + textWidth(c.value, c.cls) + 26;
  const compact = !L.wide;
  const docked = compact && !!settings.boardMirror;
  const btns: Btn[] = [];
  if (compact) {
    btns.push({ id: "btn-drawer-left", text: t("rail.objective"), style: ["btn", "btn-icon", "btn-small"], act: () => { app.drawer = app.drawer === "left" ? null : "left"; } });
    if (!docked) btns.push({ id: "btn-drawer-right", text: t("rail.stations"), style: ["btn", "btn-icon", "btn-small"], act: () => { app.drawer = app.drawer === "right" ? null : "right"; } });
  }
  btns.push({ id: "btn-menu", text: t("aria.menu"), style: ["btn", "btn-icon", "btn-small"], act: () => { if (game && !game.over) pauseGame(); else showScreen("title"); } });
  const brandW = textWidth("Bistro Builder", "brand") + (L.portrait ? 0 : textWidth(t("shell.sub"), "brand-sub") + 8);
  const btnsW = btns.reduce((n, b) => n + buttonWidth(b.text, b.style!) + 8, 0);
  const chipsW = chips.reduce((n, c) => n + chipW(c) + 9.6, 0);
  const inner = L.lw - 25.6;
  const oneRow = brandW + chipsW + btnsW + 20 <= inner;
  const chipRow = (label: string): void => {
    // the chips wrap (they never cut off)
    const rows: (typeof chips)[] = [[]];
    let used = 0;
    for (const c of chips) {
      const w = chipW(c);
      if (rows[rows.length - 1]!.length && used + w + 9.6 > inner) { rows.push([]); used = 0; }
      used += w + 9.6;
      rows[rows.length - 1]!.push(c);
    }
    ui.column(label, () => {
      rows.forEach((row, ri) => ui.row(`${label}-${ri}`, () => {
        for (const c of row) {
          ui.row(c.id, () => {
            if (c.label) ui.style("chip-label").label(c.label);
            ui.style(c.cls).id(`${c.id}-v`).label(c.value);
          }, { style: "stat-chip", spacing: 5, align: "center" });
        }
      }, { spacing: 9.6, align: "center" }));
    }, { spacing: 6 });
  };
  const brand = (): void => {
    ui.row("brand", () => {
      ui.style("brand").label("Bistro Builder");
      if (!L.portrait) ui.style("brand-sub").label(t("shell.sub"));
    }, { spacing: 8, align: "center" });
  };
  const buttons = (): void => {
    ui.row("top-btns", () => {
      for (const b of btns) { if (ui.style(...b.style!).id(b.id).button(b.text)) { b.act(); ui.setFocus(null); } }
    }, { spacing: 8, align: "center" });
  };
  const top = ui.place("topbar", "top-start", () => {
    if (oneRow) {
      ui.row("top-row", () => { brand(); chipRow("chips"); ui.spacer(); buttons(); }, { width: inner, spacing: 9.6, align: "center" });
    } else {
      ui.column("top-col", () => {
        ui.row("top-row", () => { brand(); ui.spacer(); buttons(); }, { width: inner, spacing: 9.6, align: "center" });
        chipRow("chips");
      }, { spacing: 6, width: inner });
    }
  }, { style: "topbar", width: L.lw });
  topH = top.height / L.sc;

  // --- rails
  const leftHanded = !!settings.leftHanded;
  const railH = L.lh - topH;
  const leftW = L.wide ? 240 : 0;
  const rightW = L.wide || docked ? 260 : 0;
  // left-handed: the action panel (stations) sits under the left hand
  const objX = leftHanded ? L.lw - leftW : 0;
  const staX = leftHanded ? 0 : L.lw - rightW;
  if (leftW) rail("rail-left", objX, topH, leftW, railH, "rail", () => objectiveRail(leftW - 25.6, st));
  if (rightW) rail("rail-right", staX, topH, rightW, railH, "rail", () => stationsRail(rightW - 25.6, st));
  const occL = (leftHanded ? rightW : leftW), occR = (leftHanded ? leftW : rightW);
  pf.x = occL; pf.y = topH; pf.w = Math.max(1, L.lw - occL - occR); pf.h = Math.max(1, railH);

  // --- the action tray over the playfield
  const items: Btn[] = [
    { id: "btn-pickup", text: tx("hud.pickup"), act: () => dispatch({ type: "pickup" }) },
    { id: "btn-hint", text: tx("hud.hint"), act: doHint },
  ];
  if (cfg.mechanics.undo) items.push({ id: "btn-rewind", text: tx("hud.rewind"), act: undo });
  items.push({ id: "btn-speed", text: tx("hud.speed") + (g.speed === 2 ? " 2×" : ""), act: toggleSpeed });
  items.push({ id: "btn-pause", text: tx("hud.pause"), act: pauseGame });
  const tap = (b: Btn, width: number | null): void => {
    const s: ui.Style = width != null ? { width } : {};
    if (ui.style("btn", "btn-hud", s).id(b.id).button(b.text)) { b.act(); ui.setFocus(null); }
  };
  let camRect = { ...pf };
  if (L.shortLand) {
    const colW = Math.min(pf.w * 0.4, Math.max(...items.map((b) => buttonWidth(b.text, ["btn", "btn-hud"]))));
    const r = ui.place("tray", { anchor: "top-start", x: pf.x + pf.w - colW - 6.4, y: pf.y + pf.h / 2 - (lastHeight.get("tray") ?? 200) / 2 }, () => {
      ui.column("tray-col", () => { for (const b of items) tap(b, colW); }, { spacing: 8, width: colW });
    });
    lastHeight.set("tray", r.height / L.sc);
    trayH = 0;
    camRect = { ...pf, w: Math.max(1, pf.w - colW - 12) };
  } else {
    const avail = pf.w - 16;
    let rows: Btn[][];
    let width: number | null = null;
    if (L.portrait) {
      // phones: three to a row across the thumb zone
      width = Math.floor((avail - 2 * 8) / 3);
      rows = [items.slice(0, 3), items.slice(3)];
    } else {
      rows = [[]];
      let used = 0;
      for (const b of items) {
        const bw = buttonWidth(b.text, ["btn", "btn-hud"]);
        if (rows[rows.length - 1]!.length && used + 8 + bw > avail) { rows.push([]); used = 0; }
        used += (rows[rows.length - 1]!.length ? 8 : 0) + bw;
        rows[rows.length - 1]!.push(b);
      }
    }
    const h = lastHeight.get("tray") ?? 52;
    const r = ui.place("tray", { anchor: "top-start", x: pf.x + 8, y: pf.y + pf.h - h - 9.6 }, () => {
      ui.column("tray-col", () => {
        rows.forEach((row, i) => ui.row(`tray-${i}`, () => { for (const b of row) tap(b, width); }, { spacing: 8 }));
      }, { spacing: 8, align: "center", width: avail });
    });
    lastHeight.set("tray", r.height / L.sc);
    trayH = r.height / L.sc + 9.6;
    camRect = { ...pf, h: Math.max(1, pf.h - trayH) };
  }

  // --- banner, caption line
  if (app.banner) {
    ui.place("banner", { anchor: "top-start", x: pf.x, y: pf.y + pf.h * 0.12 }, () => {
      ui.style("banner").label(app.banner!.text);
    }, { width: pf.w, align: "center" });
  }
  if (app.caption) {
    const w = Math.min(pf.w * 0.9, 480);
    ui.place("caption", { anchor: "top-start", x: pf.x + (pf.w - w) / 2, y: pf.y + pf.h - trayH - 16 - toastH - 34 }, () => {
      para(app.caption!.text, w - 22, "caption-line", "caption-text");
    }, { width: w, align: "center" });
  }

  // --- compact: the rails as drawers from the header buttons
  if (compact && app.drawer && !app.screen) {
    const w = Math.min(300, L.lw * 0.84);
    const left = app.drawer === "left";
    const fromLeft = left !== leftHanded;
    rail("drawer", fromLeft ? 0 : L.lw - w, topH, w, railH, "rail-drawer", () => (left ? objectiveRail(w - 25.6, st) : stationsRail(w - 25.6, st)));
  }

  // --- the room in what is left
  const f = frame();
  const toNdcX = (lx: number): number => ((L.ox + lx * L.sc) / f.width) * 2 - 1;
  const toNdcY = (ly: number): number => 1 - ((L.oy + ly * L.sc) / f.height) * 2;
  render.frameRoom({ x0: toNdcX(camRect.x), x1: toNdcX(camRect.x + camRect.w), y0: toNdcY(camRect.y + camRect.h), y1: toNdcY(camRect.y) }, f.width / Math.max(1, f.height));
}

/** A rail (or drawer): a fixed column at x, y; its content scrolls when taller. */
function rail(key: string, x: number, y: number, w: number, h: number, cls: string, build: () => void): void {
  const inner = lastHeight.get(key) ?? 0;
  ui.place(key, { anchor: "top-start", x, y }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-body`, build, { spacing: 9.6, width: w - 25.6 });
      lastHeight.set(key, r.height / ui.preferences().scale);
    };
    if (inner > h - 25.6) ui.scrollArea(`${key}-scroll`, { width: w - 12.8, height: h - 25.6 }, body);
    else body();
  }, { style: cls, width: w, height: h });
}

function objectiveRail(w: number, st: State): void {
  const g = game!, cfg = g.cfg;
  ui.style("rail-h").label(t("rail.objective"));
  ui.column("objective", () => {
    para(cfg.goal > 0 ? t("obj.goal", { earned: st.earned, goal: cfg.goal }) : t("obj.earned", { n: st.earned }), w - 25.6, "objective-big", "obj-big");
    para(t("obj.seed", { name: cfgName(cfg), seed: (cfg.seed >>> 0).toString(36) }), w - 25.6, "mini", "obj-seed");
  }, { style: "objective", width: w, spacing: 2 });
  const frac = cfg.goal > 0 ? Math.min(1, st.earned / cfg.goal) : 0;
  ui.stack("progress", () => {
    ui.column("progress-fill", () => undefined, { style: "progress-fill", width: Math.max(frac > 0 ? 8 : 0, w * frac), height: 8 });
  }, { style: "progress-track", width: w, height: 8, align: "start" });
  ui.style("rail-h").label(t("rail.hint"));
  para(hintText(Rules.hint(st)), w, "hint-line", "hint-line");
  if (g.lesson && g.lesson.steps[g.lesson.step]) {
    ui.column("lesson-step", () => {
      para(t("lesson.prefix", { title: t("l." + g.lesson!.id, null, g.lesson!.title) }), w - 24, "lesson-strong", "lesson-title");
      para(lessonStepText(), w - 24, "lesson-text", "lesson-text");
    }, { style: "lesson-step", width: w, spacing: 2 });
  }
}

function guestStatus(state: State, table: Table): { label: string; cls: string } {
  if (!table.open) return { label: t("st.walled"), cls: "closed" };
  if (table.guestId == null && table.reservedBy == null) return { label: t("st.free"), cls: "free" };
  for (const g of state.guests) {
    if (g.tableId !== table.id) continue;
    if (g.status === "eating") return { label: t("st.eating"), cls: "eating" };
    if (g.status === "seated") return { label: t("st.waiting", { s: Math.ceil(g.patience / 10) }), cls: g.patience / g.maxPatience < 0.3 ? "urgent" : "waiting" };
    return { label: t("st.seating"), cls: "free" };
  }
  return { label: t("st.free"), cls: "free" };
}

function stationsRail(w: number, st: State): void {
  const p = st.waiters[0]!;
  ui.style("rail-h").label(t("rail.stations"));
  para(t("m.tray", { c: p.carrying, cap: p.capacity, s: st.stock }), w, "mirror-tray", "mirror-tray");
  const queue = st.guests.filter((g) => g.status === "queue").length;
  para(t(queue === 1 ? "m.door1" : "m.doorN", { n: queue }), w, "mini", "mirror-door");
  ui.column("stations", () => {
    for (const table of st.tables) {
      if (!table.open) continue;
      const s = guestStatus(st, table);
      const serve = s.cls === "waiting" || s.cls === "urgent";
      const label = t("m.table", { n: table.id + 1, status: s.label });
      const bw = serve ? buttonWidth(t("m.serve"), ["btn", "btn-small"]) : 0;
      ui.row(`station-${table.id}`, () => {
        para(label, w - 22 - bw - 8, s.cls === "urgent" ? "station-label-urgent" : "station-label", `station-${table.id}-l`);
        if (serve && ui.style("btn", "btn-small").id(`serve-${table.id}`).button(t("m.serve"), { tooltip: t("m.serveAria", { n: table.id + 1 }) })) serveTable(table.id);
      }, { style: "station-" + s.cls, width: w, justify: "space-between", align: "center", spacing: 8 });
    }
    const canPick = st.stock > 0 && p.carrying < p.capacity;
    const pw = buttonWidth(t("m.pickup"), ["btn", "btn-small"]);
    ui.row("station-kitchen", () => {
      para(t("m.kitchen", { n: st.stock }), w - 22 - pw - 8, "station-label", "station-kitchen-l");
      if (ui.style("btn", "btn-small").id("mirror-pickup").button(t("m.pickup"), { disabled: !canPick })) dispatch({ type: "pickup" });
    }, { style: "station", width: w, justify: "space-between", align: "center", spacing: 8 });
  }, { spacing: 5.6, width: w });
  ui.style("rail-h").label(t("rail.upgrades"));
  const items = (["capacity", "helper", "stove", "expand"] as Item[]).filter((i) => st.cfg.mechanics[i]);
  const cellW = (w - 6.4) / 2;
  ui.grid("upgrades", () => {
    for (const item of items) {
      const info = Rules.buyInfo(st, item);
      const label = buyLabel(item);
      const cost = info.ok ? info.cost + "c" : info.reason === "cap-reached" ? t("buy.max") : info.cost != null ? info.cost + "c" : "—";
      const clicked = ui.style("btn", "btn-upgrade", { width: cellW }).id(`buy-${item}`).button(`${label} ${cost}`, {
        disabled: !info.ok,
        content: () => {
          ui.column(`buy-${item}-face`, () => {
            if (textWidth(label, "text") <= cellW - 12) ui.label(label, { size: 13.6 }); else ui.paragraph(label, cellW - 12, { size: 13.6 });
            ui.style("cost").label(cost);
          }, { align: "center", spacing: 0 });
        },
      });
      if (clicked) dispatch({ type: "buy", item });
    }
  }, { columns: 2, gap: 6.4, width: w });
}

// ------------------------------------------------------------------ screens
function accountLine(): string {
  if (app.signedOut) return t("acct.signedOut");
  const name = platform.displayName();
  if (!name) return t("acct.offline");
  const s = platform.syncState();
  return t("acct.playingAs", { name }) + " · " + (s === "error" ? t("acct.syncOff") : s === "saving" ? t("acct.saving") : t("acct.synced"));
}

function titleScreen(L: Layout): void {
  screen("title", L, (w) => {
    ui.column("title-hero", () => {
      if (!L.shortLand) art(keyArt, "key-art", Math.min(w, L.lh < 560 ? 300 : 560), 1200 / 672);
      ui.style("logo", L.shortLand || L.portrait ? "logo-compact" : null).label("Bistro Builder");
      para(t("title.tagline"), Math.min(w, 46 * 8.5), "tagline", "tagline", true);
    }, { align: "center", spacing: 8, width: w });
    button({ id: "btn-play", text: t("title.play"), style: ["btn", "btn-primary", "btn-big"], act: () => showScreen("modes") });
    flow("title-menu", [
      { id: "btn-daily", text: t("menu.daily"), act: () => showScreen("daily") },
      { id: "btn-journey", text: t("menu.journey"), act: () => showScreen("journey") },
      { id: "btn-profile", text: t("menu.profile"), act: () => showScreen("profile") },
      { id: "btn-leaderboard", text: t("menu.leaderboard"), act: () => showScreen("leaderboard") },
      { id: "btn-settings", text: t("menu.settings"), act: () => showScreen("settings") },
      { id: "btn-help", text: t("menu.help"), act: () => showScreen("help") },
    ], w, "center");
    para(accountLine(), w, "mini", "account-line", true);
    const account: Btn[] = [];
    if (!platform.signedIn()) account.push({ id: "btn-sign-in", text: t("acct.signIn"), act: () => { void requestSignIn().catch(() => undefined); } });
    const link = platform.inviteLink();
    if (link) {
      account.push({
        id: "btn-invite", text: t("acct.invite"),
        act: () => { try { clipboard.writeText(link); toast(t("acct.inviteCopied")); } catch { toast(`${t("acct.inviteFailed")} ${link}`); } },
      });
    }
    if (account.length) flow("title-account", account, w, "center");
    if (Object.keys(platform.progress.tutorialDone).length < 5) para(t("title.newTip"), w, "mini", "title-tip", true);
  }, cw(L, 720), L.shortLand ? 8 : 12, "center");
}

/** A card button: a title, a description and an optional meta line. */
function card(id: string, title: string, desc: string, meta: string, w: number, act: () => void): void {
  const inner = w - 34;
  const clicked = ui.style("card", { width: w }).id(id).button(title, {
    content: () => {
      ui.column(`${id}-face`, () => {
        para(title, inner, "card-title");
        if (desc) ui.style("card-desc").paragraph(desc, inner);
        if (meta) para(meta, inner, "card-meta");
      }, { spacing: 3, width: inner });
    },
  });
  if (clicked) act();
}

function modesScreen(L: Layout): void {
  screen("modes", L, (w) => {
    heading(t("modes.title"));
    for (const [id, ranked] of [["learn", false], ["journey", false], ["daily", true], ["practice", false], ["challenge", true]] as [ScreenName, boolean][]) {
      card(`mode-${id}`, t("mode." + id), t("mode." + id + ".d"), t("mode." + id + ".dur") + "   " + tx(ranked ? "mode.ranked" : "mode.casual"), w, () => showScreen(id));
    }
    backBtn("btn-modes-back", t("back"), back);
  });
}
const toModes = (): void => showScreen("modes");

function learnScreen(L: Layout): void {
  screen("learn", L, (w) => {
    heading(t("learn.title"));
    for (const l of Content.LESSONS) {
      const done = platform.progress.tutorialDone[l.id];
      card(`lesson-${l.id}`, (done ? "✓ " : "") + t("l." + l.id, null, l.title), t("lx." + l.id, null, l.text), "", w, () => startGame(l.cfg, "learn", l));
    }
    backBtn("btn-learn-back", t("back.modes"), toModes);
  });
}

function journeyScreen(L: Layout): void {
  const p = platform.progress;
  screen("journey", L, (w) => {
    heading(t("journey.title"));
    para(t("journey.done", { n: Object.keys(p.journeyStars).length }), w, "mini", "journey-done");
    const cols = Math.max(1, Math.floor((w + 8) / (76 + 8)));
    const cell = (w - 8 * (cols - 1)) / cols;
    ui.grid("level-grid", () => {
      Content.JOURNEY.forEach((cfg, i) => {
        const stars = p.journeyStars[cfg.id] ?? 0;
        const unlocked = i === 0 || (p.journeyStars[Content.JOURNEY[i - 1]!.id] ?? 0) > 0;
        const mastery = /[05]$/.test(cfg.id);
        const name = t(unlocked ? "jcell.aria" : "jcell.locked", { n: i + 1, name: cfgName(cfg), stars });
        const clicked = ui.style("level-cell", mastery ? "level-mastery" : null, { width: cell, height: Math.min(cell, 96) }).id(`stage-${i + 1}`).button(name, {
          disabled: !unlocked,
          tooltip: t("jcell.title", { name: cfgName(cfg), goal: cfg.goal }),
          content: () => {
            ui.column(`stage-${i + 1}-face`, () => {
              ui.style("level-num").label(String(i + 1));
              ui.style("level-stars").label("★★★".slice(0, stars) + "☆☆☆".slice(0, 3 - stars));
            }, { align: "center", spacing: 2 });
          },
        });
        if (clicked) startGame(cfg, "journey");
      });
    }, { columns: cols, gap: 8, width: w, align: "center" });
    backBtn("btn-journey-back", t("back.modes"), toModes);
  });
}

function practiceScreen(L: Layout): void {
  screen("practice", L, (w) => {
    heading(t("practice.title"));
    para(t("practice.desc"), w, "card-desc", "practice-desc");
    for (const [key, d] of Object.entries(Content.PRACTICE)) {
      card(`practice-${key}`, t("pd." + key, null, d.name),
        t("practice.line", { a: d.spawnSec[0], b: d.spawnSec[1], c: d.patienceSec[0], d: d.patienceSec[1], day: d.daySec }), "", w, () => startPractice(key));
    }
    backBtn("btn-practice-back", t("back.modes"), toModes);
  });
}

function challengeScreen(L: Layout): void {
  screen("challenge", L, (w) => {
    heading(t("challenge.title"));
    para(t("challenge.desc"), w, "card-desc", "challenge-desc");
    for (const cfg of Content.CHALLENGES) {
      const best = platform.progress.challengeBest[cfg.id];
      const cid = String(cfg.id).replace(/^challenge-/, "");
      card(`challenge-${cid}`, cfgName(cfg), t("chd." + cid, null, cfg.desc) + t("challenge.goal", { goal: cfg.goal, sec: cfg.daySec }),
        best != null ? t("challenge.best", { n: best }) : t("challenge.none"), w, () => startGame(cfg, "challenge"));
    }
    backBtn("btn-challenge-back", t("back.modes"), toModes);
  });
}

function facts(label: string, rows: [string, string][], w: number): void {
  ui.column(label, () => {
    rows.forEach(([k, v], i) => {
      ui.row(`${label}-${i}`, () => {
        ui.style("fact-key").label(k + ":");
        para(v, w - textWidth(k + ":", "fact-key") - 8, "text");
      }, { style: "fact", width: w, spacing: 6, align: "start" });
    });
  }, { width: w });
}

let dailyCfg: Cfg | null = null;
function dailyScreen(L: Layout): void {
  const date = utcDate();
  if (!dailyCfg || dailyCfg.date !== date) dailyCfg = Content.dailyCfg(date);
  const cfg = dailyCfg;
  const done = platform.progress.dailiesDone[cfg.date!];
  screen("daily", L, (w) => {
    heading(t("daily.title"));
    para(t("daily.desc"), w, "card-desc", "daily-desc");
    facts("daily-facts", [
      [t("daily.goal"), t("daily.goalV", { n: cfg.goal })], [t("daily.service"), t("daily.serviceV", { n: cfg.daySec })],
      [t("daily.tables"), t("daily.tablesV", { open: cfg.openTables, closed: cfg.closedTables })],
      [t("daily.guests"), t("daily.guestsV", { a: cfg.spawnSec[0], b: cfg.spawnSec[1] })],
      [t("daily.ranked"), t("daily.rankedV")],
    ], w);
    if (done != null) para(t("daily.done", { n: done }), w, "mini", "daily-done");
    button({ id: "btn-daily-start", text: t(done != null ? "daily.replay" : "daily.start"), style: ["btn", "btn-primary", "btn-big"], act: () => startGame(cfg, "daily") }, Math.min(w, buttonWidth(t(done != null ? "daily.replay" : "daily.start"), ["btn", "btn-primary", "btn-big"])));
    backBtn("btn-daily-back", t("back.modes"), toModes);
  });
}

function settingsScreen(L: Layout): void {
  screen("settings", L, (w) => {
    heading(t("settings.title"));
    const check = (key: string, label: string): void => {
      ui.row(`row-${key}`, () => {
        const cur = !!settings[key];
        const next = ui.id(`set-${key}`).checkbox(label, cur);
        if (next !== cur) platform.setSetting(key, next);
      }, { style: "setting-row", width: w, align: "center" });
    };
    const select = (key: string, label: string, options: [unknown, string][]): void => {
      ui.row(`row-${key}`, () => {
        para(label, w * 0.5, "setting-label");
        ui.spacer();
        const idx = Math.max(0, options.findIndex(([v]) => v === settings[key]));
        const next = ui.id(`set-${key}`).select(label, idx, options.map(([, l]) => l));
        if (next !== idx) platform.setSetting(key, options[next]![0]);
      }, { style: "setting-row", width: w, align: "center", spacing: 8 });
    };
    heading(t("set.audio"), "screen-h3");
    check("captions", t("set.captions"));
    heading(t("set.display"), "screen-h3");
    select("theme", t("set.theme"), Object.keys(Content.THEMES).map((k) => [k, t("theme." + k, null, Content.THEMES[k]!.name)]));
    select("colorPalette", t("set.palette"), [["standard", t("pal.standard")], ["high-visibility", t("pal.hv")]]);
    heading(t("set.controls"), "screen-h3");
    check("leftHanded", t("set.left"));
    check("boardMirror", t("set.mirror"));
    check("haptics", t("set.haptics"));
    select("speed", t("set.speed"), [[1, t("speed.1")], [2, t("speed.2")]]);
    // Sound, graphics, language, controls and accessibility are the runtime's Options.
    button({ id: "btn-options", text: t("set.options"), act: () => openMenu() }, Math.min(w, buttonWidth(t("set.options"), PLAIN)));
    backBtn("btn-settings-back", t("back"), backToContext);
  });
}

function helpScreen(L: Layout): void {
  const cards: [string, string][] = [
    [t("help.loop"), t("help.loop.x")],
    [t("help.serving"), t("help.serving.x")],
    [t("help.spending"), t("help.spending.x")],
    [t("help.goal"), t("help.goal.x")],
    [t("help.keyboard"), keysText() + t("help.keysTail") + t("help.pad")],
    [t("help.fair"), t("help.fair.x")],
  ];
  screen("help", L, (w) => {
    heading(t("help.title"));
    cards.forEach(([title, text], i) => {
      ui.column(`help-${i}`, () => {
        ui.style("help-h").label(title);
        ui.style("help-p").paragraph(text, w - 34);
      }, { style: "help-card", width: w, spacing: 5 });
    });
    backBtn("btn-help-back", t("back"), backToContext);
  });
}

function profileScreen(L: Layout): void {
  const p = platform.progress;
  const s = p.stats;
  screen("profile", L, (w) => {
    heading(t("profile.title"));
    facts("profile-facts", [
      [t("pf.rounds"), String(s.rounds)], [t("pf.wins"), String(s.wins)], [t("pf.served"), String(s.served)], [t("pf.lost"), String(s.lost)],
      [t("pf.hires"), String(s.hires)], [t("pf.expansions"), String(s.expansions)], [t("pf.best"), String(s.bestScore)],
      [t("pf.time"), t("pf.min", { n: Math.round(s.playMs / 60000) })],
    ], w);
    heading(t("profile.ach"), "screen-h3");
    ui.column("achievements", () => {
      for (const a of Store.ACHIEVEMENTS) {
        const got = !!p.achievements[a.key];
        ui.column(`ach-${a.key}`, () => {
          para(t("ach." + a.key, null, a.name), w, "ach-name");
          para(t("ach." + a.key + ".d", null, a.desc), w, "card-desc");
        }, { style: got ? "ach" : "ach-locked", width: w, spacing: 2 });
      }
    }, { width: w });
    if (app.confirmReset) {
      para(t("profile.confirm"), w, "text", "profile-confirm");
      flow("profile-confirm-row", [
        { id: "btn-reset-yes", text: t("profile.yes"), style: ["btn", "btn-primary"], act: () => { platform.resetAll(); showScreen("title"); } },
        { id: "btn-reset-no", text: t("profile.no"), act: () => { app.confirmReset = false; } },
      ], w);
    } else {
      flow("profile-row", [
        { id: "btn-reset", text: t("profile.reset"), act: () => { app.confirmReset = true; ui.setFocus(t("profile.no")); } },
        { id: "btn-replay", text: t("profile.replay"), act: () => showScreen("learn") },
      ], w);
    }
    backBtn("btn-profile-back", t("back"), back);
  });
}

interface BoardRow { name: string; score: number; you: boolean; date: string }
function boardTable(label: string, entries: BoardEntry[], rivals: { name: string; score: number }[], title: string, w: number): void {
  if (title) heading(title, "screen-h3");
  const rows: BoardRow[] = entries.map((e) => ({
    name: e.you || !e.name || e.name === "You" ? (e.playerId && platform.signedIn() ? platform.nameFor(e.playerId) : t("lb.you")) : e.name,
    score: e.score, you: !!e.you, date: e.date ?? "",
  })).concat(rivals.map((r) => ({ name: t("lb.regular", { name: r.name }), score: r.score, you: false, date: "" })));
  rows.sort((a, b) => b.score - a.score);
  if (!rows.length) { para(t("lb.empty"), w, "mini", `${label}-empty`); return; }
  ui.grid(`${label}-grid`, () => {
    for (const h of ["#", t("lb.name"), t("lb.score"), t("lb.when")]) ui.style("lb-th").label(h);
    rows.slice(0, 12).forEach((r, i) => {
      const cls = r.you ? "lb-you" : "lb-td";
      ui.style(cls).label(String(i + 1));
      ui.style(cls).label(r.name);
      ui.style(cls).label(String(r.score));
      ui.style(cls).label(r.date);
    });
  }, { columns: ["auto", { fr: 1 }, "auto", "auto"], gap: 0, width: w, rowStyle: "lb-row" });
  if (rivals.length) para(t("lb.regulars"), w, "mini", `${label}-regulars`);
}

function leaderboardScreen(L: Layout): void {
  const daily = Content.dailyCfg(utcDate());
  const local = Store.loadBoards().entries.filter((e) => e.cfgId === daily.id);
  screen("leaderboard", L, (w) => {
    heading(t("lb.title"));
    boardTable("lb-today", local, Content.rivalScores(daily), t("lb.today", { id: daily.id }), w);
    para(t("lb.device"), w, "mini", "lb-device");
    backBtn("btn-lb-back", t("back"), back);
  });
}

function pauseScreen(L: Layout): void {
  const g = game;
  if (!g) { showScreen("title"); return; }
  screen("pause", L, (w) => {
    heading(t("pause.title"));
    para(t("pause.desc", { name: cfgName(g.cfg) }), w, "mini", "pause-desc");
    flow("pause-row", [
      { id: "btn-resume", text: t("pause.resume"), style: ["btn", "btn-primary"], act: resumeGame },
      { id: "btn-pause-settings", text: t("pause.settings"), act: () => showScreen("settings") },
      { id: "btn-pause-help", text: t("pause.help"), act: () => showScreen("help") },
      { id: "btn-leave", text: t("pause.leave"), act: () => { showScreen(null); endGame(); } },
    ], w);
  });
}

function resultsScreen(L: Layout): void {
  const r = app.results;
  if (!r) { showScreen("title"); return; }
  const { term, cfg, mode } = r;
  const win = term.win || mode === "learn";
  const s = term.score;
  screen("results", L, (w) => {
    ui.style(win ? "outcome-win" : "outcome-lose").heading(mode === "learn" ? t("r.lesson") : win ? (term.reason === "goal-reached" ? t("r.goal") : t("r.day")) : t("r.missed"));
    art(win ? winArt : loseArt, "result-art", Math.min(w, L.lh < 560 ? 200 : 360), 640 / 400);
    para(t("r.meta", { name: cfgName(cfg), seed: (cfg.seed >>> 0).toString(36), c: r.envelope.contentVersion, b: r.envelope.build }), w, "mini", "results-meta");
    const rows: [string, string, number][] = [
      [t("r.served"), s.served + " × " + cfg.price + "c", s.servePoints],
      [t("r.tips"), "", s.tips],
      [t("r.time"), "", s.timeBonus],
      [t("r.lost"), s.lost + " × −10", -s.lost * 10],
    ];
    ui.grid("results-table", () => {
      for (const [k, detail, v] of rows) {
        ui.style("res-td").label(k);
        ui.style("res-mini").label(detail);
        ui.style("res-pts").label((v >= 0 ? "+" : "") + v);
      }
      ui.style("res-total").label(t("r.total"));
      ui.style("res-total").label("");
      ui.style("res-total").id("results-total").label(String(s.total));
    }, { columns: [{ fr: 1 }, "auto", { width: "auto", align: "end" }], gap: 0, width: w, rowStyle: "res-row" });
    if (mode === "journey") {
      const stars = starsFor(cfg, term);
      para(t("r.par", { stars: "★★★".slice(0, stars) + "☆☆☆".slice(0, 3 - stars), n: cfg.par?.score ?? 0 }), w, "text", "results-par");
    }
    if (r.unlocked.length) {
      para(tx("r.ach", { list: r.unlocked.map((k) => t("ach." + k, null, Store.ACHIEVEMENTS.find((a) => a.key === k)?.name ?? k)).join(", ") }), w, "text", "results-ach");
    }
    if (mode !== "learn" && platform.signedIn()) {
      const lb = r.lb;
      para(r.posting || !lb ? t("acct.lbPosting") : !lb.posted ? t("acct.lbNotPosted") : lb.rank ? t("acct.lbRank", { rank: lb.rank }) : t("acct.lbPosted"), w, "mini", "results-lb");
    }
    if (cfg.ranked) boardTable("results-board", r.local, Content.rivalScores(cfg), t("lb.compare"), w);
    const row: Btn[] = [{ id: "btn-again", text: t(win ? "r.again" : "r.retry"), style: ["btn", "btn-primary"], act: playAgain }];
    const next = nextStage();
    if (next) row.push({ id: "btn-next", text: t("r.next"), act: () => startGame(next, "journey") });
    row.push({ id: "btn-home", text: t("r.home"), act: () => { app.results = null; showScreen("title"); } });
    flow("results-row", row, w);
  });
}
