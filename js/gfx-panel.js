/* Bistro Builder — the Graphics section of the Settings screen.
 * Quality preset (Auto + four presets), render scale, one select per effect
 * category ("From preset (…)" by default), adaptive resolution, frame-rate
 * readout, and a "GPU · cost · W×H px" summary. Every control has a stable
 * id and data-gfx attribute for tests. Changes are reported through
 * opts.onChange(nextSaved); the caller persists and applies them.
 */
import { PRESETS, CATEGORIES, presetTier, resolve, choosePreset, setOverride, describe, clampScale, DEFAULTS } from './gfx.js';
import { strings, fmt } from './gfx-strings.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * opts: { saved(): object, detected(): preset, info(): {gpu, pixels, postFailed} | null,
 *         onChange(nextSaved), locale }
 */
export function buildGraphicsSection(container, opts) {
  const S = strings(opts.locale);

  function render() {
    const focusId = document.activeElement && container.contains(document.activeElement) ? document.activeElement.id : null;
    container.innerHTML = '';
    const saved = Object.assign({}, DEFAULTS, opts.saved() || {});
    const detected = opts.detected();
    const r = resolve(saved, detected);

    container.appendChild(el('h3', null, S.graphics));

    function row(id, label, input) {
      const l = el('label', 'setting-row');
      l.setAttribute('for', id);
      input.id = id;
      l.appendChild(el('span', null, label));
      l.appendChild(input);
      container.appendChild(l);
      return input;
    }
    function commit(next) { opts.onChange(next); render(); }

    // quality preset
    const preset = el('select');
    preset.setAttribute('data-gfx', 'preset');
    const autoOpt = el('option', null, fmt(S.auto, S.preset[detected] || detected));
    autoOpt.value = 'auto';
    preset.appendChild(autoOpt);
    PRESETS.forEach(p => { const o = el('option', null, S.preset[p]); o.value = p; preset.appendChild(o); });
    preset.value = PRESETS.includes(saved.preset) ? saved.preset : 'auto';
    preset.addEventListener('change', () => commit(choosePreset(saved, preset.value)));
    row('gfx-preset', S.quality, preset);

    // render scale (percent of the preset's own scale)
    const scaleWrap = el('span', 'gfx-scale');
    const scale = el('input');
    scale.type = 'range'; scale.min = 50; scale.max = 200; scale.step = 5;
    scale.value = Math.round(clampScale(saved.render_scale) * 100);
    scale.setAttribute('data-gfx', 'render_scale');
    const out = el('output', 'gfx-scale-out', scale.value + '%');
    out.setAttribute('for', 'gfx-scale');
    scale.addEventListener('input', () => { out.textContent = scale.value + '%'; });
    scale.addEventListener('change', () => {
      const next = Object.assign({}, saved, { render_scale: clampScale(Number(scale.value) / 100) });
      commit(next);
    });
    scale.id = 'gfx-scale';
    scaleWrap.appendChild(scale); scaleWrap.appendChild(out);
    const sl = el('label', 'setting-row');
    sl.setAttribute('for', 'gfx-scale');
    sl.appendChild(el('span', null, S.renderScale));
    sl.appendChild(scaleWrap);
    container.appendChild(sl);

    // one select per category
    Object.keys(CATEGORIES).forEach(cat => {
      const s = el('select');
      s.setAttribute('data-gfx-cat', cat);
      const tierName = t => (S.tier[t] || t);
      const def = el('option', null, fmt(S.fromPreset, tierName(presetTier(r.preset, cat))));
      def.value = 'preset';
      s.appendChild(def);
      CATEGORIES[cat].forEach(t => { const o = el('option', null, tierName(t)); o.value = t; s.appendChild(o); });
      s.value = CATEGORIES[cat].includes(saved[cat]) ? saved[cat] : 'preset';
      s.addEventListener('change', () => commit(setOverride(saved, cat, s.value)));
      row('gfx-' + cat, S.cat[cat] || cat, s);
    });

    // toggles
    function toggle(id, key, label, value) {
      const i = el('input');
      i.type = 'checkbox'; i.checked = value;
      i.setAttribute('data-gfx', key);
      i.addEventListener('change', () => commit(Object.assign({}, saved, { [key]: i.checked })));
      row(id, label, i);
    }
    toggle('gfx-adaptive', 'adaptive', S.adaptive, saved.adaptive !== false);
    toggle('gfx-fps', 'show_fps', S.showFps, !!saved.show_fps);

    // summary: GPU · cost · W×H px
    const info = opts.info() || {};
    const summary = el('p', 'mini gfx-summary',
      (info.gpu || S.unknownGpu) + ' · ' + describe(r, info.pixels, S.words));
    summary.id = 'gfx-summary';
    summary.setAttribute('data-gfx-preset', r.preset);
    summary.setAttribute('aria-live', 'polite');
    container.appendChild(summary);
    if (info.postFailed) {
      const note = el('p', 'mini gfx-note', S.postUnavailable);
      note.id = 'gfx-post-note';
      container.appendChild(note);
    }

    if (focusId) { const f = document.getElementById(focusId); if (f) f.focus(); }
  }

  render();
  return render;
}
