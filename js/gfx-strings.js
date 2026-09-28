/* Bistro Builder — strings for the Graphics settings section, per locale.
 * The locale follows navigator.language (exact tag, then language fallback,
 * then en-US). Pure data + lookup; no DOM.
 */

const EN = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  preset: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
  cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade', antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Steam particles', detail: 'Surface detail', animation: 'Ambient animation' },
  tier: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed', static: 'Static', animated: 'Animated' },
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postUnavailable: 'Post-processing is unavailable on this device; the bistro renders without it.',
  unknownGpu: 'unknown GPU',
  words: { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing' }
};

const STRINGS = {
  'en-US': Object.assign({}, EN, {
    cat: Object.assign({}, EN.cat, { grade: 'Color grade' })
  }),
  'en-GB': EN,
  'es-419': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    preset: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
    cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Partículas de vapor', detail: 'Detalle de superficies', animation: 'Animación ambiental' },
    tier: { off: 'No', on: 'Sí', low: 'Baja', medium: 'Media', high: 'Alta', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado', static: 'Estática', animated: 'Animada' },
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar cuadros por segundo',
    postUnavailable: 'El posprocesamiento no está disponible en este dispositivo; el bistró se muestra sin él.',
    unknownGpu: 'GPU desconocida',
    words: { noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin antialiasing' }
  },
  'es-ES': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    preset: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    renderScale: 'Escala de renderizado', fromPreset: 'Según el preajuste ({tier})',
    cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Etalonaje', antialias: 'Suavizado de bordes', reflections: 'Reflejos', particles: 'Partículas de vapor', detail: 'Detalle de superficies', animation: 'Animación ambiental' },
    tier: { off: 'No', on: 'Sí', low: 'Baja', medium: 'Media', high: 'Alta', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado', static: 'Estática', animated: 'Animada' },
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    postUnavailable: 'El posprocesado no está disponible en este dispositivo; el bistró se muestra sin él.',
    unknownGpu: 'GPU desconocida',
    words: { noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin suavizado' }
  },
  'de-DE': {
    graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    preset: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
    renderScale: 'Renderskalierung', fromPreset: 'Aus Voreinstellung ({tier})',
    cat: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Lichtschein', grade: 'Farbkorrektur', antialias: 'Kantenglättung', reflections: 'Spiegelungen', particles: 'Dampfpartikel', detail: 'Oberflächendetails', animation: 'Umgebungsanimation' },
    tier: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Schlicht', detailed: 'Detailliert', static: 'Statisch', animated: 'Animiert' },
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Bistro wird ohne sie dargestellt.',
    unknownGpu: 'unbekannte GPU',
    words: { noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung', bloom: 'Lichtschein', reflections: 'Spiegelungen', noAA: 'keine Kantenglättung' }
  },
  'fr-FR': {
    graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
    preset: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage', antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Particules de vapeur', detail: 'Détail des surfaces', animation: 'Animation d’ambiance' },
    tier: { off: 'Désactivé', on: 'Activé', low: 'Basse', medium: 'Moyenne', high: 'Haute', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé', static: 'Statique', animated: 'Animée' },
    adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
    postUnavailable: 'Le post-traitement est indisponible sur cet appareil ; le bistrot s’affiche sans.',
    unknownGpu: 'GPU inconnu',
    words: { noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète', bloom: 'halo', reflections: 'reflets', noAA: 'sans anticrénelage' }
  },
  'fr-CA': {
    graphics: 'Graphiques', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
    preset: { low: 'Basse', balanced: 'Équilibrée', high: 'Élevée', ultra: 'Ultra' },
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Correction des couleurs', antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Particules de vapeur', detail: 'Détail des surfaces', animation: 'Animation d’ambiance' },
    tier: { off: 'Désactivé', on: 'Activé', low: 'Basse', medium: 'Moyenne', high: 'Élevée', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé', static: 'Statique', animated: 'Animée' },
    adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    postUnavailable: 'Le post-traitement n’est pas offert sur cet appareil; le bistro s’affiche sans.',
    unknownGpu: 'GPU inconnu',
    words: { noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète', bloom: 'halo', reflections: 'reflets', noAA: 'sans anticrénelage' }
  },
  'pt-BR': {
    graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    preset: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
    cat: { shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Anti-serrilhado', reflections: 'Reflexos', particles: 'Partículas de vapor', detail: 'Detalhe das superfícies', animation: 'Animação ambiente' },
    tier: { off: 'Desligado', on: 'Ligado', low: 'Baixa', medium: 'Média', high: 'Alta', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado', static: 'Estática', animated: 'Animada' },
    adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    postUnavailable: 'O pós-processamento não está disponível neste dispositivo; o bistrô é exibido sem ele.',
    unknownGpu: 'GPU desconhecida',
    words: { noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa', bloom: 'brilho', reflections: 'reflexos', noAA: 'sem anti-serrilhado' }
  },
  'it-IT': {
    graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    preset: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
    renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
    cat: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing', reflections: 'Riflessi', particles: 'Particelle di vapore', detail: 'Dettaglio superfici', animation: 'Animazione ambientale' },
    tier: { off: 'No', on: 'Sì', low: 'Bassa', medium: 'Media', high: 'Alta', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato', static: 'Statica', animated: 'Animata' },
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo; il bistrot viene mostrato senza.',
    unknownGpu: 'GPU sconosciuta',
    words: { noShadows: 'senza ombre', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', reflections: 'riflessi', noAA: 'senza antialiasing' }
  }
};

export const LOCALES = Object.keys(STRINGS);

const FALLBACK = { es: 'es-419', en: 'en-US', fr: 'fr-FR', pt: 'pt-BR', de: 'de-DE', it: 'it-IT' };

export function pickLocale(tag) {
  const t = String(tag || '');
  if (STRINGS[t]) return t;
  const lower = t.toLowerCase();
  for (const k of LOCALES) if (k.toLowerCase() === lower) return k;
  if (/^es-(es|ea|ic)$/i.test(t)) return 'es-ES';
  if (/^en-(gb|ie|au|nz)$/i.test(t)) return 'en-GB';
  return FALLBACK[lower.split('-')[0]] || 'en-US';
}

export function strings(tag) {
  return STRINGS[pickLocale(tag)];
}

export function fmt(s, tier) {
  return String(s).replace('{tier}', tier);
}
