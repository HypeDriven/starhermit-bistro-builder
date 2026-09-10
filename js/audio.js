/* Bistro Builder — WebAudio: authored one-shot samples (sfx/*.opus) preferred
 * per logical event, with procedural synthesis kept as fallback while a clip
 * loads or if it fails. Quiet crowd ambience and adaptive music pad remain
 * synthesized. Global: BBAudio.
 */
(function (root) {
  'use strict';

  var ctx = null, master = null;
  var buses = {}; // music, effects, ambience, voice
  var settings = { music: 0.5, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false };
  var captions = false;
  var captionFn = null;
  var started = false;
  var musicTimer = null, ambienceNodes = null, murmurTimer = null;
  var avRng = null; // seeded variants for replay consistency

  function ensureCtx() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    ['music', 'effects', 'ambience', 'voice'].forEach(function (name) {
      var g = ctx.createGain();
      g.gain.value = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      g.connect(master);
      buses[name] = g;
    });
    return true;
  }

  function applySettings(s) {
    Object.assign(settings, s || {});
    if (!ctx) return;
    Object.keys(buses).forEach(function (name) {
      var v = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      buses[name].gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    });
  }

  function caption(text) {
    if (captions && captionFn && text) captionFn(text);
  }

  // ---------- primitive builders ----------
  function blip(freq, dur, type, gain, bus, when, sweepTo) {
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(buses[bus || 'effects']);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, gain, cutoff, when, type) { // filtered noise = clatter / impact
    var t = when || ctx.currentTime;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = cutoff;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(buses.effects);
    src.start(t);
  }

  function variant(base) { // seeded pitch variant (±6%) when replay consistency matters
    var r = avRng ? avRng.next() : Math.random();
    return base * (0.94 + r * 0.12);
  }

  // ---------- event map ----------
  var CAPTIONS = { // accessibility captions, emitted for sample and synth alike
    'cmd': 'order noted', 'spawn': 'guest arrives', 'dish-ready': 'dish ready',
    'pickup': 'dishes picked up', 'serve': 'guest served',
    'leave-angry': 'guest left angry', 'buy': 'upgrade bought',
    'invalid': 'not allowed', 'win': 'day complete', 'lose': 'goal missed',
    'undo': 'rewind', 'hint': 'hint',
    'service-start': 'service begins', 'expand': 'wall knocked down',
    'urgent': 'guest losing patience', 'hire': 'helper hired'
  };
  var SFX = {
    'ui':         function () { blip(620, 0.06, 'triangle', 0.12); },
    'cmd':        function () { blip(variant(480), 0.07, 'sine', 0.14); },
    'spawn':      function () { blip(variant(740), 0.12, 'sine', 0.09); blip(variant(988), 0.14, 'sine', 0.07, 'effects', ctx.currentTime + 0.07); },
    'seat':       function () { noise(0.05, 0.12, 1800); },
    'dish-ready': function () { blip(1047, 0.18, 'sine', 0.1); blip(1319, 0.22, 'sine', 0.07, 'effects', ctx.currentTime + 0.08); },
    'pickup':     function () { noise(0.06, 0.3, 2600); blip(variant(340), 0.06, 'triangle', 0.1); },
    'serve':      function () {
      noise(0.05, 0.22, 3200);
      blip(variant(880), 0.09, 'triangle', 0.13);
      blip(variant(1175), 0.12, 'triangle', 0.1, 'effects', ctx.currentTime + 0.06);
    },
    'leave-angry':function () { blip(220, 0.25, 'sawtooth', 0.07, 'effects', ctx.currentTime, 140); },
    'leave-happy':function () { blip(variant(660), 0.08, 'sine', 0.06); },
    'buy':        function () {
      [523, 659, 784].forEach(function (f, i) {
        blip(f, 0.14, 'triangle', 0.12, 'effects', ctx.currentTime + i * 0.05);
      });
      noise(0.04, 0.18, 4000, ctx.currentTime);
    },
    'invalid':    function () { blip(170, 0.16, 'square', 0.07); blip(150, 0.14, 'square', 0.05, 'effects', ctx.currentTime + 0.05); },
    'win':        function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        blip(f, 0.45, 'triangle', 0.13, 'effects', ctx.currentTime + i * 0.11);
      });
    },
    'lose':       function () { blip(320, 0.5, 'sine', 0.15, 'effects', ctx.currentTime, 200); blip(210, 0.6, 'sine', 0.1, 'effects', ctx.currentTime + 0.16, 130); },
    'undo':       function () { blip(500, 0.08, 'triangle', 0.1, 'effects', ctx.currentTime, 380); },
    'hint':       function () { blip(990, 0.12, 'sine', 0.1); blip(1320, 0.14, 'sine', 0.07, 'effects', ctx.currentTime + 0.07); },
    // hand bell rung twice: countdown ends, service opens
    'service-start': function () {
      [0, 0.22].forEach(function (d) {
        blip(1568, 0.3, 'triangle', 0.12, 'effects', ctx.currentTime + d);
        blip(2349, 0.22, 'sine', 0.06, 'effects', ctx.currentTime + d + 0.01);
      });
    },
    // mallet through a wall: low thud + falling rubble clatter
    'expand':     function () { noise(0.12, 0.35, 900); noise(0.3, 0.18, 2400, ctx.currentTime + 0.1); blip(90, 0.2, 'sine', 0.16, 'effects', ctx.currentTime, 50); },
    // two hollow wood-block knocks: a guest is about to walk out
    'urgent':     function () { blip(1100, 0.05, 'square', 0.06); blip(1100, 0.05, 'square', 0.06, 'effects', ctx.currentTime + 0.11); },
    // apron snap + two claps: helper hired
    'hire':       function () { noise(0.05, 0.25, 3000); noise(0.04, 0.22, 3600, ctx.currentTime + 0.18); noise(0.04, 0.22, 3600, ctx.currentTime + 0.3); }
  };

  // ---------- authored samples: lazy fetch/decode/cache, synth is fallback ----------
  var SAMPLES = { // event -> clip basename, served from sfx/<name>.opus (see sfx/manifest.json)
    'ui': 'ui-tap', 'cmd': 'order-noted', 'spawn': 'guest-arrive',
    'seat': 'chair-scrape', 'dish-ready': 'dish-ready-bell', 'pickup': 'tray-pickup',
    'serve': 'plate-serve', 'leave-angry': 'door-slam', 'leave-happy': 'guest-thanks',
    'buy': 'cash-register', 'invalid': 'error-buzz', 'win': 'day-complete-fanfare',
    'lose': 'day-missed', 'undo': 'rewind-swoosh', 'hint': 'hint-sparkle',
    'service-start': 'service-open-bell', 'expand': 'wall-knock',
    'urgent': 'patience-tick', 'hire': 'helper-hired'
  };
  var AMBIENCE_SAMPLE = 'bistro-ambience'; // 10 s room-tone loop on the ambience bus
  var sampleCache = {}; // basename -> 'loading' | AudioBuffer | null (failed)

  function loadSample(name, onLoaded) {
    if (sampleCache[name] !== undefined) return; // one fetch per clip, no duplicates
    sampleCache[name] = 'loading';
    fetch('sfx/' + name + '.opus')
      .then(function (res) {
        if (!res.ok) throw new Error('http-' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) { return ctx.decodeAudioData(buf); })
      .then(function (audio) { sampleCache[name] = audio; if (onLoaded) onLoaded(audio); })
      .catch(function () { sampleCache[name] = null; }); // permanent synth fallback
  }

  function playSample(name) { // true when an authored clip actually started
    var buf = sampleCache[name];
    if (buf === undefined) { loadSample(name); return false; }
    if (buf === 'loading' || buf === null) return false;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(buses.effects); // effects bus: mute/volume apply as for synthesis
    src.start();
    return true;
  }

  function play(name) {
    if (!started || !ctx || settings.muted) return;
    if (ctx.state === 'suspended') ctx.resume();
    caption(CAPTIONS[name]);
    var fn = SFX[name];
    if (!fn) return;
    var sample = SAMPLES[name];
    if (sample && playSample(sample)) return; // authored clip preferred
    fn(); // synthesized fallback while the clip loads or after a failure
  }

  // ---------- ambience: low room tone + occasional soft clinks ----------
  function startAmbience() {
    if (!ctx || ambienceNodes) return;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) { // brown-ish noise = distant crowd
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.0;
    }
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    var g = ctx.createGain(); g.gain.value = 0.5;
    src.connect(f); f.connect(g); g.connect(buses.ambience);
    src.start();
    ambienceNodes = { src: src, gain: g };
    // Authored room tone replaces the synthesized bed once it has decoded;
    // the synth keeps playing if the clip is missing or fails to decode.
    loadSample(AMBIENCE_SAMPLE, function (audio) {
      if (!ctx || !ambienceNodes || ambienceNodes.authored) return;
      var loop = ctx.createBufferSource();
      loop.buffer = audio; loop.loop = true;
      loop.loopStart = 0.05; loop.loopEnd = Math.max(0.5, audio.duration - 0.08); // skip the encoded fades
      var lg = ctx.createGain(); lg.gain.value = 0.9;
      loop.connect(lg); lg.connect(buses.ambience);
      loop.start(0, 0.05);
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      ambienceNodes.authored = loop;
    });
    var clink = function () {
      if (!ctx || settings.muted) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 1800 + Math.random() * 1400;
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.02, t + 0.005);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(og); og.connect(buses.ambience);
      o.start(t); o.stop(t + 0.15);
      murmurTimer = setTimeout(clink, 2500 + Math.random() * 5000);
    };
    murmurTimer = setTimeout(clink, 2000);
  }

  // ---------- music: warm generative pad, seeded chord walk ----------
  var CHORDS = [
    [261.63, 329.63, 392.0],  // C E G
    [293.66, 349.23, 440.0],  // D F A
    [246.94, 293.66, 392.0],  // B D G
    [220.0, 261.63, 329.63]   // A C E
  ];
  var chordIdx = 0;
  function schedulePad() {
    if (!ctx || settings.muted) return;
    var t = ctx.currentTime + 0.1;
    var chord = CHORDS[chordIdx % CHORDS.length];
    chordIdx++;
    chord.forEach(function (freq, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = freq * 0.5;
      f.type = 'lowpass'; f.frequency.value = 650;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 1.6);
      g.gain.linearRampToValueAtTime(0.0001, t + 5.8);
      o.connect(f); f.connect(g); g.connect(buses.music);
      o.start(t); o.stop(t + 6.0);
    });
  }
  function startMusic() {
    if (musicTimer || !ctx) return;
    schedulePad();
    musicTimer = setInterval(schedulePad, 4800);
  }

  function start() {
    if (!ensureCtx()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    started = true;
    startAmbience();
    startMusic();
    return true;
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && started && ctx.state === 'suspended') ctx.resume(); }

  function setAvRng(rng) { avRng = rng; }
  function setCaptions(on, fn) { captions = !!on; captionFn = fn || captionFn; }

  root.BBAudio = {
    start: start, play: play, applySettings: applySettings,
    suspend: suspend, resume: resume, setAvRng: setAvRng, setCaptions: setCaptions,
    isStarted: function () { return started; }
  };
})(typeof self !== 'undefined' ? self : this);
