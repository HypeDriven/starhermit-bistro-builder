// Localization: assets/strings.json (the nine StarHermit locales) on the
// engine's string tables, in the interface language the runtime reports
// (Options › Language, else the account's or the device's); account lines the
// engine has are its `starhermit.*`.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
const listeners = new Set<() => void>();
strings.onChange((locale) => { ui.setLanguage(locale); for (const fn of listeners) fn(); });

export function currentLocale(): string { return strings.locale; }
/** fn() after the interface language changed. */
export function onLocaleChange(fn: () => void): void { listeners.add(fn); }

type Vars = Record<string, string | number>;
/** A game string by key in the player's language; `{name}` placeholders from vars. */
export function t(key: string, vars?: Vars | null, fallback?: string): string {
  if (fallback !== undefined && !strings.has(key)) return fallback;
  return strings.t(key, vars ?? undefined);
}

// Colour emoji are not in the runtime's fonts (they draw as boxes): the
// string tables' icon prefixes (🍽 💡 ⏪ ⏩ ⏸ ⏱ 🏆 🏅 🔒) are dropped where
// text is drawn. ▶ ↻ ← → ★ ☆ ✓ ♪ are plain text symbols and stay.
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{23E9}-\u{23FA}\u{FE0F}]\s*/gu;
/** t() without its emoji icons. */
export function tx(key: string, vars?: Vars | null, fallback?: string): string {
  return t(key, vars, fallback).replace(EMOJI, "").trim();
}
