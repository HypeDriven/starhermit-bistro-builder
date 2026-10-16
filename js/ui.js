/* Bistro Builder — DOM shell: dynamic screens, station mirror (the semantic
 * HTML layer over the 3D canvas), settings form, help, results breakdown.
 * No rules logic here beyond display helpers. Browser global: window.BBUI.
 */
(function (root) {
  'use strict';

  // Localized strings (js/i18n.js); content keeps English data, looked up by id.
  function t(key, vars, fallback) { return root.BBI18n ? root.BBI18n.t(key, vars, fallback) : (fallback != null ? fallback : key); }
  function tr(key, vars, fallback) { return t(key, vars, fallback); } // for scopes where `t` is a table
  function cfgName(cfg) {
    if (!cfg) return '';
    var id = String(cfg.id || '');
    if (cfg.kind === 'journey') return t('j.' + id, null, cfg.name);
    if (cfg.kind === 'challenge') return t('ch.' + id.replace(/^challenge-/, ''), null, cfg.name);
    if (cfg.kind === 'practice') return t('pd.' + id.replace(/^practice-/, ''), null, cfg.name);
    if (cfg.kind === 'daily') return t('daily.name', { date: cfg.date }, cfg.name);
    if (cfg.kind === 'learn') return t('l.' + id.replace(/^learn-/, ''), null, cfg.name);
    return cfg.name || '';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fmtClock(tickMsRemaining) {
    var s = Math.max(0, Math.ceil(tickMsRemaining / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  // Journey stars: 1 = goal met, 2 = strong score, 3 = par score.
  function starsFor(cfg, terminal) {
    if (!terminal || !terminal.win) return 0;
    var score = terminal.score.total;
    var par = cfg.par && cfg.par.score ? cfg.par.score : Infinity;
    if (score >= par) return 3;
    if (score >= par * 0.75) return 2;
    return 1;
  }

  // ---------- mode select ----------
  function buildModeList(container, opts) {
    container.innerHTML = '';
    var modes = [
      { id: 'learn', ranked: false }, { id: 'journey', ranked: false }, { id: 'daily', ranked: true },
      { id: 'practice', ranked: false }, { id: 'challenge', ranked: true }
    ].map(function (m) {
      return { id: m.id, ranked: m.ranked, name: t('mode.' + m.id), desc: t('mode.' + m.id + '.d'), dur: t('mode.' + m.id + '.dur') };
    });
    modes.forEach(function (m) {
      var card = el('button', 'card mode-card');
      card.type = 'button';
      card.appendChild(el('strong', null, m.name));
      card.appendChild(el('span', 'card-desc', m.desc));
      var meta = el('span', 'card-meta');
      meta.appendChild(el('span', null, '⏱ ' + m.dur));
      meta.appendChild(el('span', null, m.ranked ? t('mode.ranked') : t('mode.casual')));
      card.appendChild(meta);
      card.addEventListener('click', function () { opts.onPick(m.id); });
      container.appendChild(card);
    });
  }

  // ---------- journey grid ----------
  function buildJourneyGrid(container, stages, progress, opts) {
    container.innerHTML = '';
    stages.forEach(function (cfg, i) {
      var stars = progress.journeyStars[cfg.id] || 0;
      var unlocked = i === 0 || (progress.journeyStars[stages[i - 1].id] || 0) > 0;
      var b = el('button', 'level-cell' + (unlocked ? '' : ' locked') + (cfg.id.endsWith('5') || cfg.id.endsWith('0') ? ' mastery' : ''));
      b.type = 'button';
      b.disabled = !unlocked;
      b.setAttribute('aria-label', t(unlocked ? 'jcell.aria' : 'jcell.locked', { n: i + 1, name: cfgName(cfg), stars: stars }));
      b.appendChild(el('span', 'level-num', String(i + 1)));
      b.appendChild(el('span', 'level-stars', '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars)));
      b.title = t('jcell.title', { name: cfgName(cfg), goal: cfg.goal });
      if (unlocked) b.addEventListener('click', function () { opts.onPick(cfg); });
      container.appendChild(b);
    });
  }

  // ---------- setup screen bodies ----------
  function buildSetup(container, mode, data, opts) {
    container.innerHTML = '';
    if (mode === 'practice') {
      container.appendChild(el('p', 'setup-desc', t('practice.desc')));
      Object.keys(data.difficulties).forEach(function (key) {
        var d = data.difficulties[key];
        var b = el('button', 'card mode-card');
        b.type = 'button';
        b.appendChild(el('strong', null, t('pd.' + key, null, d.name)));
        b.appendChild(el('span', 'card-desc', t('practice.line',
          { a: d.spawnSec[0], b: d.spawnSec[1], c: d.patienceSec[0], d: d.patienceSec[1], day: d.daySec })));
        b.addEventListener('click', function () { opts.onStart({ difficulty: key }); });
        container.appendChild(b);
      });
      return;
    }
    if (mode === 'challenge') {
      container.appendChild(el('p', 'setup-desc', t('challenge.desc')));
      data.challenges.forEach(function (cfg) {
        var best = data.best[cfg.id];
        var b = el('button', 'card mode-card');
        b.type = 'button';
        var cid = String(cfg.id).replace(/^challenge-/, '');
        b.appendChild(el('strong', null, cfgName(cfg)));
        b.appendChild(el('span', 'card-desc', t('chd.' + cid, null, cfg.desc) + t('challenge.goal', { goal: cfg.goal, sec: cfg.daySec })));
        b.appendChild(el('span', 'card-meta', best != null ? t('challenge.best', { n: best }) : t('challenge.none')));
        b.addEventListener('click', function () { opts.onStart({ cfg: cfg }); });
        container.appendChild(b);
      });
      return;
    }
    if (mode === 'daily') {
      var cfg = data.cfg;
      container.appendChild(el('p', 'setup-desc', t('daily.desc')));
      var facts = el('ul', 'fact-list');
      [[t('daily.goal'), t('daily.goalV', { n: cfg.goal })], [t('daily.service'), t('daily.serviceV', { n: cfg.daySec })],
       [t('daily.tables'), t('daily.tablesV', { open: cfg.openTables, closed: cfg.closedTables })],
       [t('daily.guests'), t('daily.guestsV', { a: cfg.spawnSec[0], b: cfg.spawnSec[1] })],
       [t('daily.ranked'), t('daily.rankedV')]].forEach(function (f) {
        var li = el('li'); li.appendChild(el('strong', null, f[0] + ': ')); li.appendChild(document.createTextNode(f[1]));
        facts.appendChild(li);
      });
      container.appendChild(facts);
      if (data.done != null) container.appendChild(el('p', 'mini', t('daily.done', { n: data.done })));
      var start = el('button', 'btn primary big', t(data.done != null ? 'daily.replay' : 'daily.start'));
      start.type = 'button';
      start.addEventListener('click', function () { opts.onStart({ cfg: cfg }); });
      container.appendChild(start);
    }
  }

  // ---------- settings ----------
  function buildSettingsForm(form, settings, themes, opts) {
    form.innerHTML = '';
    // Labels carry data-i18n so a language change relabels the open form in place.
    function row(key, input) {
      var l = el('label', 'setting-row');
      var span = el('span', null, t(key));
      span.setAttribute('data-i18n', key);
      l.appendChild(span);
      l.appendChild(input);
      form.appendChild(l);
      return input;
    }
    function range(key, min, max, step) {
      var i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step;
      i.value = settings[key];
      i.addEventListener('input', function () { opts.onChange(key, parseFloat(i.value)); });
      return i;
    }
    function check(key) {
      var i = el('input'); i.type = 'checkbox'; i.checked = !!settings[key];
      i.addEventListener('change', function () { opts.onChange(key, i.checked); });
      return i;
    }
    function select(key, options) {
      var s = el('select');
      options.forEach(function (o) {
        var op = el('option', null, o.labelKey ? t(o.labelKey, null, o.label) : o.label); op.value = o.value;
        if (o.labelKey) op.setAttribute('data-i18n', o.labelKey);
        s.appendChild(op);
      });
      s.value = settings[key];
      s.addEventListener('change', function () { opts.onChange(key, s.value); });
      return s;
    }
    function heading(key) { var h = el('h3', null, t(key)); h.setAttribute('data-i18n', key); form.appendChild(h); }
    heading('set.audio');
    row('set.music', range('music', 0, 1, 0.05));
    row('set.effects', range('effects', 0, 1, 0.05));
    row('set.ambience', range('ambience', 0, 1, 0.05));
    row('set.voice', range('voice', 0, 1, 0.05));
    row('set.mute', check('muted'));
    row('set.captions', check('captions'));
    if (opts.buildGraphics) { // quality presets + per-effect overrides (js/gfx-panel.js)
      // The section wrapper also hosts the shared options panel (game-options.js);
      // gfx-panel.js redraws only the inner box, so that panel survives redraws.
      var gfx = el('div', 'gfx-section');
      gfx.id = 'gfx-section';
      var gfxInner = el('div', 'gfx-controls');
      gfx.appendChild(gfxInner);
      form.appendChild(gfx);
      opts.buildGraphics(gfxInner);
    }
    heading('set.display');
    row('set.theme', select('theme', Object.keys(themes).map(function (k) {
      return { value: k, label: themes[k].name, labelKey: 'theme.' + k };
    })));
    row('set.motion', check('reducedMotion'));
    row('set.contrast', check('highContrast'));
    row('set.palette', select('colorPalette', [
      { value: 'standard', labelKey: 'pal.standard' }, { value: 'high-visibility', labelKey: 'pal.hv' }]));
    heading('set.controls');
    row('set.large', check('largeText'));
    row('set.left', check('leftHanded'));
    row('set.mirror', check('boardMirror'));
    row('set.haptics', check('haptics'));
    row('set.speed', select('speed', [
      { value: 1, labelKey: 'speed.1' }, { value: 2, labelKey: 'speed.2' }]));
  }

  // ---------- help ----------
  function buildHelp(container, keysText) {
    container.innerHTML = '';
    var cards = [
      [t('help.loop'), t('help.loop.x')],
      [t('help.serving'), t('help.serving.x')],
      [t('help.spending'), t('help.spending.x')],
      [t('help.goal'), t('help.goal.x')],
      [t('help.keyboard'), (keysText || '') + t('help.keysTail')],
      [t('help.fair'), t('help.fair.x')]
    ];
    cards.forEach(function (c) {
      var d = el('div', 'help-card');
      d.appendChild(el('h3', null, c[0]));
      d.appendChild(el('p', null, c[1]));
      container.appendChild(d);
    });
  }

  // ---------- profile ----------
  function buildProfile(container, progress, achievementDefs) {
    container.innerHTML = '';
    var s = progress.stats;
    var facts = el('ul', 'fact-list');
    [[t('pf.rounds'), s.rounds], [t('pf.wins'), s.wins],
     [t('pf.served'), s.served], [t('pf.lost'), s.lost],
     [t('pf.hires'), s.hires], [t('pf.expansions'), s.expansions],
     [t('pf.best'), s.bestScore],
     [t('pf.time'), t('pf.min', { n: Math.round(s.playMs / 60000) })]].forEach(function (f) {
      var li = el('li'); li.appendChild(el('strong', null, f[0] + ': ')); li.appendChild(document.createTextNode(String(f[1])));
      facts.appendChild(li);
    });
    container.appendChild(facts);
    container.appendChild(el('h3', null, t('profile.ach')));
    var list = el('ul', 'ach-list');
    achievementDefs.forEach(function (a) {
      var got = progress.achievements[a.key];
      var li = el('li', got ? 'unlocked' : 'locked');
      li.appendChild(el('strong', null, (got ? '🏅 ' : '🔒 ') + t('ach.' + a.key, null, a.name)));
      li.appendChild(el('span', 'card-desc', t('ach.' + a.key + '.d', null, a.desc)));
      list.appendChild(li);
    });
    container.appendChild(list);
  }

  // ---------- leaderboard ----------
  // resolveName(userId) -> Promise<string> upgrades server rows carrying a
  // playerId to display names (profile nicknames); rows without one keep
  // their stored name ('You' locally).
  function buildLeaderboard(container, entries, rivals, title, resolveName) {
    container.innerHTML = '';
    if (title) container.appendChild(el('h3', null, title));
    var table = el('table', 'lb-table');
    var head = el('tr');
    ['#', t('lb.name'), t('lb.score'), t('lb.when')].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    var rows = entries.map(function (e) {
      return { name: e.you || !e.name || e.name === 'You' ? t('lb.you') : e.name, playerId: e.playerId, score: e.score, you: !!e.you, date: e.date || '' };
    }).concat((rivals || []).map(function (r) {
      return { name: t('lb.regular', { name: r.name }), score: r.score, you: false, date: '' };
    }));
    rows.sort(function (a, b) { return b.score - a.score; });
    rows.slice(0, 12).forEach(function (r, i) {
      var tr = el('tr', r.you ? 'you' : '');
      tr.appendChild(el('td', null, String(i + 1)));
      var nameTd = el('td', null, r.name);
      if (resolveName && r.playerId)
        resolveName(r.playerId).then(function (n) { nameTd.textContent = n; });
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, String(r.score)));
      tr.appendChild(el('td', null, r.date));
      table.appendChild(tr);
    });
    if (!rows.length) container.appendChild(el('p', 'mini', t('lb.empty')));
    else container.appendChild(table);
    if (rivals && rivals.length)
      container.appendChild(el('p', 'mini', t('lb.regulars')));
  }

  // ---------- station mirror (semantic HTML layer over the canvas) ----------
  function guestStatus(state, table) {
    if (!table.open) return { label: t('st.walled'), cls: 'closed' };
    if (table.guestId == null && table.reservedBy == null) return { label: t('st.free'), cls: 'free' };
    for (var i = 0; i < state.guests.length; i++) {
      var g = state.guests[i];
      if (g.tableId !== table.id) continue;
      if (g.status === 'eating') return { label: t('st.eating'), cls: 'eating' };
      if (g.status === 'seated') {
        var ratio = g.patience / g.maxPatience;
        return { label: t('st.waiting', { s: Math.ceil(g.patience / 10) }), cls: ratio < 0.3 ? 'urgent' : 'waiting' };
      }
      return { label: t('st.seating'), cls: 'free' };
    }
    return { label: t('st.free'), cls: 'free' };
  }

  // Panels rebuild from state every tick; without this a keyboard user loses
  // focus mid-Tab before they can activate a station or upgrade button.
  function rebuildKeepingFocus(container, rebuild) {
    var active = document.activeElement;
    var key = active && container.contains(active) ? active.getAttribute('data-fkey') : null;
    rebuild();
    if (key) {
      var next = container.querySelector('[data-fkey="' + key + '"]');
      if (next) next.focus();
    }
  }

  function updateStationsMirror(container, state, opts) {
    rebuildKeepingFocus(container, function () {
    container.innerHTML = '';
    var p = state.waiters[0];

    var tray = el('div', 'mirror-tray');
    tray.appendChild(el('strong', null, t('m.tray', { c: p.carrying, cap: p.capacity, s: state.stock })));
    container.appendChild(tray);

    var queueCount = state.guests.filter(function (g) { return g.status === 'queue'; }).length;
    container.appendChild(el('p', 'mini', t(queueCount === 1 ? 'm.door1' : 'm.doorN', { n: queueCount })));

    var list = el('ul', 'station-list');
    state.tables.forEach(function (t) {
      if (!t.open) return;
      var st = guestStatus(state, t);
      var li = el('li', 'station ' + st.cls);
      var label = el('span', 'station-label', tr('m.table', { n: t.id + 1, status: st.label }));
      li.appendChild(label);
      if (st.cls === 'waiting' || st.cls === 'urgent') {
        var b = el('button', 'btn small', tr('m.serve'));
        b.type = 'button';
        b.setAttribute('aria-label', tr('m.serveAria', { n: t.id + 1 }));
        b.setAttribute('data-fkey', 'serve-' + t.id);
        b.addEventListener('click', function () { opts.onAction({ type: 'serve', table: t.id }); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    var kitchen = el('li', 'station kitchen');
    kitchen.appendChild(el('span', 'station-label', t('m.kitchen', { n: state.stock })));
    var pk = el('button', 'btn small', t('m.pickup'));
    pk.type = 'button';
    pk.setAttribute('data-fkey', 'pickup');
    pk.disabled = !(state.stock > 0 && p.carrying < p.capacity);
    pk.addEventListener('click', function () { opts.onAction({ type: 'pickup' }); });
    kitchen.appendChild(pk);
    list.appendChild(kitchen);
    container.appendChild(list);
    });
  }

  // ---------- upgrade panel ----------
  var BUY_LABELS = {
    capacity: 'Bigger tray', helper: 'Hire helper', stove: 'Extra stove', expand: 'Expand floor'
  };
  function buyLabel(item) { return t('buy.' + item, null, BUY_LABELS[item] || item); }
  function updateUpgradePanel(container, state, buyInfoFn, opts) {
    rebuildKeepingFocus(container, function () {
    container.innerHTML = '';
    ['capacity', 'helper', 'stove', 'expand'].forEach(function (item) {
      if (!state.cfg.mechanics[item]) return;
      var info = buyInfoFn(state, item);
      var b = el('button', 'btn upgrade');
      b.type = 'button';
      b.setAttribute('data-fkey', 'buy-' + item);
      var label = buyLabel(item);
      if (info.ok) {
        b.appendChild(document.createTextNode(label + ' '));
        b.appendChild(el('span', 'cost', info.cost + 'c'));
        b.addEventListener('click', function () { opts.onAction({ type: 'buy', item: item }); });
      } else {
        b.disabled = true;
        b.appendChild(document.createTextNode(label + ' '));
        b.appendChild(el('span', 'cost',
          info.reason === 'cap-reached' ? t('buy.max') : (info.cost != null ? info.cost + 'c' : '—')));
      }
      container.appendChild(b);
    });
    });
  }

  // ---------- results breakdown ----------
  function buildResults(tbody, terminal, cfg) {
    tbody.innerHTML = '';
    var s = terminal.score;
    var rows = [
      [t('r.served'), s.served + ' × ' + cfg.price + 'c', s.servePoints],
      [t('r.tips'), '', s.tips],
      [t('r.time'), '', s.timeBonus],
      [t('r.lost'), s.lost + ' × −10', -s.lost * 10]
    ];
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r[0]));
      tr.appendChild(el('td', 'mini', String(r[1])));
      tr.appendChild(el('td', 'pts', (r[2] >= 0 ? '+' : '') + r[2]));
      tbody.appendChild(tr);
    });
    var total = el('tr', 'total-row');
    total.appendChild(el('td', null, t('r.total')));
    total.appendChild(el('td'));
    total.appendChild(el('td', 'pts', String(s.total)));
    tbody.appendChild(total);
  }

  root.BBUI = {
    el: el,
    fmtClock: fmtClock,
    starsFor: starsFor,
    buildModeList: buildModeList,
    buildJourneyGrid: buildJourneyGrid,
    buildSetup: buildSetup,
    buildSettingsForm: buildSettingsForm,
    buildHelp: buildHelp,
    buildProfile: buildProfile,
    buildLeaderboard: buildLeaderboard,
    updateStationsMirror: updateStationsMirror,
    updateUpgradePanel: updateUpgradePanel,
    buildResults: buildResults,
    BUY_LABELS: BUY_LABELS,
    buyLabel: buyLabel,
    cfgName: cfgName,
    t: t
  };
})(typeof self !== 'undefined' ? self : this);
