/* Bistro Builder — DOM shell: dynamic screens, station mirror (the semantic
 * HTML layer over the 3D canvas), settings form, help, results breakdown.
 * No rules logic here beyond display helpers. Browser global: window.BBUI.
 */
(function (root) {
  'use strict';

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
      { id: 'learn', name: 'Learn', desc: 'Five short interactive lessons — one rule at a time.', dur: '5 min', ranked: false },
      { id: 'journey', name: 'Journey', desc: '40 authored stages from first service to star service.', dur: '2–4 min/stage', ranked: false },
      { id: 'daily', name: 'Daily challenge', desc: 'One shared seed and ruleset per UTC day. Ranked locally.', dur: '2.5 min', ranked: true },
      { id: 'practice', name: 'Practice', desc: 'Relaxed service with rewind and hints. Not ranked.', dur: '3 min', ranked: false },
      { id: 'challenge', name: 'Challenge', desc: 'Constrained scenarios: solo sprints, one tray, rush hour.', dur: '1.5–5 min', ranked: true }
    ];
    modes.forEach(function (m) {
      var card = el('button', 'card mode-card');
      card.type = 'button';
      card.appendChild(el('strong', null, m.name));
      card.appendChild(el('span', 'card-desc', m.desc));
      var meta = el('span', 'card-meta');
      meta.appendChild(el('span', null, '⏱ ' + m.dur));
      meta.appendChild(el('span', null, m.ranked ? '🏆 ranked' : 'casual'));
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
      b.setAttribute('aria-label', 'Stage ' + (i + 1) + ' ' + cfg.name + (unlocked ? ', ' + stars + ' stars' : ', locked'));
      b.appendChild(el('span', 'level-num', String(i + 1)));
      b.appendChild(el('span', 'level-stars', '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars)));
      b.title = cfg.name + ' — goal ' + cfg.goal + ' coins';
      if (unlocked) b.addEventListener('click', function () { opts.onPick(cfg); });
      container.appendChild(b);
    });
  }

  // ---------- setup screen bodies ----------
  function buildSetup(container, mode, data, opts) {
    container.innerHTML = '';
    if (mode === 'practice') {
      container.appendChild(el('p', 'setup-desc', 'Pick a pace. Rewind and hints are on; results are never ranked.'));
      Object.keys(data.difficulties).forEach(function (key) {
        var d = data.difficulties[key];
        var b = el('button', 'card mode-card');
        b.type = 'button';
        b.appendChild(el('strong', null, d.name));
        b.appendChild(el('span', 'card-desc',
          'Guests every ' + d.spawnSec[0] + '–' + d.spawnSec[1] + 's · patience ' + d.patienceSec[0] + '–' + d.patienceSec[1] + 's · ' + d.daySec + 's day'));
        b.addEventListener('click', function () { opts.onStart({ difficulty: key }); });
        container.appendChild(b);
      });
      return;
    }
    if (mode === 'challenge') {
      container.appendChild(el('p', 'setup-desc', 'Constrained scenarios. Ranked locally against the house regulars.'));
      data.challenges.forEach(function (cfg) {
        var best = data.best[cfg.id];
        var b = el('button', 'card mode-card');
        b.type = 'button';
        b.appendChild(el('strong', null, cfg.name));
        b.appendChild(el('span', 'card-desc', cfg.desc + ' Goal: ' + cfg.goal + ' coins in ' + cfg.daySec + 's.'));
        b.appendChild(el('span', 'card-meta', best != null ? 'Best: ' + best : 'Not attempted'));
        b.addEventListener('click', function () { opts.onStart({ cfg: cfg }); });
        container.appendChild(b);
      });
      return;
    }
    if (mode === 'daily') {
      var cfg = data.cfg;
      container.appendChild(el('p', 'setup-desc',
        'Today’s shared ruleset — same seed for everyone, all day (UTC).'));
      var facts = el('ul', 'fact-list');
      [['Goal', cfg.goal + ' coins'], ['Service', cfg.daySec + ' s'],
       ['Tables', cfg.openTables + ' open, ' + cfg.closedTables + ' walled off'],
       ['Guests', 'every ' + cfg.spawnSec[0] + '–' + cfg.spawnSec[1] + ' s'],
       ['Ranked', 'yes — local board + house regulars']].forEach(function (f) {
        var li = el('li'); li.appendChild(el('strong', null, f[0] + ': ')); li.appendChild(document.createTextNode(f[1]));
        facts.appendChild(li);
      });
      container.appendChild(facts);
      if (data.done != null) container.appendChild(el('p', 'mini', 'Already served today: ' + data.done + ' points. You can replay to improve.'));
      var start = el('button', 'btn primary big', data.done != null ? 'Replay today’s service' : 'Start today’s service');
      start.type = 'button';
      start.addEventListener('click', function () { opts.onStart({ cfg: cfg }); });
      container.appendChild(start);
    }
  }

  // ---------- settings ----------
  function buildSettingsForm(form, settings, themes, opts) {
    form.innerHTML = '';
    function row(label, input) {
      var l = el('label', 'setting-row');
      l.appendChild(el('span', null, label));
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
        var op = el('option', null, o.label); op.value = o.value; s.appendChild(op);
      });
      s.value = settings[key];
      s.addEventListener('change', function () { opts.onChange(key, s.value); });
      return s;
    }
    form.appendChild(el('h3', null, 'Audio'));
    row('Music', range('music', 0, 1, 0.05));
    row('Effects', range('effects', 0, 1, 0.05));
    row('Ambience', range('ambience', 0, 1, 0.05));
    row('Voice', range('voice', 0, 1, 0.05));
    row('Mute all', check('muted'));
    row('Captions for sound cues', check('captions'));
    form.appendChild(el('h3', null, 'Graphics'));
    row('Quality tier', select('graphicsTier', [
      { value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]));
    row('Theme', select('theme', Object.keys(themes).map(function (k) {
      return { value: k, label: themes[k].name };
    })));
    row('Reduced motion', check('reducedMotion'));
    row('High contrast', check('highContrast'));
    row('Color-vision-safe palette', select('colorPalette', [
      { value: 'standard', label: 'Standard' }, { value: 'high-visibility', label: 'High visibility' }]));
    form.appendChild(el('h3', null, 'Controls & access'));
    row('Larger text', check('largeText'));
    row('Left-handed layout', check('leftHanded'));
    row('Always show station panel', check('boardMirror'));
    row('Haptics', check('haptics'));
    row('Fast-forward speed', select('speed', [
      { value: 1, label: '1× normal' }, { value: 2, label: '2× fast' }]));
  }

  // ---------- help ----------
  function buildHelp(container) {
    container.innerHTML = '';
    var cards = [
      ['The loop', 'Guests arrive at the door and seat themselves. Stoves cook dishes into the kitchen stock. Carry dishes to waiting tables before patience runs out — served guests pay coins plus a tip for fast service.'],
      ['Serving', 'Tap a table with a waiting guest (or press its number key). If your tray is empty, you grab dishes from the kitchen on the way. Amber patience rings mean hurry.'],
      ['Spending coins', 'Tray upgrades carry more dishes, helper waiters serve on their own, extra stoves cook faster, and expansion opens walled-off tables. Coins spent still count toward the day’s earnings goal.'],
      ['Goal', 'Earn the goal in coins before service ends. Finish early for a time bonus. Guests who leave angry cost score.'],
      ['Keyboard', '1–9 serve table · K pick up dishes · H hint · U rewind (practice) · C camera · F fast-forward · P/Esc pause. Tab moves through every control; all actions have DOM buttons in the station panel.'],
      ['Fair play', 'Randomness is seeded and shown on the results screen. Ranked modes are the daily challenge and the six challenges.']
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
    [['Days of service', s.rounds], ['Goals met', s.wins],
     ['Guests served', s.served], ['Guests lost', s.lost],
     ['Helpers hired', s.hires], ['Expansions built', s.expansions],
     ['Best single-day score', s.bestScore],
     ['Time in the bistro', Math.round(s.playMs / 60000) + ' min']].forEach(function (f) {
      var li = el('li'); li.appendChild(el('strong', null, f[0] + ': ')); li.appendChild(document.createTextNode(String(f[1])));
      facts.appendChild(li);
    });
    container.appendChild(facts);
    container.appendChild(el('h3', null, 'Achievements'));
    var list = el('ul', 'ach-list');
    achievementDefs.forEach(function (a) {
      var got = progress.achievements[a.key];
      var li = el('li', got ? 'unlocked' : 'locked');
      li.appendChild(el('strong', null, (got ? '🏅 ' : '🔒 ') + a.name));
      li.appendChild(el('span', 'card-desc', a.desc));
      list.appendChild(li);
    });
    container.appendChild(list);
  }

  // ---------- leaderboard ----------
  function buildLeaderboard(container, entries, rivals, title) {
    container.innerHTML = '';
    if (title) container.appendChild(el('h3', null, title));
    var table = el('table', 'lb-table');
    var head = el('tr');
    ['#', 'Name', 'Score', 'When'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    var rows = entries.map(function (e) {
      return { name: e.name || 'You', score: e.score, you: !!e.you, date: e.date || '' };
    }).concat((rivals || []).map(function (r) {
      return { name: r.name + ' (regular)', score: r.score, you: false, date: '' };
    }));
    rows.sort(function (a, b) { return b.score - a.score; });
    rows.slice(0, 12).forEach(function (r, i) {
      var tr = el('tr', r.you ? 'you' : '');
      tr.appendChild(el('td', null, String(i + 1)));
      tr.appendChild(el('td', null, r.name));
      tr.appendChild(el('td', null, String(r.score)));
      tr.appendChild(el('td', null, r.date));
      table.appendChild(tr);
    });
    if (!rows.length) container.appendChild(el('p', 'mini', 'No scores yet — serve a day to post one.'));
    else container.appendChild(table);
    if (rivals && rivals.length)
      container.appendChild(el('p', 'mini', '“Regulars” are deterministic local rivals generated from the day’s seed — offline stand-ins for global boards.'));
  }

  // ---------- station mirror (semantic HTML layer over the canvas) ----------
  function guestStatus(state, table) {
    if (!table.open) return { label: 'Walled off', cls: 'closed' };
    if (table.guestId == null && table.reservedBy == null) return { label: 'Free', cls: 'free' };
    for (var i = 0; i < state.guests.length; i++) {
      var g = state.guests[i];
      if (g.tableId !== table.id) continue;
      if (g.status === 'eating') return { label: 'Eating', cls: 'eating' };
      if (g.status === 'seated') {
        var ratio = g.patience / g.maxPatience;
        return { label: 'Waiting · ' + Math.ceil(g.patience / 10) + 's', cls: ratio < 0.3 ? 'urgent' : 'waiting' };
      }
      return { label: 'Being seated', cls: 'free' };
    }
    return { label: 'Free', cls: 'free' };
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
    tray.appendChild(el('strong', null, 'Tray: ' + p.carrying + '/' + p.capacity + ' · Kitchen stock: ' + state.stock));
    container.appendChild(tray);

    var queueCount = state.guests.filter(function (g) { return g.status === 'queue'; }).length;
    container.appendChild(el('p', 'mini', queueCount + ' guest(s) at the door'));

    var list = el('ul', 'station-list');
    state.tables.forEach(function (t) {
      if (!t.open) return;
      var st = guestStatus(state, t);
      var li = el('li', 'station ' + st.cls);
      var label = el('span', 'station-label', 'Table ' + (t.id + 1) + ' — ' + st.label);
      li.appendChild(label);
      if (st.cls === 'waiting' || st.cls === 'urgent') {
        var b = el('button', 'btn small', 'Serve');
        b.type = 'button';
        b.setAttribute('aria-label', 'Serve table ' + (t.id + 1));
        b.setAttribute('data-fkey', 'serve-' + t.id);
        b.addEventListener('click', function () { opts.onAction({ type: 'serve', table: t.id }); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    var kitchen = el('li', 'station kitchen');
    kitchen.appendChild(el('span', 'station-label', 'Kitchen — ' + state.stock + ' dish(es) ready'));
    var pk = el('button', 'btn small', 'Pick up');
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
  function updateUpgradePanel(container, state, buyInfoFn, opts) {
    rebuildKeepingFocus(container, function () {
    container.innerHTML = '';
    ['capacity', 'helper', 'stove', 'expand'].forEach(function (item) {
      if (!state.cfg.mechanics[item]) return;
      var info = buyInfoFn(state, item);
      var b = el('button', 'btn upgrade');
      b.type = 'button';
      b.setAttribute('data-fkey', 'buy-' + item);
      var label = BUY_LABELS[item];
      if (info.ok) {
        b.appendChild(document.createTextNode(label + ' '));
        b.appendChild(el('span', 'cost', info.cost + 'c'));
        b.addEventListener('click', function () { opts.onAction({ type: 'buy', item: item }); });
      } else {
        b.disabled = true;
        b.appendChild(document.createTextNode(label + ' '));
        b.appendChild(el('span', 'cost',
          info.reason === 'cap-reached' ? 'max' : (info.cost != null ? info.cost + 'c' : '—')));
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
      ['Guests served', s.served + ' × ' + cfg.price + 'c', s.servePoints],
      ['Tips for fast service', '', s.tips],
      ['Time bonus', '', s.timeBonus],
      ['Guests lost', s.lost + ' × −10', -s.lost * 10]
    ];
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r[0]));
      tr.appendChild(el('td', 'mini', String(r[1])));
      tr.appendChild(el('td', 'pts', (r[2] >= 0 ? '+' : '') + r[2]));
      tbody.appendChild(tr);
    });
    var total = el('tr', 'total-row');
    total.appendChild(el('td', null, 'Total'));
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
    BUY_LABELS: BUY_LABELS
  };
})(typeof self !== 'undefined' ? self : this);
