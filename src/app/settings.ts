/**
 * Visual themes (design.md §10.2, Req 11.3–11.4): light/dark presets as CSS custom properties,
 * a user-chosen accent kept WCAG-legible, and persistence under `beepblocks.settings`.
 */

export type Mode = 'light' | 'dark';

export interface Settings {
  mode: Mode;
  /** User-chosen accent, `#rrggbb`. The applied accent may be adjusted for contrast. */
  accent: string;
  showAdvanced?: boolean;
}

export const SETTINGS_KEY = 'beepblocks.settings';
export const DEFAULT_ACCENT = '#2563eb';
export const DEFAULT_SETTINGS: Settings = { mode: 'light', accent: DEFAULT_ACCENT, showAdvanced: false };

const FONTS = {
  '--bp-font': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '--bp-mono': 'ui-monospace, "Cascadia Mono", Consolas, monospace',
};

/**
 * Presets for every variable except the accent pair (design.md §10.2). Text colours are
 * ≥ 4.5:1 on every background: bg, surface, and highlight-bg (the active row). The highlight
 * itself is a stroke/marker colour (≥ 3:1 on bg); it is never used behind text.
 */
export const PRESETS: Record<Mode, Record<string, string>> = {
  light: {
    '--bp-bg': '#ffffff',
    '--bp-surface': '#f3f4f6',
    '--bp-fg': '#111827',
    '--bp-muted': '#4b5563',
    '--bp-border': '#848b96',
    '--bp-danger': '#b91c1c',
    '--bp-warning': '#92400e',
    '--bp-success': '#047857',
    '--bp-highlight': '#d97706',
    '--bp-highlight-bg': '#fef3c7',
    ...FONTS,
  },
  dark: {
    '--bp-bg': '#111827',
    '--bp-surface': '#1f2937',
    '--bp-fg': '#f9fafb',
    '--bp-muted': '#d1d5db',
    '--bp-border': '#7c8491',
    '--bp-danger': '#fca5a5',
    '--bp-warning': '#fcd34d',
    '--bp-success': '#6ee7b7',
    '--bp-highlight': '#fbbf24',
    '--bp-highlight-bg': '#5c3d0e',
    ...FONTS,
  },
};

// ------------------------------------------------------------------ colour

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever contrasts more with `bg` (always ≥ 4.58:1). */
export function foregroundOn(bg: string): '#000000' | '#ffffff' {
  return contrast(bg, '#000000') >= contrast(bg, '#ffffff') ? '#000000' : '#ffffff';
}

/** Backgrounds that text can sit on. */
const TEXT_BACKGROUNDS = ['--bp-bg', '--bp-surface', '--bp-highlight-bg'] as const;

/**
 * The accent as applied: the user's colour, blended towards the preset foreground just enough
 * to reach 4.5:1 against every text background (it is used for text, tags and focus rings).
 */
export function legibleAccent(accent: string, mode: Mode): string {
  const bgs = TEXT_BACKGROUNDS.map((k) => PRESETS[mode][k]!);
  const target = rgb(PRESETS[mode]['--bp-fg']!);
  const from = rgb(accent);
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex(from.map((c, i) => c + (target[i]! - c) * t) as [number, number, number]);
    if (bgs.every((bg) => contrast(mixed, bg) >= 4.5)) return mixed;
  }
  return PRESETS[mode]['--bp-fg']!;
}

/** All `--bp-*` variables for these settings. */
export function themeVars(s: Settings): Record<string, string> {
  const accent = legibleAccent(s.accent, s.mode);
  return { ...PRESETS[s.mode], '--bp-accent': accent, '--bp-accent-fg': foregroundOn(accent) };
}

export function applyTheme(s: Settings, el: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars(s))) el.style.setProperty(k, v);
  el.style.colorScheme = s.mode;
  el.dataset.bpMode = s.mode;
}

// ------------------------------------------------------------- persistence

export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode === 'dark' ? 'dark' : 'light',
    accent: isHexColor(r.accent) ? r.accent.toLowerCase() : DEFAULT_ACCENT,
    showAdvanced: r.showAdvanced === true,
  };
}

/** Saved settings, or defaults (dark mode if the OS prefers it). Never throws. */
export function loadSettings(storage: Storage | undefined, prefersDark = false): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (raw) return parseSettings(JSON.parse(raw));
  } catch {
    /* unreadable → defaults */
  }
  return { ...DEFAULT_SETTINGS, mode: prefersDark ? 'dark' : 'light' };
}

export function saveSettings(storage: Storage | undefined, s: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: settings stay for this session */
  }
}
