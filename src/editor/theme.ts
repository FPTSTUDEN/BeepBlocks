/**
 * Blockly theme derived from the app's CSS custom properties (design.md §10.2).
 *
 * Component colours (workspace, toolbox, flyout, cursor…) and the font come from `--bp-*`
 * variables with fallbacks. Block colours are a fixed palette chosen so that Blockly's white
 * block text has at least 4.5:1 contrast. Call `rebuildTheme(ws)` after the CSS variables
 * change (theme switch or accent change).
 */
import * as Blockly from 'blockly/core';
import { STYLE, type StyleName } from './blocks/common.ts';

export const THEME_VARS = {
  '--bp-bg': '#ffffff',
  '--bp-surface': '#f3f4f6',
  '--bp-fg': '#111827',
  '--bp-muted': '#6b7280',
  '--bp-border': '#d1d5db',
  '--bp-accent': '#2563eb',
  '--bp-accent-fg': '#ffffff',
  '--bp-danger': '#b91c1c',
  '--bp-warning': '#b45309',
  '--bp-success': '#047857',
  '--bp-highlight': '#f59e0b',
  '--bp-font': 'system-ui, sans-serif',
  '--bp-mono': 'ui-monospace, monospace',
} as const;

export type ThemeVar = keyof typeof THEME_VARS;
export type ThemeValues = Record<ThemeVar, string>;

/** Block colours (white text ≥ 4.5:1 on each). */
export const BLOCK_COLOURS: Record<StyleName, string> = {
  [STYLE.program]: '#374151',
  [STYLE.tasks]: '#6d28d9',
  [STYLE.files]: '#a16207',
  [STYLE.logic]: '#1d4ed8',
  [STYLE.loops]: '#047857',
  [STYLE.variables]: '#c2410c',
  [STYLE.lists]: '#be185d',
  [STYLE.text]: '#0f766e',
  [STYLE.math]: '#4338ca',
  [STYLE.functions]: '#a21caf',
};

/** Reads the `--bp-*` variables from `el` (falling back to the defaults). */
export function readThemeVars(el: Element | null): ThemeValues {
  const out = { ...THEME_VARS } as ThemeValues;
  if (!el || typeof getComputedStyle !== 'function') return out;
  const cs = getComputedStyle(el);
  for (const key of Object.keys(THEME_VARS) as ThemeVar[]) {
    const v = cs.getPropertyValue(key).trim();
    if (v) out[key] = v;
  }
  return out;
}

let themeCounter = 0;

export function buildBlocklyTheme(vars: ThemeValues): Blockly.Theme {
  const blockStyles: Record<string, Partial<Blockly.Theme.BlockStyle>> = {};
  const categoryStyles: Record<string, Blockly.Theme.CategoryStyle> = {};
  for (const [name, colour] of Object.entries(BLOCK_COLOURS)) {
    blockStyles[name] = {
      colourPrimary: colour,
      colourSecondary: Blockly.utils.colour.blend('#ffffff', colour, 0.35) ?? colour,
      colourTertiary: Blockly.utils.colour.blend('#000000', colour, 0.25) ?? colour,
      hat: name === STYLE.program || name === STYLE.functions ? 'cap' : '',
    };
    categoryStyles[name] = { colour };
  }
  themeCounter += 1;
  const theme = new Blockly.Theme(`bp-theme-${themeCounter}`, blockStyles, categoryStyles, {
    workspaceBackgroundColour: vars['--bp-bg'],
    toolboxBackgroundColour: vars['--bp-surface'],
    toolboxForegroundColour: vars['--bp-fg'],
    flyoutBackgroundColour: vars['--bp-surface'],
    flyoutForegroundColour: vars['--bp-fg'],
    flyoutOpacity: 1,
    scrollbarColour: vars['--bp-muted'],
    scrollbarOpacity: 0.6,
    insertionMarkerColour: vars['--bp-accent'],
    insertionMarkerOpacity: 0.4,
    markerColour: vars['--bp-highlight'],
    cursorColour: vars['--bp-highlight'],
    selectedGlowColour: vars['--bp-accent'],
    selectedGlowOpacity: 0.6,
  });
  theme.setFontStyle({ family: vars['--bp-font'], size: 11, weight: '600' });
  theme.setStartHats(false);
  return theme;
}

/** Re-reads the CSS variables (from `el`, default the injection div) and applies a new theme. */
export function rebuildTheme(ws: Blockly.WorkspaceSvg, el?: Element): Blockly.Theme {
  const theme = buildBlocklyTheme(readThemeVars(el ?? ws.getInjectionDiv()));
  ws.setTheme(theme);
  return theme;
}

const CSS_ID = 'bp-editor-css';
const EDITOR_CSS = `
.bp-editor { display: flex; flex-direction: column; min-height: 0; height: 100%;
  background: var(--bp-bg, #ffffff); color: var(--bp-fg, #111827);
  font-family: var(--bp-font, system-ui, sans-serif); }
.bp-editor-toolbar { display: flex; gap: 0.5rem; align-items: center; padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--bp-border, #d1d5db); background: var(--bp-surface, #f3f4f6); }
.bp-editor-toolbar button { font: inherit; color: var(--bp-fg, #111827);
  background: var(--bp-bg, #ffffff); border: 1px solid var(--bp-border, #d1d5db);
  border-radius: 4px; padding: 0.15rem 0.6rem; cursor: pointer; }
.bp-editor-toolbar button:focus-visible { outline: 2px solid var(--bp-accent, #2563eb);
  outline-offset: 2px; }
.bp-editor-toolbar button:disabled { color: var(--bp-muted, #6b7280); cursor: default; }
.bp-editor-hint { color: var(--bp-muted, #6b7280); font-size: 0.85em; margin-left: auto; }
.bp-editor-workspace { flex: 1 1 auto; min-height: 320px; position: relative; }
.bp-running > .blocklyPath { stroke: var(--bp-highlight, #f59e0b) !important;
  stroke-width: 5px !important; }
.bp-marked > .blocklyPath { stroke: var(--bp-accent, #2563eb) !important;
  stroke-width: 3px !important; stroke-dasharray: 6 3; }
.blocklyText, .blocklyFlyoutLabelText { font-family: var(--bp-font, system-ui, sans-serif); }
`;

/** Injects the editor stylesheet once per document. */
export function ensureEditorCss(doc: Document = document): void {
  if (doc.getElementById(CSS_ID)) return;
  const style = doc.createElement('style');
  style.id = CSS_ID;
  style.textContent = EDITOR_CSS;
  doc.head.appendChild(style);
}
