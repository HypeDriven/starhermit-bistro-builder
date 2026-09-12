/* Bistro Builder — bootstrap + session + screen flow.
 * Owns the fixed-step simulation loop, command dispatch with idempotent
 * command IDs, replay envelopes, undo snapshots, screen state machine,
 * keyboard/touch/gamepad input, persistence, achievements, and host API
 * integration (server time, score submission) with full offline fallback.
 */
import * as BBRender from './render.js';

(function () {
  'use strict';

  var R = window.BBRules, C = window.BBContent, S = window.BBStore,
      U = window.BBUI, A = window.BBAudio, RNG = window.BBRNG;

  var BUILD = '1.0.0';
  var el = U.el;
  var app = document.getElementById('app');

  // ---------- persistent save ----------
  var doc = S.load();
  function persist() { S.save(doc); }
  var settings = doc.settings;

  // ---------- host API (same-origin /api when hosted; offline-safe) ----------
  var serverOffsetMs = null; // round-trip-adjusted server time offset

  // Launch token: fragment #game_token=<jwt> (platform contract), stripped
  // after the read; query forms kept for local dev. Decoded for sub +
  // game_scope — the slug is never hard-coded. Memory only, never persisted.
  var launchToken = null, platformUserId = null, platformSlug = null;
  var profileNames = {};   // userId -> Promise<string> (cached nicknames)
  var refreshTimer = null, refreshRetryTimer = null;

  function decodeJwt(t) {
    try {
      var seg = String(t).split('.')[1];
      if (!seg) return null;
      var b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }

  // Fragment first; query params (?token=/?launch_token=) are local-dev only.
  function readLaunchToken() {
    try {
      var h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      var t = h.get('game_token');
      if (t) {
        h.delete('game_token');
        h.delete('session_id');
        var rest = h.toString();
        history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
        return t;
      }
      var q = new URLSearchParams(location.search);
      return q.get('game_token') || q.get('token') || q.get('launch_token') || null;
    } catch (e) { return null; }
  }

  function initPlatform() {
    launchToken = readLaunchToken();
    if (launchToken) {
      var claims = decodeJwt(launchToken);
      if (!claims) launchToken = null; // malformed: standalone
      else {
        if (typeof claims.sub === 'string' && claims.sub) platformUserId = claims.sub;
        if (typeof claims.game_scope === 'string' && claims.game_scope) platformSlug = claims.game_scope;
        if (!platformUserId || !platformSlug) launchToken = null; // not a usable launch token
      }
    }
    if (launchToken) scheduleTokenRefresh();
  }

  // The token lives 60 min; scoped tokens may re-mint via the game's
  // launch-token route. Retry a failed re-mint after ~60 s.
  function scheduleTokenRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshLaunchToken, 45 * 60 * 1000);
  }
  function refreshLaunchToken() {
    if (!launchToken || !platformSlug) return Promise.resolve(false);
    return apiPost('/api/v1/games/' + encodeURIComponent(platformSlug) + '/launch-token', {}).then(function (res) {
      if (res.ok && res.body && typeof res.body.token === 'string' && res.body.token) {
        launchToken = res.body.token;
        var claims = decodeJwt(launchToken);
        if (claims && claims.sub) platformUserId = claims.sub;
        if (claims && claims.game_scope) platformSlug = claims.game_scope;
        return true;
      }
      retryTokenRefresh();
      return false;
    });
  }
  function retryTokenRefresh() {
    if (refreshRetryTimer || !launchToken) return;
    refreshRetryTimer = setTimeout(function () {
      refreshRetryTimer = null;
      refreshLaunchToken();
    }, 60000);
  }

  // Display names for board rows: the profile nickname is the only profile
  // read a game-scoped token may make (never /api/v1/me, never usernames).
  // Off-platform the call fails and the neutral "Player <id8>" fallback is
  // used. Cached per id.
  function profileFor(userId) {
    if (!userId || typeof userId !== 'string') return Promise.resolve('player');
    if (profileNames[userId]) return profileNames[userId];
    var p = apiGet('/api/v1/users/' + encodeURIComponent(userId) + '/profile').then(function (res) {
      var n = res.ok && res.body && typeof res.body.nickname === 'string' && res.body.nickname
        ? res.body.nickname : null;
      return n || ('Player ' + userId.slice(0, 8));
    });
    profileNames[userId] = p;
    return p;
  }

  function apiHeaders(extra) {
    var h = extra || {};
    if (launchToken) h['Authorization'] = 'Bearer ' + launchToken;
    return h;
  }
  function apiGet(path) {
    return fetch(path, { headers: apiHeaders({ 'Accept': 'application/json' }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .catch(function () { return { ok: false, body: { error: 'offline' } }; });
  }
  function apiPost(path, payload) {
    return fetch(path, {
      method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .catch(function () { return { ok: false, body: { error: 'offline' } }; });
  }
  function syncServerTime() {
    var t0 = Date.now();
    return apiGet('/api/v1/time').then(function (res) {
      if (res.ok && typeof res.body.now === 'number') {
        var rtt = Date.now() - t0;
        serverOffsetMs = res.body.now - (t0 + rtt / 2);
      }
    });
  }
  function nowMs() { return Date.now() + (serverOffsetMs || 0); }
  function utcDateStr() { return new Date(nowMs()).toISOString().slice(0, 10); }

  function funnel(eventName, data) { // anonymous funnel events only
    apiPost('/api/v1/events', { event: eventName, data: data || {}, sessionId: sessionId });
  }

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
    h1.appendChild(el('span', 'sub', 'miniature service'));
    topbar.appendChild(h1);
    ['coins', 'earned', 'clock', 'served'].forEach(function (k) {
      chips[k] = el('span', 'stat-chip', '—');
      topbar.appendChild(chips[k]);
    });
    topbar.appendChild(el('span', 'spacer'));
    var btnLeft = el('button', 'btn icon drawer-btn', '📋');
    btnLeft.type = 'button'; btnLeft.setAttribute('aria-label', 'Toggle objective panel');
    btnLeft.addEventListener('click', function () { railLeft.classList.toggle('open'); railRight.classList.remove('open'); });
    var btnRight = el('button', 'btn icon drawer-btn', '🍽');
    btnRight.type = 'button'; btnRight.setAttribute('aria-label', 'Toggle stations panel');
    btnRight.addEventListener('click', function () { railRight.classList.toggle('open'); railLeft.classList.remove('open'); });
    topbar.appendChild(btnLeft); topbar.appendChild(btnRight);
    var btnMenu = el('button', 'btn icon', '☰');
    btnMenu.type = 'button'; btnMenu.setAttribute('aria-label', 'Menu');
    btnMenu.addEventListener('click', function () { if (game && !game.over) pauseGame(true); else showScreen('title'); });
    topbar.appendChild(btnMenu);
    app.appendChild(topbar);

    var stage = el('main', 'stage');
    railLeft = el('aside', 'rail left');
    railLeft.setAttribute('aria-label', 'Objective and progress');
    railLeft.appendChild(el('h2', null, 'Objective'));
    objectiveBox = el('div', 'objective');
    railLeft.appendChild(objectiveBox);
    var pb = el('div', 'progress-bar'); progressFill = el('div'); pb.appendChild(progressFill);
    railLeft.appendChild(pb);
    railLeft.appendChild(el('h2', null, 'Hint'));
    hintLine = el('div', 'hint-line');
    railLeft.appendChild(hintLine);
    lessonStepBox = el('div');
    railLeft.appendChild(lessonStepBox);
    stage.appendChild(railLeft);

    playfield = el('section', 'playfield');
    playfield.setAttribute('aria-label', 'Bistro playfield. Use the stations panel for a text version of the board.');
    stage.appendChild(playfield);

    railRight = el('aside', 'rail right');
    railRight.setAttribute('aria-label', 'Stations and upgrades');
    railRight.appendChild(el('h2', null, 'Stations'));
    mirrorBox = el('div');
    railRight.appendChild(mirrorBox);
    railRight.appendChild(el('h2', null, 'Upgrades'));
    upgradeBox = el('div', 'upgrade-panel');
    railRight.appendChild(upgradeBox);
    stage.appendChild(railRight);
    app.appendChild(stage);

    hudActions = el('div', 'hud-actions');
    hudActions.setAttribute('role', 'toolbar');
    hudActions.setAttribute('aria-label', 'Service actions');
    playfield.appendChild(hudActions);

    banner = el('div', 'banner'); banner.style.display = 'none'; playfield.appendChild(banner);
    toast = el('div', 'toast'); toast.style.display = 'none'; playfield.appendChild(toast);
    captionLine = el('div', 'caption-line'); captionLine.style.display = 'none'; playfield.appendChild(captionLine);
    liveRegion = el('div', 'sr-only');
    liveRegion.setAttribute('aria-live', 'polite');
    app.appendChild(liveRegion);
  }

  function announce(text) { liveRegion.textContent = text; }
  var toastTimer = null;
  function showToast(text, invalid) {
    toast.textContent = text;
    toast.className = 'toast' + (invalid ? ' invalid' : '');
    toast.style.display = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.style.display = 'none'; }, 2600);
    if (invalid) announce('Not allowed: ' + text);
  }
  function showBanner(text, ms) {
    banner.textContent = text; banner.style.display = '';
    setTimeout(function () { banner.style.display = 'none'; }, ms || 1400);
  }

  // ---------- renderer ----------
  var view = null;
  function ensureView() {
    if (view) return true;
    view = BBRender.create(playfield, {});
    if (!view) {
      var fb = el('div', 'canvas-fallback',
        '3D graphics are unavailable in this browser. The station panel on the right is a full text version of the bistro — the game remains playable. Your progress is saved.');
      playfield.appendChild(fb);
      return false;
    }
    view.domElement.addEventListener('pointerdown', onPointerDown);
    view.setQuality(qualityTier(), settings);
    return true;
  }
  function qualityTier() {
    if (settings.graphicsTier !== 'auto') return settings.graphicsTier;
    var mobile = /Mobi|Android/i.test(navigator.userAgent);
    return mobile ? 'medium' : 'high';
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
      captionLine.textContent = '♪ ' + text; captionLine.style.display = '';
      clearTimeout(captionLine._t);
      captionLine._t = setTimeout(function () { captionLine.style.display = 'none'; }, 1800);
    });
    A.setAvRng(RNG.derive(cfg.seed >>> 0, RNG.STREAM_AV));
    if (view) {
      view.build(state, C.THEMES[settings.theme] || C.THEMES.ember, cfg.seed, settings);
    }
    buildHudActions();
    updateHud();
    countdownThen('Service begins!', function () {});
    funnel('round-start', { mode: mode, id: cfg.id });
    if (lesson) renderLessonStep();
    announce(cfg.name + '. Goal: ' + (cfg.goal > 0 ? cfg.goal + ' coins' : 'serve guests') + '.');
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

  function invalidText(reason) {
    var map = {
      'game-ended': 'service has ended', 'unknown-command': 'unknown action',
      'malformed-command': 'malformed action', 'bad-table': 'no such table',
      'table-not-open': 'that table is still walled off', 'no-waiting-guest': 'no guest is waiting there',
      'no-dishes-available': 'no dishes ready — wait for the kitchen', 'mechanic-not-available': 'not available in this mode',
      'cap-reached': 'already at maximum', 'insufficient-coins': 'not enough coins yet',
      'tile-not-walkable': 'you can’t walk there', 'not-active': 'service is paused'
    };
    return map[reason] || String(reason);
  }

  // Undo (practice/learn only, where rules permit): one snapshot per second.
  function pushUndo() {
    if (!game.cfg.mechanics.undo) return;
    game.undoStack.push(R.serialize(game.state));
    if (game.undoStack.length > 120) game.undoStack.shift();
  }
  function undo() {
    if (!game || !game.cfg.mechanics.undo || !game.undoStack.length) {
      if (game) showToast(game.cfg.mechanics.undo ? 'Nothing to rewind yet.' : 'Rewind is not available here.', true);
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
    showToast('Rewound one second.');
    updateHud();
  }

  // ---------- lessons ----------
  function lessonIndex() { return game && game.lesson ? game.lesson._step || 0 : 0; }
  function renderLessonStep() {
    lessonStepBox.innerHTML = '';
    if (!game || !game.lesson) return;
    var step = game.lesson.steps[lessonIndex()];
    if (!step) return;
    var d = el('div', 'lesson-step');
    d.appendChild(el('strong', null, 'Lesson: ' + game.lesson.title + ' — '));
    d.appendChild(document.createTextNode(step.text));
    lessonStepBox.appendChild(d);
    announce('Lesson step: ' + step.text);
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
      showBanner('Lesson complete!');
      doc.progress.tutorialDone[game.lesson.id] = true;
      persist();
      funnel('tutorial-step', { lesson: game.lesson.id, done: true });
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
        announce('Table ' + (g.tableId + 1) + ' is about to walk out.');
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
      if (e.t === 'serve') announce('Guest served for ' + e.pay + ' coins.');
      if (e.t === 'leave-angry') announce('A guest left angry.');
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
    add('🍽 Pick up', 'pickup', function () { dispatch({ type: 'pickup' }); }, 'Pick up dishes from the kitchen');
    add('💡 Hint', 'hint', function () {
      if (!game) return;
      var h = R.hint(game.state);
      showToast(h.text);
      A.play('hint');
      if (view && h.action && h.action.type === 'serve') view.setHighlights(['table:' + h.action.table]);
    }, 'Show a hint');
    if (game.cfg.mechanics.undo) add('⏪ Rewind', 'undo', undo, 'Rewind one second');
    add('⏩ Speed', 'speed', function () {
      if (!game) return;
      game.speed = game.speed === 1 ? 2 : 1;
      showToast('Speed ' + game.speed + '× — the end state is identical.');
    }, 'Toggle fast-forward');
    add('⏸ Pause', 'pause', function () { pauseGame(true); }, 'Pause');
  }

  function updateHud() {
    if (!game) return;
    var st = game.state, cfg = game.cfg;
    chips.coins.innerHTML = 'Coins <strong>' + st.coins + '</strong>';
    chips.earned.innerHTML = 'Earned <strong>' + st.earned + '</strong>' + (cfg.goal > 0 ? '/' + cfg.goal : '');
    chips.earned.classList.toggle('goal-met', cfg.goal > 0 && st.earned >= cfg.goal);
    var remain = Math.max(0, (st.dayTicks - st.tick) * R.TICK_MS);
    chips.clock.textContent = '⏱ ' + U.fmtClock(remain);
    chips.clock.classList.toggle('low', remain < 30000);
    chips.served.innerHTML = 'Served <strong>' + st.score.served + '</strong>';

    objectiveBox.innerHTML = '';
    objectiveBox.appendChild(el('div', 'big', cfg.goal > 0 ? st.earned + ' / ' + cfg.goal + ' coins' : st.earned + ' coins earned'));
    objectiveBox.appendChild(el('div', 'mini', cfg.name + ' · seed ' + (cfg.seed >>> 0).toString(36)));
    progressFill.style.width = cfg.goal > 0 ? Math.min(100, (st.earned / cfg.goal) * 100) + '%' : '0%';

    var h = R.hint(st);
    hintLine.textContent = h.text;

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
    if (platformUserId) envelope.playerId = platformUserId; // attach board rows to the account
    if (game.cfg.ranked) submitScore(envelope);

    funnel('round-end', { mode: game.mode, id: game.cfg.id, win: t.win, score: st.score.total });
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
    // server-first; fall back to the local board offline
    apiPost('/api/v1/scores', envelope).then(function (res) {
      if (!res.ok) {
        var boards = S.loadBoards();
        boards.entries.push(entry);
        boards.entries = S.sortEntries(boards.entries).slice(0, 100);
        S.saveBoards(boards);
      }
    });
  }

  // ---------- screens ----------
  var screenEl = null;
  function closeScreen() {
    if (screenEl) { screenEl.remove(); screenEl = null; }
  }
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
    if (first) first.focus();
  }
  function backRow(sheet, label, fn) {
    var row = el('div', 'row');
    var b = el('button', 'btn', label || '← Back');
    b.type = 'button';
    b.addEventListener('click', fn || function () { showScreen('title'); });
    row.appendChild(b);
    sheet.appendChild(row);
  }
  // Settings/help reached from the pause menu must return to the pause menu,
  // not to the title screen (which would strand the paused round behind it).
  function backToContext(sheet) {
    if (game && !game.over) backRow(sheet, '← Back', function () { pauseGame(true); });
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
      hero.appendChild(el('p', null, 'Seat the crowd, carry the dishes, grow the room. One bustling miniature bistro, one service at a time.'));
      sheet.appendChild(hero);
      var row = el('div', 'row');
      row.style.justifyContent = 'center';
      var play = el('button', 'btn primary big', '▶ Play');
      play.type = 'button';
      play.addEventListener('click', function () { showScreen('modes'); });
      row.appendChild(play);
      sheet.appendChild(row);
      var row2 = el('div', 'row');
      row2.style.justifyContent = 'center';
      [['Daily challenge', 'daily'], ['Journey', 'journey'], ['Profile', 'profile'],
       ['Leaderboard', 'leaderboard'], ['Settings', 'settings'], ['Help', 'help']].forEach(function (x) {
        var b = el('button', 'btn', x[0]);
        b.type = 'button';
        b.addEventListener('click', function () { showScreen(x[1]); });
        row2.appendChild(b);
      });
      sheet.appendChild(row2);
      var done = Object.keys(doc.progress.tutorialDone).length;
      if (done < 5) {
        var tip = el('p', 'mini', 'New here? Start with Learn — five one-minute lessons.');
        tip.style.textAlign = 'center';
        sheet.appendChild(tip);
      }
    },

    modes: function (sheet) {
      sheet.appendChild(el('h2', null, 'Choose a mode'));
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
      sheet.appendChild(el('h2', null, 'Learn — one rule at a time'));
      C.LESSONS.forEach(function (l) {
        var done = doc.progress.tutorialDone[l.id];
        var b = el('button', 'card mode-card');
        b.type = 'button';
        b.appendChild(el('strong', null, (done ? '✓ ' : '') + l.title));
        b.appendChild(el('span', 'card-desc', l.text));
        b.addEventListener('click', function () { startGame(l.cfg, 'learn', { id: l.id, title: l.title, steps: l.steps, _step: 0 }); });
        sheet.appendChild(b);
      });
      backRow(sheet, '← Modes', function () { showScreen('modes'); });
    },

    journey: function (sheet) {
      sheet.appendChild(el('h2', null, 'Journey — 40 stages'));
      var stars = Object.keys(doc.progress.journeyStars).length;
      sheet.appendChild(el('p', 'mini', stars + '/40 stages completed. Every fifth stage is a mastery test.'));
      var grid = el('div', 'level-grid');
      sheet.appendChild(grid);
      U.buildJourneyGrid(grid, C.JOURNEY, doc.progress, {
        onPick: function (cfg) { startGame(cfg, 'journey'); }
      });
      backRow(sheet, '← Modes', function () { showScreen('modes'); });
    },

    practice: function (sheet) {
      sheet.appendChild(el('h2', null, 'Practice'));
      var box = el('div');
      sheet.appendChild(box);
      U.buildSetup(box, 'practice', { difficulties: C.PRACTICE }, {
        onStart: function (o) {
          startGame(C.practiceCfg(o.difficulty, RNG.hashString(sessionId + Date.now()) >>> 0), 'practice');
        }
      });
      backRow(sheet, '← Modes', function () { showScreen('modes'); });
    },

    challenge: function (sheet) {
      sheet.appendChild(el('h2', null, 'Challenges'));
      var box = el('div');
      sheet.appendChild(box);
      U.buildSetup(box, 'challenge', { challenges: C.CHALLENGES, best: doc.progress.challengeBest }, {
        onStart: function (o) { startGame(o.cfg, 'challenge'); }
      });
      backRow(sheet, '← Modes', function () { showScreen('modes'); });
    },

    daily: function (sheet) {
      sheet.appendChild(el('h2', null, 'Daily challenge'));
      var box = el('div', null, 'Checking today’s ruleset…');
      sheet.appendChild(box);
      syncServerTime().then(function () {
        var cfg = C.dailyCfg(utcDateStr());
        U.buildSetup(box, 'daily', { cfg: cfg, done: doc.progress.dailiesDone[cfg.date] }, {
          onStart: function (o) { startGame(o.cfg, 'daily'); }
        });
      });
      backRow(sheet, '← Modes', function () { showScreen('modes'); });
    },

    settings: function (sheet) {
      sheet.appendChild(el('h2', null, 'Settings'));
      var form = el('div');
      form.id = 'settings-form';
      sheet.appendChild(form);
      U.buildSettingsForm(form, settings, C.THEMES, {
        onChange: function (key, value) {
          settings[key] = value;
          persist();
          applySettings();
          funnel('settings-change', { key: key });
        }
      });
      backToContext(sheet);
    },

    help: function (sheet) {
      sheet.appendChild(el('h2', null, 'How to play'));
      var box = el('div');
      sheet.appendChild(box);
      U.buildHelp(box);
      backToContext(sheet);
    },

    profile: function (sheet) {
      sheet.appendChild(el('h2', null, 'Profile'));
      var box = el('div');
      sheet.appendChild(box);
      U.buildProfile(box, doc.progress, S.ACHIEVEMENTS);
      var row = el('div', 'row');
      var reset = el('button', 'btn', 'Reset all progress');
      reset.type = 'button';
      reset.addEventListener('click', function () {
        if (confirm('Erase all local progress and settings?')) {
          doc = S.fresh(); settings = doc.settings; persist(); applySettings(); showScreen('title');
        }
      });
      row.appendChild(reset);
      var replay = el('button', 'btn', 'Replay tutorial');
      replay.type = 'button';
      replay.addEventListener('click', function () { showScreen('learn'); });
      row.appendChild(replay);
      sheet.appendChild(row);
      backRow(sheet);
    },

    leaderboard: function (sheet) {
      sheet.appendChild(el('h2', null, 'Leaderboards'));
      var box = el('div', null, 'Loading…');
      sheet.appendChild(box);
      var daily = C.dailyCfg(utcDateStr());
      apiGet('/api/v1/scores?cfgId=' + encodeURIComponent(daily.id)).then(function (res) {
        var local = S.loadBoards().entries.filter(function (e) { return e.cfgId === daily.id; });
        var entries = (res.ok && Array.isArray(res.body.entries)) ? res.body.entries.map(function (e) {
          return {
            name: e.name, playerId: e.playerId,
            you: !!(e.playerId && e.playerId === platformUserId),
            score: e.score, date: e.date
          };
        }) : local;
        U.buildLeaderboard(box, entries, C.rivalScores(daily), 'Today — ' + daily.id, profileFor);
        if (!res.ok) box.appendChild(el('p', 'mini', 'Offline: showing local scores. Hosted boards sync when connected.'));
      });
      backRow(sheet);
    }
  };

  function showScreen(name) {
    if (game && !game.over && !game.paused) return; // in-round overlays come via pause
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
    if (view) view.setQuality(qualityTier(), settings);
    if (game && view) view.build(game.state, C.THEMES[settings.theme] || C.THEMES.ember, game.cfg.seed, settings);
    if (game) updateHud();
  }

  // ---------- pause ----------
  function pauseGame(on) {
    if (!game || game.over) return;
    game.paused = on;
    if (on) {
      openScreen(function (sheet) {
        sheet.appendChild(el('h2', null, 'Paused'));
        sheet.appendChild(el('p', 'mini', game.cfg.name + ' — service clock is stopped.'));
        var row = el('div', 'row');
        [['▶ Resume', function () { game.paused = false; game.lastFrame = performance.now(); closeScreen(); }, 'primary'],
         ['Settings', function () { showScreen('settings'); }],
         ['Help', function () { showScreen('help'); }],
         ['Leave service', function () { closeScreen(); endGame('resign'); }]].forEach(function (x) {
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
  function showResults(t, unlocked, envelope) {
    var cfg = game.cfg, mode = game.mode;
    openScreen(function (sheet) {
      var win = t.win || mode === 'learn';
      var head = el('h2', 'outcome-head ' + (win ? 'win' : 'lose'),
        mode === 'learn' ? 'Lesson complete!' :
        win ? (t.reason === 'goal-reached' ? 'Goal reached!' : 'Day complete!') : 'Service over — goal missed.');
      sheet.appendChild(head);
      var art = el('img', 'result-art');
      art.src = win ? 'assets/results-win.webp' : 'assets/results-lose.webp'; art.alt = ''; art.decoding = 'async';
      art.addEventListener('error', function () { art.remove(); });
      sheet.appendChild(art);
      sheet.appendChild(el('p', 'mini',
        cfg.name + ' · seed ' + (cfg.seed >>> 0).toString(36) + ' · content v' + envelope.contentVersion + ' · build ' + envelope.build));

      var table = el('table', 'results-table');
      var tbody = el('tbody');
      table.appendChild(tbody);
      U.buildResults(tbody, t, cfg);
      sheet.appendChild(table);

      if (mode === 'journey') {
        var stars = U.starsFor(cfg, t);
        sheet.appendChild(el('p', null, '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars) + ' — par ' + cfg.par.score));
      }
      if (unlocked.length) {
        var ua = el('p', null, '🏅 Achievement unlocked: ' + unlocked.map(function (k) {
          var a = S.ACHIEVEMENTS.find(function (x) { return x.key === k; });
          return a ? a.name : k;
        }).join(', '));
        sheet.appendChild(ua);
      }
      if (cfg.ranked) {
        var lb = el('div');
        sheet.appendChild(lb);
        var local = S.loadBoards().entries.filter(function (e) { return e.cfgId === cfg.id; });
        U.buildLeaderboard(lb, local, C.rivalScores(cfg), 'Score comparison');
      }

      var row = el('div', 'row');
      var retry = el('button', 'btn primary', '↻ ' + (win ? 'Play again' : 'Retry'));
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
          next = el('button', 'btn', 'Next stage →');
          next.type = 'button';
          next.addEventListener('click', function () { startGame(C.JOURNEY[idx + 1], 'journey'); });
          row.appendChild(next);
        }
      }
      var home = el('button', 'btn', 'Home');
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

  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') {
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
    if (k >= '1' && k <= '9') {
      var tid = parseInt(k, 10) - 1;
      if (tid < game.state.tables.length) dispatch({ type: 'serve', table: tid });
      e.preventDefault();
    } else if (k === 'k') { dispatch({ type: 'pickup' }); e.preventDefault(); }
    else if (k === 'h') { if (hudBtns.hint) hudBtns.hint.click(); e.preventDefault(); }
    else if (k === 'u') { undo(); e.preventDefault(); }
    else if (k === 'f') { if (hudBtns.speed) hudBtns.speed.click(); e.preventDefault(); }
    else if (k === 'c') { if (view) view.frameCamera(); e.preventDefault(); }
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
    if (a.type === 'serve') return 'Serve table ' + (a.table + 1);
    if (a.type === 'pickup') return 'Pick up dishes';
    if (a.type === 'buy') return 'Buy ' + U.BUY_LABELS[a.item] + ' (' + a.cost + 'c)';
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
      if (game && !game.over) showToast('Service paused while you were away — nothing was lost.');
    }
  });
  window.addEventListener('resize', function () { if (view) view.resize(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { if (view) view.resize(); }, 250); });

  // ---------- boot ----------
  buildShell();
  applySettings();
  initPlatform();
  syncServerTime();
  showScreen('title');
  rafId = requestAnimationFrame(loop);
  funnel('app-start');
})();
