// The look of the menus and HUD: the browser build's style sheet, rewritten
// class-based in tools/ui-style.css and converted once with `starhermit css`
// into assets/ui-style.json (`npm run css`), registered at start with the
// theme the runtime's own widgets (checkboxes, selects, scroll bars) fall
// back to. The browser build's body classes that swapped the palette are
// token sets here: high contrast (the runtime's accessibility option) and
// the game's high-visibility palette.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export const COLORS = {
  bg: "#14100d", panel: "#211a15", panel2: "#2b221b", ink: "#f2e9dd", dim: "#b8a894",
  accent: "#e8a54b", danger: "#e0574d", ok: "#7fd08a", focus: "#ffd27a", hover: "#3a2e25",
};
type Tokens = Record<string, string>;
let base: Tokens = {};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setTheme({
    fontSize: 16, smallSize: 13, headingSize: 24, padding: 8, spacing: 8, radius: 10,
    text: COLORS.ink, muted: COLORS.dim, panel: COLORS.panel, control: COLORS.panel2, hovered: COLORS.hover,
    pressed: COLORS.hover, field: COLORS.panel2, accent: COLORS.accent, focus: COLORS.focus, outline: "#0a0807",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    checkbox: {
      text: { color: "$ink" }, minHeight: 36,
      parts: { box: { background: "$panel-2", border: { width: 1, color: "$ink-dim" }, radius: 4 }, mark: { background: "$accent" } },
    },
    scrollArea: { parts: { bar: { background: "$ink-dim", radius: 4 } } },
  });
}

let paletteKey = "";
/** The palette tokens: high contrast (black and white, cyan focus), the
 * colour-vision-safe palette (orange/cyan instead of red/green), else the
 * sheet's. */
export function applyPalette(highContrast: boolean, highVisibility: boolean): void {
  const key = `${highContrast}:${highVisibility}`;
  if (key === paletteKey) return;
  paletteKey = key;
  const tokens: Tokens = { ...base };
  if (highContrast) Object.assign(tokens, { bg: "#000000", panel: "#101010", "panel-2": "#1c1c1c", ink: "#ffffff", "ink-dim": "#e0e0e0", accent: "#ffd27a", focus: "#00e0ff" });
  if (highVisibility) Object.assign(tokens, { accent: "#ffb340", danger: "#ff6f61", ok: "#4dd0e1", focus: "#00e0ff" });
  ui.setTokens(tokens);
}
