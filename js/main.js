/* Bistro Builder — bootstrap + session + screen flow.
 * Owns the fixed-step simulation loop, command dispatch with idempotent
 * command IDs, replay envelopes, undo snapshots, screen state machine,
 * keyboard/touch/gamepad input, persistence, achievements and local boards.
 * Own-server use: only GET /api/v1/time, and only when signed in.
 */
import * as BBRender from './render.js';
import { resolve as resolveGfx, detectPreset } from './gfx.js';
import { buildGraphicsSection } from './gfx-panel.js';
import { accountStrings } from './gfx-strings.js';

(function () {
  'use strict';

  var R = window.BBRules, C = window.BBContent, S = window.BBStore,
      U = window.BBUI, A = window.BBAudio, RNG = window.BBRNG, P = window.BBPlatform;
  // Localized strings (js/i18n.js); the account lines follow the same language.
  var I18N = window.BBI18n;
  function t(key, vars, fallback) { return I18N ? I18N.t(key, vars, fallback) : (fallback != null ? fallback : key); }
  function curLang() { return I18N ? I18N.lang : 'en-US'; }
  var ACCOUNT = accountStrings(curLang());
  // Hint text from the rules engine's structured hint (key + values).
  function hintText(h) {
    if (!h) return '';
    var v = h.vars || {};
    if (h.key === 'hint.upgrade') v = { item: U.buyLabel(v.item), n: v.n };
    return h.key ? t(h.key, v, h.text) : h.text;
  }

  var BUILD = '1.0.0';
  var el = U.el;
  var app = document.getElementById('app');

  // ---------- persistent save ----------
  var doc = S.load();
  function persist() { S.save(doc); }
  var settings = doc.settings;

  // ---------- server time (signed in only; standalone uses the local clock) ----------
  var serverOffsetMs = null; // round-trip-adjusted server time offset

  // StarHermit (js/platform.js over starhermit-sdk.js): launch token and
  // renewal, nicknames, cloud save, settings KV, bindings. No requests
  // without a token.
  var profileFor = P.profileFor;
  var signedOutNotice = false;

  function syncServerTime() {
    if (!P.hosted) return Promise.resolve();
    var t0 = Date.now();
    return fetch('/api/v1/time', { headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + P.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        var t = body && (Number(body.now) || Number(body.serverTime) || Number(body.epochMs));
        if (t) serverOffsetMs = t - (t0 + (Date.now() - t0) / 2);
      })
      .catch(function () { /* keep the local clock */ });
  }
  function nowMs() { return Date.now() + (serverOffsetMs || 0); }
  function utcDateStr() { return new Date(nowMs()).toISOString().slice(0, 10); }

  var sessionId = 's-' + RNG.hashString(String(Math.random()) + Date.now()).toString(36);

  // ---------- DOM shell ----------
  var topbar, playfield, railLeft, railRight, hudActions, banner, toast, captionLine, liveRegion;
  var objectiveBox, progressFill, hintLine, lessonStepBox, mirrorBox, upgradeBox;
  var chips = {};

  function buildShell() {
    app.innerHTML = '';
    document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
    document.body.classList.toggle('high-contrast', !!settings.highContrast);
    document.body.classList.toggle('large-text', !!settings.largeText);

    topbar = el('header', 'topbar');
    var h1 = el('h1', null, 'Bistro Builder');
    h1.appendChild(i18nEl(el('span', 'sub'), 'shell.sub'));
    topbar.appendChild(h1);
    ['coins', 'earned', 'clock', 'served'].forEach(function (k) {
      chips[k] = el('span', 'stat-chip', '—');
      topbar.appendChild(chips[k]);
    });
    topbar.appendChild(el('span', 'spacer'));
    var btnLeft = el('button', 'btn icon drawer-btn', '📋');
    btnLeft.type = 'button'; i18nAria(btnLeft, 'aria.objectivePanel');
    btnLeft.addEventListener('click', function () { railLeft.classList.toggle('open'); railRight.classList.remove('open'); });
    var btnRight = el('button', 'btn icon drawer-btn', '🍽');
    btnRight.type = 'button'; i18nAria(btnRight, 'aria.stationsPanel');
    btnRight.addEventListener('click', function () { railRight.classList.toggle('open'); railLeft.classList.remove('open'); });
    topbar.appendChild(btnLeft); topbar.appendChild(btnRight);
    var btnMenu = el('button', 'btn icon', '☰');
    btnMenu.type = 'button'; i18nAria(btnMenu, 'aria.menu');
    btnMenu.addEventListener('click', function () { if (game && !game.over) pauseGame(true); else showScreen('title'); });
    topbar.appendChild(btnMenu);
    app.appendChild(topbar);

    var stage = el('main', 'stage');
    railLeft = el('aside', 'rail left');
    i18nAria(railLeft, 'aria.objectiveRail');
    railLeft.appendChild(i18nEl(el('h2'), 'rail.objective'));
    objectiveBox = el('div', 'objective');
    railLeft.appendChild(objectiveBox);
    var pb = el('div', 'progress-bar'); progressFill = el('div'); pb.appendChild(progressFill);
    railLeft.appendChild(pb);
    railLeft.appendChild(i18nEl(el('h2'), 'rail.hint'));
    hintLine = el('div', 'hint-line');
    railLeft.appendChild(hintLine);
    lessonStepBox = el('div');
    railLeft.appendChild(lessonStepBox);
    stage.appendChild(railLeft);

    playfield = el('section', 'playfield');
    i18nAria(playfield, 'aria.playfield');
    stage.appendChild(playfield);

    railRight = el('aside', 'rail right');
    i18nAria(railRight, 'aria.stationsRail');
    railRight.appendChild(i18nEl(el('h2'), 'rail.stations'));
    mirrorBox = el('div');
    railRight.appendChild(mirrorBox);
    railRight.appendChild(i18nEl(el('h2'), 'rail.upgrades'));
    upgradeBox = el('div', 'upgrade-panel');
    railRight.appendChild(upgradeBox);
    stage.appendChild(railRight);
    app.appendChild(stage);

    hudActions = el('div', 'hud-actions');
    hudActions.setAttribute('role', 'toolbar');
    i18nAria(hudActions, 'aria.hud');
    playfield.appendChild(hudActions);

    banner = el('div', 'banner'); banner.style.display = 'none'; playfield.appendChild(banner);
    toast = el('div', 'toast'); toast.style.display = 'none'; playfield.appendChild(toast);
    captionLine = el('div', 'caption-line'); captionLine.style.display = 'none'; playfield.appendChild(captionLine);
    liveRegion = el('div', 'sr-only');
    liveRegion.setAttribute('aria-live', 'polite');
    app.appendChild(liveRegion);
  }

  // Static shell text carries data-i18n / data-i18n-aria and is re-applied on a language change.
  function i18nEl(node, key) { node.textContent = t(key); node.setAttribute('data-i18n', key); return node; }
  function i18nAria(node, key) { node.setAttribute('aria-label', t(key)); node.setAttribute('data-i18n-aria', key); return node; }

  function announce(text) { liveRegion.textContent = text; }
  var toastTimer = null;
  function showToast(text, invalid) {
    // While a screen (title, pause, results…) is open the toast floats above it from #app;
    // inside the playfield it would sit under the screen's dark overlay.
    var over = !!screenEl;
    var host = over ? app : playfield;
    if (toast.parentNode !== host) host.appendChild(toast);
    toast.textContent = text;
    toast.className = 'toast' + (invalid ? ' invalid' : '') + (over ? ' over-screen' : '');
    toast.style.display = '';
    syncToastH();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.style.display = 'none'; syncToastH(); }, 2600);
    if (invalid) announce(t('invalid.announce', { text: text }));
  }
  // Screens pad their bottom by the floating toast's height (layout px; both are zoomed alike)
  // so their last buttons can always be scrolled clear of it.
  function syncToastH() {
    var on = toast.style.display !== 'none' && toast.classList.contains('over-screen');
    app.style.setProperty('--toast-h', on ? (toast.offsetHeight + 12) + 'px' : '0px');
  }
  function showBanner(text, ms) {
    banner.textContent = text; banner.style.display = '';
    setTimeout(function () { banner.style.display = 'none'; }, ms || 1400);
  }

  // ---------- renderer ----------
  var view = null;
  function ensureView() {
    if (view) return true;
    var g0 = gfxResolved();
    view = BBRender.create(playfield, {
      antialias: g0.antialias === 'msaa' && !g0.post,
      onCanvas: function (c) { c.addEventListener('pointerdown', onPointerDown); }
    });
    if (!view) {
      var fb = i18nEl(el('div', 'canvas-fallback'), 'canvas.fallback');
      playfield.appendChild(fb);
      return false;
    }
    gpuName = view.graphicsInfo().gpu || gpuName;
    applyGraphics();
    return true;
  }

  // ---------- graphics quality (js/gfx.js) ----------
  var gpuName = null;
  function isMobile() {
    var coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    return coarse || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }
  function detectedPreset() {
    if (gpuName == null) gpuName = BBRender.probeGpu();
    return detectPreset(gpuName, isMobile());
  }
  function gfxResolved() { return resolveGfx(settings.gfx, detectedPreset()); }
  function fpsMeter(on) {
    var m = document.getElementById('fps-meter');
    if (on && !m) {
      m = el('div', null, '… fps');
      m.id = 'fps-meter';
      m.setAttribute('aria-hidden', 'true');
      document.body.appendChild(m);
    }
    if (m) m.hidden = !on;
  }
  // Applies graphics live (no reload); rebuilds the board only when surface
  // detail or particle count changed.
  function applyGraphics(skipRebuild) {
    var r = gfxResolved();
    document.body.setAttribute('data-gfx-preset', r.preset);
    document.body.setAttribute('data-gfx-auto', r.auto ? 'true' : 'false');
    fpsMeter(r.showFps);
    if (!view) return;
    var res = view.setGraphics(r, settings);
    if (res.rebuild && game && !skipRebuild)
      view.build(game.state, C.THEMES[settings.theme] || C.THEMES.ember, game.cfg.seed, settings);
  }
  function graphicsInfo() {
    if (view) return view.graphicsInfo();
    var r = gfxResolved();
    var ratio = Math.min(window.devicePixelRatio || 1, 2) * r.scale;
    var pf = playfield || document.body;
    return { gpu: gpuName, pixels: [Math.round((pf.clientWidth || window.innerWidth) * ratio), Math.round((pf.clientHeight || window.innerHeight) * ratio)], postFailed: false };
  }

  // ---------- session ----------
  var game = null; // {state, cfg, mode, lesson, commands[], hashes[], cmdIds{}, undoStack[], over, paused, lastTickAt, acc, prev, startedAt, invalidCount}
  var rafId = null;

  function startGame(cfg, mode, lesson) {
    closeScreen();
    if (!ensureView()) { /* DOM-only play continues */ }
    var state = R.createGame(cfg);
    game = {
      state: state, cfg: cfg, mode: mode, lesson: lesson || null,
      commands: [], hashes: [{ tick: 0, hash: R.hashState(state) }],
      cmdIds: {}, cmdSeq: 0, undoStack: [], over: false, paused: false,
      acc: 0, lastFrame: performance.now(), prev: null,
      startedAt: nowMs(), invalidCount: 0, speed: Number(settings.speed) || 1,
      replayT0: Date.now()
    };
    A.start();
    A.applySettings(settings);
    A.setCaptions(!!settings.captions, function (text) {
      captionLine.textContent = '♪ ' + (CAPTION_KEYS[text] ? t(CAPTION_KEYS[text]) : text); captionLine.style.display = '';
      clearTimeout(captionLine._t);
      captionLine._t = setTimeout(function () { captionLine.style.display = 'none'; }, 1800);
    });
    A.setAvRng(RNG.derive(cfg.seed >>> 0, RNG.STREAM_AV));
    if (view) {
      view.build(state, C.THEMES[settings.theme] || C.THEMES.ember, cfg.seed, settings);
    }
    buildHudActions();
    updateHud();
    countdownThen(t('banner.start'), function () {});
    if (lesson) renderLessonStep();
    announce(t('an.start', { name: U.cfgName(cfg), goal: cfg.goal > 0 ? t('an.goalCoins', { n: cfg.goal }) : t('an.goalServe') }));
  }

  function countdownThen(text, done) {
    if (game) game.paused = true;
    var seq = ['3', '2', '1', text];
    var i = 0;
    (function next() {
      if (!game) return;
      if (i < seq.length) {
        showBanner(seq[i], i === seq.length - 1 ? 900 : 620);
        A.play(i === seq.length - 1 ? 'service-start' : 'ui'); // hand bell opens service
        i++;
        setTimeout(next, settings.reducedMotion ? 200 : 640);
      } else {
        if (!screenEl) game.paused = false; // a pause menu opened during the countdown stays paused
        game.lastFrame = performance.now();
        done();
      }
    })();
  }

  function dispatch(cmd, silent) {
    if (!game || game.over || game.paused) return { ok: false, reason: 'not-active' };
    var id = 'c' + game.state.tick + '-' + (++game.cmdSeq); // monotonic: survives undo filtering
    if (game.cmdIds[id]) return { ok: false, reason: 'duplicate' };
    var res = R.applyCommand(game.state, cmd);
    if (!res.ok) {
      game.invalidCount++;
      if (!silent) { A.play('invalid'); showToast(invalidText(res.reason), true); }
      return res;
    }
    game.cmdIds[id] = true;
    game.commands.push({ tick: game.state.tick, id: id, cmd: { type: cmd.type, table: cmd.table, item: cmd.item, x: cmd.x, y: cmd.y } });
    if (cmd.type === 'buy' && cmd.item === 'expand') A.play('expand');   // wall comes down
    else if (cmd.type === 'buy' && cmd.item === 'helper') A.play('hire'); // apron on
    else if (cmd.type === 'buy' || cmd.type === 'resign') A.play('buy');
    else A.play('cmd'); // one-input confidence: every committed action gets an ack
    if (game.mode === 'practice' || game.mode === 'learn') pushUndo();
    checkLessonEvent(cmd);
    updateHud();
    return res;
  }

  function invalidText(reason) { return t('inv.' + reason, null, String(reason)); }

  // audio.js emits English caption ids; the caption line shows them in the game language.
  var CAPTION_KEYS = {
    'order noted': 'cap.cmd', 'guest arrives': 'cap.spawn', 'dish ready': 'cap.dish-ready', 'dishes picked up': 'cap.pickup',
    'guest served': 'cap.serve', 'guest left angry': 'cap.leave-angry', 'upgrade bought': 'cap.buy', 'not allowed': 'cap.invalid',
    'day complete': 'cap.win', 'goal missed': 'cap.lose', 'rewind': 'cap.undo', 'hint': 'cap.hint', 'service begins': 'cap.service-start',
    'wall knocked down': 'cap.expand', 'guest losing patience': 'cap.urgent', 'helper hired': 'cap.hire'
  };

  // Undo (practice/learn only, where rules permit): one snapshot per second.
  function pushUndo() {
    if (!game.cfg.mechanics.undo) return;
    game.undoStack.push(R.serialize(game.state));
    if (game.undoStack.length > 120) game.undoStack.shift();
  }
  function undo() {
    if (!game || !game.cfg.mechanics.undo || !game.undoStack.length) {
      if (game) showToast(t(game.cfg.mechanics.undo ? 'undo.none' : 'undo.na'), true);
      return;
    }
    var json = game.undoStack.pop();
    game.state = R.deserialize(json);
    game.prev = null; // positions jumped: no interpolation from the old timeline
    game.commands = game.commands.filter(function (c) { return c.tick <= game.state.tick; });
    // The restored state's cfg is a fresh object, so the renderer's identity
    // check would reject every sync — rebuild the scene from the snapshot.
    if (view) view.build(game.state, C.THEMES[settings.theme] || C.THEMES.ember, game.cfg.seed, settings);
    A.play('undo');
    showToast(t('undo.done'));
    updateHud();
  }

  // ---------- lessons ----------
  function lessonIndex() { return game && game.lesson ? game.lesson._step || 0 : 0; }
  function renderLessonStep(quiet) {
    lessonStepBox.innerHTML = '';
    if (!game || !game.lesson) return;
    var step = game.lesson.steps[lessonIndex()];
    if (!step) return;
    var d = el('div', 'lesson-step');
    var stepText = t('ls.' + game.lesson.id + '.' + lessonIndex(), null, step.text);
    d.appendChild(el('strong', null, t('lesson.prefix', { title: t('l.' + game.lesson.id, null, game.lesson.title) })));
    d.appendChild(document.createTextNode(stepText));
    lessonStepBox.appendChild(d);
    if (!quiet) announce(t('an.lessonStep', { text: stepText }));
  }
  function checkLessonEvent(cmd) {
    if (!game || !game.lesson) return;
    var step = game.lesson.steps[lessonIndex()];
    if (!step) return;
    if (step.event === 'buy' && cmd.type === 'buy' && cmd.item === step.item) advanceLesson();
    // Any successful serve advances a serve step: enforcing a strict table order
    // soft-locks the lesson if the player serves the patient guest first.
    else if (step.event === 'serve' && cmd.type === 'serve') {
      game.lesson._pendingServe = true; // confirm on event
    } else if (step.event === 'pickup' && cmd.type === 'pickup') game.lesson._pendingPickup = true;
  }
  function advanceLesson() {
    game.lesson._step = lessonIndex() + 1;
    A.play('dish-ready');
    if (game.lesson._step >= game.lesson.steps.length) {
      showBanner(t('banner.lessonDone'));
      doc.progress.tutorialDone[game.lesson.id] = true;
      persist();
      setTimeout(function () { if (game && game.lesson) endGame('lesson-complete'); }, 900);
    } else renderLessonStep();
  }

  // ---------- loop ----------
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!game) return;
    var dt = Math.min(250, now - game.lastFrame);
    game.lastFrame = now;
    if (!game.paused && !game.over) {
      game.acc += dt * game.speed;
      var steps = 0;
      while (game.acc >= R.TICK_MS && steps < 40) {
        game.prev = cloneLite(game.state);
        R.step(game.state);
        drainEvents();
        game.acc -= R.TICK_MS;
        steps++;
        if (game.state.tick % 50 === 0)
          game.hashes.push({ tick: game.state.tick, hash: R.hashState(game.state) });
        if (game.state.terminal) { onTerminal(); break; }
      }
      if (steps) { updateHud(); checkUrgent(); }
    }
    if (view) {
      var alpha = game.paused || game.over ? 1 : Math.min(1, game.acc / R.TICK_MS);
      view.sync(game.state, game.prev, alpha, settings);
      view.renderFrame(dt / 1000);
    }
    pollGamepad();
  }

  // One warning cue per guest the first time their patience drops under 30%
  // (the same threshold legalActions marks as urgent). Presentation only.
  function checkUrgent() {
    if (!game || game.over) return;
    if (!game.urgentSeen) game.urgentSeen = {};
    var gs = game.state.guests;
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i];
      if (g.status !== 'seated' || game.urgentSeen[g.id]) continue;
      if (g.patience <= g.maxPatience * 0.3) {
        game.urgentSeen[g.id] = true;
        A.play('urgent');
        announce(t('an.urgent', { n: g.tableId + 1 }));
      }
    }
  }

  function cloneLite(state) { // positions only, for interpolation
    return { waiters: state.waiters.map(function (w) { return { id: w.id, x: w.x, y: w.y }; }) };
  }

  function drainEvents() {
    var evs = game.state.events;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.t === 'cmd') continue;
      A.play(e.t);
      if (view && (e.t === 'serve' || e.t === 'win' || e.t === 'lose')) view.event(e.t);
      if (game.lesson) {
        if (e.t === 'serve' && game.lesson._pendingServe) { game.lesson._pendingServe = false; advanceLesson(); }
        if (e.t === 'pickup' && game.lesson._pendingPickup) { game.lesson._pendingPickup = false; advanceLesson(); }
      }
      if (e.t === 'serve') announce(t('an.served', { n: e.pay }));
      if (e.t === 'leave-angry') announce(t('an.angry'));
    }
    evs.length = 0;
  }

  // ---------- HUD ----------
  var hudBtns = {}; // stable refs for the keyboard shortcuts (button order varies by mode)
  function buildHudActions() {
    hudActions.innerHTML = '';
    hudBtns = {};
    function add(label, key, fn, aria) {
      var b = el('button', 'btn', label);
      b.type = 'button';
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      hudActions.appendChild(b);
      hudBtns[key] = b;
      return b;
    }
    add(t('hud.pickup'), 'pickup', function () { dispatch({ type: 'pickup' }); }, t('hud.pickupAria'));
    add(t('hud.hint'), 'hint', function () {
      if (!game) return;
      var h = R.hint(game.state);
      showToast(hintText(h));
      A.play('hint');
      if (view && h.action && h.action.type === 'serve') view.setHighlights(['table:' + h.action.table]);
    }, t('hud.hintAria'));
    if (game.cfg.mechanics.undo) add(t('hud.rewind'), 'undo', undo, t('hud.rewindAria'));
    add(t('hud.speed'), 'speed', function () {
      if (!game) return;
      game.speed = game.speed === 1 ? 2 : 1;
      showToast(t('toast.speed', { n: game.speed }));
    }, t('hud.speedAria'));
    add(t('hud.pause'), 'pause', function () { pauseGame(true); }, t('hud.pauseAria'));
  }

  function updateHud() {
    if (!game) return;
    var st = game.state, cfg = game.cfg;
    chips.coins.innerHTML = esc(t('chip.coins')) + ' <strong>' + st.coins + '</strong>';
    chips.earned.innerHTML = esc(t('chip.earned')) + ' <strong>' + st.earned + '</strong>' + (cfg.goal > 0 ? '/' + cfg.goal : '');
    chips.earned.classList.toggle('goal-met', cfg.goal > 0 && st.earned >= cfg.goal);
    var remain = Math.max(0, (st.dayTicks - st.tick) * R.TICK_MS);
    chips.clock.textContent = '⏱ ' + U.fmtClock(remain);
    chips.clock.classList.toggle('low', remain < 30000);
    chips.served.innerHTML = esc(t('chip.served')) + ' <strong>' + st.score.served + '</strong>';

    objectiveBox.innerHTML = '';
    objectiveBox.appendChild(el('div', 'big', cfg.goal > 0 ? t('obj.goal', { earned: st.earned, goal: cfg.goal }) : t('obj.earned', { n: st.earned })));
    objectiveBox.appendChild(el('div', 'mini', t('obj.seed', { name: U.cfgName(cfg), seed: (cfg.seed >>> 0).toString(36) })));
    progressFill.style.width = cfg.goal > 0 ? Math.min(100, (st.earned / cfg.goal) * 100) + '%' : '0%';

    var h = R.hint(st);
    hintLine.textContent = hintText(h);

    U.updateStationsMirror(mirrorBox, st, { onAction: dispatch });
    U.updateUpgradePanel(upgradeBox, st, R.buyInfo, { onAction: dispatch });

    if (view) {
      var legal = R.legalActions(st).map(function (a) { return a.type === 'serve' ? 'table:' + a.table : a.type; });
      view.setHighlights(legal);
    }
  }

  // ---------- terminal / results ----------
  function onTerminal() {
    if (game.over) return;
    game.over = true;
    var st = game.state, t = st.terminal;
    game.hashes.push({ tick: st.tick, hash: R.hashState(st) });
    A.play(t.win ? 'win' : 'lose');

    // progression
    var p = doc.progress;
    p.stats.rounds++;
    p.stats.served += st.score.served;
    p.stats.lost += st.score.lost;
    p.stats.hires += st.score.helpers;
    p.stats.expansions += st.score.expansions;
    p.stats.playMs += st.tick * R.TICK_MS;
    if (t.win) p.stats.wins++;
    if (st.score.total > p.stats.bestScore) p.stats.bestScore = st.score.total;

    if (game.mode === 'journey') {
      var stars = U.starsFor(game.cfg, t);
      if (stars > (p.journeyStars[game.cfg.id] || 0)) p.journeyStars[game.cfg.id] = stars;
      if (st.score.total > (p.journeyBest[game.cfg.id] || 0)) p.journeyBest[game.cfg.id] = st.score.total;
    } else if (game.mode === 'challenge') {
      if (st.score.total > (p.challengeBest[game.cfg.id] || 0)) p.challengeBest[game.cfg.id] = st.score.total;
    } else if (game.mode === 'daily') {
      var date = game.cfg.date;
      var prevBest = p.dailiesDone[date];
      if (prevBest == null || st.score.total > prevBest) p.dailiesDone[date] = st.score.total;
      if (p.stats.lastDaily !== date) {
        var yesterday = new Date(nowMs() - 86400000).toISOString().slice(0, 10);
        p.stats.dailyStreak = (p.stats.lastDaily === yesterday) ? p.stats.dailyStreak + 1 : 1;
        p.stats.lastDaily = date;
      }
    } else if (game.mode === 'practice') {
      var dkey = game.cfg.id.replace('practice-', '');
      if (st.score.total > (p.practiceBest[dkey] || 0)) p.practiceBest[dkey] = st.score.total;
    }

    var unlocked = checkAchievements(t);
    persist();

    var envelope = {
      v: 1, build: BUILD, contentVersion: C.CONTENT_VERSION,
      cfgId: game.cfg.id, seed: game.cfg.seed >>> 0,
      initialHash: game.hashes[0].hash, t0: game.replayT0,
      commands: game.commands, hashes: game.hashes,
      terminal: { reason: t.reason, win: t.win, tick: t.tick, score: t.score },
      sessionId: sessionId, invalid: game.invalidCount, durationMs: t.elapsedMs
    };
    if (P.userId) envelope.playerId = P.userId; // attach board rows to the account
    if (game.cfg.ranked) submitScore(envelope);

    setTimeout(function () { showResults(t, unlocked, envelope); }, 900);
  }

  function endGame(reason) { // resign or lesson-complete
    if (!game || game.over) return;
    game.paused = false;
    R.applyCommand(game.state, { type: 'resign' });
    if (game.state.terminal) onTerminal();
  }

  function checkAchievements(t) {
    var p = doc.progress, unlocked = [];
    function grant(key) {
      if (!p.achievements[key]) { p.achievements[key] = Date.now(); unlocked.push(key); }
    }
    if (t) grant('first-service');
    if (t && t.win && game.state.score.lost === 0 && game.state.score.served >= 8) grant('full-house');
    if (p.stats.served >= 100) grant('century');
    if (p.stats.hires >= 5) grant('crew-chief');
    var masteries = ['j05', 'j10', 'j15', 'j20', 'j25', 'j30', 'j35', 'j40'];
    if (masteries.every(function (id) { return (p.journeyStars[id] || 0) > 0; })) grant('mastery-row');
    if (Object.keys(p.dailiesDone).length >= 3) grant('regular');
    return unlocked;
  }

  function submitScore(envelope) {
    var entry = {
      name: 'You', you: true, score: envelope.terminal.score.total,
      date: new Date().toISOString().slice(0, 10), sessionId: envelope.sessionId,
      invalid: envelope.invalid, durationMs: envelope.durationMs,
      cfgId: envelope.cfgId
    };
    var boards = S.loadBoards(); // local board (this device)
    boards.entries.push(entry);
    boards.entries = S.sortEntries(boards.entries).slice(0, 100);
    S.saveBoards(boards);
  }

  // ---------- screens ----------
  var screenEl = null;
  function closeScreen() {
    if (screenEl) { screenEl.remove(); screenEl = null; }
  }
  function currentScreenName() { return screenEl ? screenEl.getAttribute('aria-label') : null; }
  function openScreen(buildFn, label) {
    closeScreen();
    screenEl = el('div', 'screen');
    screenEl.setAttribute('role', 'dialog');
    screenEl.setAttribute('aria-label', label);
    var sheet = el('div', 'sheet');
    screenEl.appendChild(sheet);
    buildFn(sheet);
    app.appendChild(screenEl);
    var first = sheet.querySelector('button, [href], input, select');
    // Open at the top (heading visible) even when the first control is below the fold.
    if (first) first.focus({ preventScroll: true });
    screenEl.scrollTop = 0;
  }
  function backRow(sheet, label, fn) {
    var row = el('div', 'row');
    var b = el('button', 'btn', label || t('back'));
    b.type = 'button';
    b.addEventListener('click', fn || function () { showScreen('title'); });
    row.appendChild(b);
    sheet.appendChild(row);
  }
  // Settings/help reached from the pause menu must return to the pause menu,
  // not to the title screen (which would strand the paused round behind it).
  function backToContext(sheet) {
    if (game && !game.over) backRow(sheet, t('back'), function () { pauseGame(true); });
    else backRow(sheet);
  }

  var screens = {
    title: function (sheet) {
      var hero = el('div', 'title-hero');
      var art = el('img', 'key-art');
      art.src = 'assets/key-art.webp'; art.alt = ''; art.decoding = 'async';
      art.addEventListener('error', function () { art.remove(); }); // missing art never breaks the title
      hero.appendChild(art);
      hero.appendChild(el('h2', 'logo', 'Bistro Builder'));
      hero.appendChild(el('p', null, t('title.tagline')));
      sheet.appendChild(hero);
      var row = el('div', 'row');
      row.style.justifyContent = 'center';
      var play = el('button', 'btn primary big', t('title.play'));
      play.type = 'button';
      play.addEventListener('click', function () { showScreen('modes'); });
      row.appendChild(play);
      sheet.appendChild(row);
      var row2 = el('div', 'row');
      row2.style.justifyContent = 'center';
      [[t('menu.daily'), 'daily'], [t('menu.journey'), 'journey'], [t('menu.profile'), 'profile'],
       [t('menu.leaderboard'), 'leaderboard'], [t('menu.settings'), 'settings'], [t('menu.help'), 'help']].forEach(function (x) {
        var b = el('button', 'btn', x[0]);
        b.type = 'button';
        b.addEventListener('click', function () { showScreen(x[1]); });
        row2.appendChild(b);
      });
      sheet.appendChild(row2);
      // StarHermit account: status line, sign-in (platform host, no token), invite (signed in)
      var acct = el('p', 'mini', accountLine());
      acct.id = 'account-line';
      acct.style.textAlign = 'center';
      sheet.appendChild(acct);
      if (P.canSignIn() || P.hosted) {
        var row3 = el('div', 'row');
        row3.style.justifyContent = 'center';
        if (P.canSignIn()) {
          var si = el('button', 'btn', ACCOUNT.signIn);
          si.type = 'button'; si.id = 'btn-sign-in';
          si.addEventListener('click', function () { P.signIn(); });
          row3.appendChild(si);
        }
        if (P.hosted) {
          var inv = el('button', 'btn', ACCOUNT.invite);
          inv.type = 'button'; inv.id = 'btn-invite';
          inv.addEventListener('click', copyInvite);
          row3.appendChild(inv);
        }
        sheet.appendChild(row3);
      }
      var done = Object.keys(doc.progress.tutorialDone).length;
      if (done < 5) {
        var tip = el('p', 'mini', t('title.newTip'));
        tip.style.textAlign = 'center';
        sheet.appendChild(tip);
      }
    },

    modes: function (sheet) {
      sheet.appendChild(el('h2', null, t('modes.title')));
      var box = el('div');
      sheet.appendChild(box);
      U.buildModeList(box, {
        onPick: function (mode) {
          if (mode === 'learn') showScreen('learn');
          else if (mode === 'journey') showScreen('journey');
          else if (mode === 'practice') showScreen('practice');
          else if (mode === 'challenge') showScreen('challenge');
          else if (mode === 'daily') showScreen('daily');
        }
      });
      backRow(sheet);
    },

    learn: function (sheet) {
      sheet.appendChild(el('h2', null, t('learn.title')));
      C.LESSONS.forEach(function (l) {
        var done = doc.progress.tutorialDone[l.id];
        var b = el('button', 'card mode-card');
        b.type = 'button';
        b.appendChild(el('strong', null, (done ? '✓ ' : '') + t('l.' + l.id, null, l.title)));
        b.appendChild(el('span', 'card-desc', t('lx.' + l.id, null, l.text)));
        b.addEventListener('click', function () { startGame(l.cfg, 'learn', { id: l.id, title: l.title, steps: l.steps, _step: 0 }); });
        sheet.appendChild(b);
      });
      backRow(sheet, t('back.modes'), function () { showScreen('modes'); });
    },

    journey: function (sheet) {
      sheet.appendChild(el('h2', null, t('journey.title')));
      var stars = Object.keys(doc.progress.journeyStars).length;
      sheet.appendChild(el('p', 'mini', t('journey.done', { n: stars })));
      var grid = el('div', 'level-grid');
      sheet.appendChild(grid);
      U.buildJourneyGrid(grid, C.JOURNEY, doc.progress, {
        onPick: function (cfg) { startGame(cfg, 'journey'); }
      });
      backRow(sheet, t('back.modes'), function () { showScreen('modes'); });
    },

    practice: function (sheet) {
      sheet.appendChild(el('h2', null, t('practice.title')));
      var box = el('div');
      sheet.appendChild(box);
      U.buildSetup(box, 'practice', { difficulties: C.PRACTICE }, {
        onStart: function (o) {
          startGame(C.practiceCfg(o.difficulty, RNG.hashString(sessionId + Date.now()) >>> 0), 'practice');
        }
      });
      backRow(sheet, t('back.modes'), function () { showScreen('modes'); });
    },

    challenge: function (sheet) {
      sheet.appendChild(el('h2', null, t('challenge.title')));
      var box = el('div');
      sheet.appendChild(box);
      U.buildSetup(box, 'challenge', { challenges: C.CHALLENGES, best: doc.progress.challengeBest }, {
        onStart: function (o) { startGame(o.cfg, 'challenge'); }
      });
      backRow(sheet, t('back.modes'), function () { showScreen('modes'); });
    },

    daily: function (sheet) {
      sheet.appendChild(el('h2', null, t('daily.title')));
      var box = el('div', null, t('daily.checking'));
      sheet.appendChild(box);
      syncServerTime().then(function () {
        var cfg = C.dailyCfg(utcDateStr());
        U.buildSetup(box, 'daily', { cfg: cfg, done: doc.progress.dailiesDone[cfg.date] }, {
          onStart: function (o) { startGame(o.cfg, 'daily'); }
        });
      });
      backRow(sheet, t('back.modes'), function () { showScreen('modes'); });
    },

    settings: function (sheet) {
      sheet.appendChild(i18nEl(el('h2'), 'settings.title'));
      var form = el('div');
      form.id = 'settings-form';
      sheet.appendChild(form);
      U.buildSettingsForm(form, settings, C.THEMES, {
        buildGraphics: function (box) {
          gfxRender = buildGraphicsSection(box, {
            locale: curLang,
            saved: function () { return settings.gfx; },
            detected: detectedPreset,
            info: graphicsInfo,
            onChange: function (next) {
              settings.gfx = next;
              persist();
              applyGraphics();
            }
          });
        },
        onChange: function (key, value) {
          settings[key] = value;
          persist();
          applySettings();
        }
      });
      backToContext(sheet);
    },

    help: function (sheet) {
      sheet.appendChild(el('h2', null, t('help.title')));
      var box = el('div');
      sheet.appendChild(box);
      U.buildHelp(box, keysText());
      backToContext(sheet);
    },

    profile: function (sheet) {
      sheet.appendChild(el('h2', null, t('profile.title')));
      var box = el('div');
      sheet.appendChild(box);
      U.buildProfile(box, doc.progress, S.ACHIEVEMENTS);
      var row = el('div', 'row');
      var reset = el('button', 'btn', t('profile.reset'));
      reset.type = 'button';
      reset.addEventListener('click', function () {
        if (confirm(t('profile.confirm'))) {
          doc = S.fresh(); settings = doc.settings; persist(); applySettings(); showScreen('title');
        }
      });
      row.appendChild(reset);
      var replay = el('button', 'btn', t('profile.replay'));
      replay.type = 'button';
      replay.addEventListener('click', function () { showScreen('learn'); });
      row.appendChild(replay);
      sheet.appendChild(row);
      backRow(sheet);
    },

    leaderboard: function (sheet) {
      sheet.appendChild(el('h2', null, t('lb.title')));
      var box = el('div');
      sheet.appendChild(box);
      var daily = C.dailyCfg(utcDateStr());
      var local = S.loadBoards().entries.filter(function (e) { return e.cfgId === daily.id; });
      U.buildLeaderboard(box, local, C.rivalScores(daily), t('lb.today', { id: daily.id }), profileFor);
      box.appendChild(el('p', 'mini', t('lb.device')));
      backRow(sheet);
    }
  };

  var gfxRender = null;      // redraws the Graphics section (gfx-panel.js) in the current language
  var screenRefresh = null;  // re-renders the open screen after a language change
  function showScreen(name) {
    if (game && !game.over && !game.paused) return; // in-round overlays come via pause
    screenRefresh = function () { showScreen(name); };
    openScreen(function (sheet) { (screens[name] || screens.title)(sheet); }, name);
  }

  function applySettings() {
    document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
    document.body.classList.toggle('high-contrast', !!settings.highContrast);
    document.body.classList.toggle('large-text', !!settings.largeText);
    document.body.classList.toggle('left-handed', !!settings.leftHanded);
    document.body.classList.toggle('board-mirror', !!settings.boardMirror);
    document.body.classList.toggle('high-visibility', settings.colorPalette === 'high-visibility');
    A.applySettings(settings);
    A.setCaptions(!!settings.captions);
    applyGraphics(true);
    if (game && view) view.build(game.state, C.THEMES[settings.theme] || C.THEMES.ember, game.cfg.seed, settings);
    if (game) updateHud();
  }

  // ---------- pause ----------
  function pauseGame(on) {
    if (!game || game.over) return;
    game.paused = on;
    if (on) {
      screenRefresh = function () { if (game && !game.over) pauseGame(true); };
      openScreen(function (sheet) {
        sheet.appendChild(el('h2', null, t('pause.title')));
        sheet.appendChild(el('p', 'mini', t('pause.desc', { name: U.cfgName(game.cfg) })));
        var row = el('div', 'row');
        [[t('pause.resume'), function () { game.paused = false; game.lastFrame = performance.now(); closeScreen(); }, 'primary'],
         [t('pause.settings'), function () { showScreen('settings'); }],
         [t('pause.help'), function () { showScreen('help'); }],
         [t('pause.leave'), function () { closeScreen(); endGame('resign'); }]].forEach(function (x) {
          var b = el('button', 'btn ' + (x[2] || ''), x[0]);
          b.type = 'button';
          b.addEventListener('click', x[1]);
          row.appendChild(b);
        });
        sheet.appendChild(row);
      }, 'Paused');
      A.suspend();
    } else A.resume();
  }

  // ---------- results ----------
  // ctx = { cfg, mode, lb }: kept so a language change re-renders the card
  // without posting the score again (ctx.lb holds the leaderboard outcome).
  function showResults(term, unlocked, envelope, ctx) {
    ctx = ctx || { cfg: game.cfg, mode: game.mode, lb: null };
    var cfg = ctx.cfg, mode = ctx.mode;
    screenRefresh = function () { showResults(term, unlocked, envelope, ctx); };
    openScreen(function (sheet) {
      var win = term.win || mode === 'learn';
      var head = el('h2', 'outcome-head ' + (win ? 'win' : 'lose'),
        mode === 'learn' ? t('r.lesson') :
        win ? (term.reason === 'goal-reached' ? t('r.goal') : t('r.day')) : t('r.missed'));
      sheet.appendChild(head);
      var art = el('img', 'result-art');
      art.src = win ? 'assets/results-win.webp' : 'assets/results-lose.webp'; art.alt = ''; art.decoding = 'async';
      art.addEventListener('error', function () { art.remove(); });
      sheet.appendChild(art);
      sheet.appendChild(el('p', 'mini',
        t('r.meta', { name: U.cfgName(cfg), seed: (cfg.seed >>> 0).toString(36), c: envelope.contentVersion, b: envelope.build })));

      var table = el('table', 'results-table');
      var tbody = el('tbody');
      table.appendChild(tbody);
      U.buildResults(tbody, term, cfg);
      sheet.appendChild(table);

      if (mode === 'journey') {
        var stars = U.starsFor(cfg, term);
        sheet.appendChild(el('p', null, t('r.par', { stars: '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars), n: cfg.par.score })));
      }
      if (unlocked.length) {
        var ua = el('p', null, t('r.ach', { list: unlocked.map(function (k) {
          var a = S.ACHIEVEMENTS.find(function (x) { return x.key === k; });
          return t('ach.' + k, null, a ? a.name : k);
        }).join(', ') }));
        sheet.appendChild(ua);
      }
      if (mode !== 'learn' && P.hosted) { // StarHermit high-score board
        var lbText = function (r) {
          return !r ? ACCOUNT.lbPosting : !r.posted ? ACCOUNT.lbNotPosted
            : r.rank ? ACCOUNT.lbRank.replace('{rank}', r.rank) : ACCOUNT.lbPosted;
        };
        var lbLine = el('p', 'mini lb-line', lbText(ctx.lb));
        lbLine.setAttribute('aria-live', 'polite');
        sheet.appendChild(lbLine);
        if (!ctx.posted) {
          ctx.posted = true;
          P.submitScore(term.score.total).then(function (r) {
            ctx.lb = r;
            var line = document.querySelector('.lb-line');
            if (line) line.textContent = lbText(r);
          });
        }
      }
      if (cfg.ranked) {
        var lb = el('div');
        sheet.appendChild(lb);
        var local = S.loadBoards().entries.filter(function (e) { return e.cfgId === cfg.id; });
        U.buildLeaderboard(lb, local, C.rivalScores(cfg), t('lb.compare'));
      }

      var row = el('div', 'row');
      var retry = el('button', 'btn primary', t(win ? 'r.again' : 'r.retry'));
      retry.type = 'button';
      retry.addEventListener('click', function () {
        var lesson = mode === 'learn' ? C.LESSONS.find(function (l) { return l.cfg.id === cfg.id; }) : null;
        startGame(cfg, mode, lesson ? { id: lesson.id, title: lesson.title, steps: lesson.steps, _step: 0 } : null);
      });
      row.appendChild(retry);
      var next = null;
      if (mode === 'journey' && win) {
        var idx = C.JOURNEY.findIndex(function (c) { return c.id === cfg.id; });
        if (idx >= 0 && idx + 1 < C.JOURNEY.length) {
          next = el('button', 'btn', t('r.next'));
          next.type = 'button';
          next.addEventListener('click', function () { startGame(C.JOURNEY[idx + 1], 'journey'); });
          row.appendChild(next);
        }
      }
      var home = el('button', 'btn', t('r.home'));
      home.type = 'button';
      home.addEventListener('click', function () { game = null; showScreen('title'); });
      row.appendChild(home);
      sheet.appendChild(row);
      game = null;
    }, 'Results');
  }

  // ---------- input ----------
  var pdown = null;
  function onPointerDown(e) {
    pdown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    try { view.domElement.setPointerCapture(e.pointerId); } catch (err) {}
    var up = function (ev) {
      view.domElement.removeEventListener('pointerup', up);
      view.domElement.removeEventListener('pointercancel', cancel);
      if (!pdown || ev.pointerId !== pdown.id) return;
      var dx = ev.clientX - pdown.x, dy = ev.clientY - pdown.y;
      var dist = Math.hypot(dx, dy), dur = performance.now() - pdown.t;
      pdown = null;
      if (dist > 10 || dur > 600) return; // drag/camera gesture: no commit
      if (!game || game.over || game.paused) return;
      var hit = view.pick(ev.clientX, ev.clientY);
      if (!hit) return;
      if (hit.kind === 'table') dispatch({ type: 'serve', table: hit.id });
      else if (hit.kind === 'stove') dispatch({ type: 'pickup' });
      else if (hit.kind === 'tile') dispatch({ type: 'goto', x: hit.x, y: hit.y });
    };
    var cancel = function () {
      view.domElement.removeEventListener('pointerup', up);
      view.domElement.removeEventListener('pointercancel', cancel);
      pdown = null;
    };
    view.domElement.addEventListener('pointerup', up);
    view.domElement.addEventListener('pointercancel', cancel);
  }

  // Keyboard actions by KeyboardEvent.code (control.* in starhermit.txt);
  // a signed-in player's StarHermit overrides replace these at boot.
  var KEY_DEFAULTS = {
    pause: ['KeyP', 'Escape'], pickup: ['KeyK'], hint: ['KeyH'], undo: ['KeyU'], speed: ['KeyF'], camera: ['KeyC']
  };
  for (var ti = 1; ti <= 9; ti++) KEY_DEFAULTS['table' + ti] = ['Digit' + ti, 'Numpad' + ti];
  var keyBindings = JSON.parse(JSON.stringify(KEY_DEFAULTS));
  function actionForCode(code) {
    for (var a in keyBindings) if (keyBindings[a].indexOf(code) >= 0) return a;
    return null;
  }
  function keyName(action) {
    var c = (keyBindings[action] || [])[0] || '';
    return { Escape: 'Esc', Space: t('key.Space') }[c] || c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  }
  function keysText() {
    return t('help.keys', {
      t1: keyName('table1'), t9: keyName('table9'), pickup: keyName('pickup'), hint: keyName('hint'), undo: keyName('undo'),
      camera: keyName('camera'), speed: keyName('speed'),
      pause: keyBindings.pause.map(function (c) { return c === 'Escape' ? 'Esc' : c.replace(/^Key/, ''); }).join('/')
    });
  }

  function accountLine() {
    if (!P.hosted) return signedOutNotice ? ACCOUNT.signedOut : ACCOUNT.offline;
    var name = P.profile ? P.profile.displayName : '…';
    var sync = P.sync === 'synced' ? ACCOUNT.synced : P.sync === 'saving' ? ACCOUNT.saving : ACCOUNT.syncOff;
    return ACCOUNT.playingAs.replace('{name}', name) + ' · ' + sync;
  }
  function refreshAccountLine() {
    var line = document.getElementById('account-line');
    if (line) line.textContent = accountLine();
  }
  function copyInvite() {
    var link = P.inviteLink();
    if (!link) return;
    var fail = function () { showToast(ACCOUNT.inviteFailed + ' ' + link); };
    try { navigator.clipboard.writeText(link).then(function () { showToast(ACCOUNT.inviteCopied); }, fail); }
    catch (err) { fail(); }
  }

  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    var act = actionForCode(e.code);
    if (act === 'pause' || e.code === 'Escape') {
      if (screenEl) {
        // Only an active in-round overlay (pause and friends) closes to play;
        // on menu/results screens there is nothing underneath to return to.
        if (game && !game.over) {
          closeScreen();
          game.paused = false; game.lastFrame = performance.now(); A.resume();
        }
      }
      else if (game && !game.over) pauseGame(true);
      e.preventDefault();
      return;
    }
    if (!game || game.over || game.paused) return;
    if (act && /^table\d$/.test(act)) {
      var tid = parseInt(act.slice(5), 10) - 1;
      if (tid < game.state.tables.length) dispatch({ type: 'serve', table: tid });
      e.preventDefault();
    } else if (act === 'pickup') { dispatch({ type: 'pickup' }); e.preventDefault(); }
    else if (act === 'hint') { if (hudBtns.hint) hudBtns.hint.click(); e.preventDefault(); }
    else if (act === 'undo') { undo(); e.preventDefault(); }
    else if (act === 'speed') { if (hudBtns.speed) hudBtns.speed.click(); e.preventDefault(); }
    else if (act === 'camera') { if (view) view.frameCamera(); e.preventDefault(); }
  });

  // gamepad: dpad/left stick navigates legal actions, A commits, B/Start pauses
  var gpState = { idx: 0, pressed: {} };
  function pollGamepad() {
    if (!navigator.getGamepads) return;
    var gp = null;
    var pads = navigator.getGamepads();
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    if (!gp) return;
    function pressed(idx) {
      var down = gp.buttons[idx] && gp.buttons[idx].pressed;
      var was = gpState.pressed[idx];
      gpState.pressed[idx] = down;
      return down && !was;
    }
    if (pressed(9)) { if (game && !game.over) pauseGame(!game.paused); return; }
    if (!game || game.over || game.paused) return;
    var legal = R.legalActions(game.state);
    if (!legal.length) return;
    if (pressed(14)) { gpState.idx = (gpState.idx + legal.length - 1) % legal.length; showToast(describeAction(legal[gpState.idx])); }
    if (pressed(15)) { gpState.idx = (gpState.idx + 1) % legal.length; showToast(describeAction(legal[gpState.idx])); }
    if (pressed(0)) {
      var a = legal[gpState.idx % legal.length];
      dispatch(a.type === 'serve' ? { type: 'serve', table: a.table } : a.type === 'buy' ? { type: 'buy', item: a.item } : { type: 'pickup' });
    }
    if (pressed(1)) pauseGame(true);
  }
  function describeAction(a) {
    if (a.type === 'serve') return t('gp.serve', { n: a.table + 1 });
    if (a.type === 'pickup') return t('gp.pickup');
    if (a.type === 'buy') return t('gp.buy', { item: U.buyLabel(a.item), n: a.cost });
    return a.type;
  }

  // ---------- lifecycle ----------
  document.addEventListener('visibilitychange', function () {
    var hidden = document.hidden;
    if (view) view.setHidden(hidden);
    if (hidden) {
      if (game && !game.over && !game.paused) pauseGame(true);
      A.suspend();
    } else {
      if (!game || game.paused) { /* stay muted while the pause menu is up */ }
      else A.resume();
      if (game && !game.over) showToast(t('toast.away'));
    }
  });
  window.addEventListener('resize', function () { if (view) view.resize(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { if (view) view.resize(); }, 250); });

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // Language changed (Settings → Language, or the account preference arrived).
  // The open Settings screen relabels in place (the Language control keeps its
  // focus); any other screen is re-rendered; a running service keeps its state.
  function onLanguageChange() {
    ACCOUNT = accountStrings(curLang());
    if (I18N) I18N.apply(app);
    if (game && !game.over) {
      buildHudActions();
      updateHud();
      if (game.lesson) renderLessonStep(true);
    }
    var name = currentScreenName();
    if (name === 'settings' && screenEl) {
      I18N.apply(screenEl);
      var back = screenEl.querySelector('.row .btn');
      if (back) back.textContent = t('back');
      if (gfxRender) gfxRender();
    } else if (screenEl && screenRefresh) {
      screenRefresh();
    }
  }
  document.addEventListener('bb-language', onLanguageChange);

  // ---------- boot ----------
  buildShell();
  applySettings();
  syncServerTime();
  showScreen('title');
  // StarHermit: remote save wins over the local copy, platform settings win
  // over saved preferences; localStorage stays the offline cache.
  P.init({
    onProfile: refreshAccountLine,
    onSync: refreshAccountLine,
    onAuth: function (a) { if (!a.signedIn) signedOutNotice = true; if (currentScreenName() === 'title') showScreen('title'); },
    // Another device saved first: merge both documents (better records win,
    // local settings stay) and save the merge; a service in progress is in memory.
    onConflict: function (raw) {
      var merged = S.mergeDocs(raw ? S.loadRaw(raw) : null, doc);
      doc.progress = merged.progress;
      persist();
      if (currentScreenName() === 'title') showScreen('title');
    }
  }).then(function (remoteRaw) {
    refreshAccountLine();
    if (!P.hosted) return;
    var remote = remoteRaw ? S.loadRaw(remoteRaw) : null;
    var ps = P.platformSettings;
    if (remote) doc = remote;
    if (ps) Object.keys(S.DEFAULT_SETTINGS).forEach(function (k) { if (k in ps) doc.settings[k] = ps[k]; });
    settings = doc.settings;
    persist();
    applySettings();
    applyGraphics();
    return P.loadBindings(KEY_DEFAULTS).then(function (b) { keyBindings = b; });
  }).then(function () { if (currentScreenName() === 'title') showScreen('title'); });
  rafId = requestAnimationFrame(loop);
})();
