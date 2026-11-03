import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  contrast,
  foregroundOn,
  legibleAccent,
  loadSettings,
  parseSettings,
  themeVars,
  type Mode,
} from './settings.ts';

const MODES: Mode[] = ['light', 'dark'];
const TEXT_VARS = ['--bp-fg', '--bp-muted', '--bp-danger', '--bp-warning', '--bp-success'];
/** Everything text is drawn on (the active row uses highlight-bg). */
const BACKGROUNDS = ['--bp-bg', '--bp-surface', '--bp-highlight-bg'];

describe('visual themes', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it.each(MODES)('%s preset text colours reach 4.5:1 on every text background', (mode) => {
    const p = PRESETS[mode];
    for (const v of TEXT_VARS) {
      for (const bg of BACKGROUNDS) {
        expect(contrast(p[v]!, p[bg]!), `${v} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(MODES)('%s preset highlight (stroke, marker) reaches 3:1 (non-text) on bg', (mode) => {
    const p = PRESETS[mode];
    expect(contrast(p['--bp-highlight']!, p['--bp-bg']!)).toBeGreaterThanOrEqual(3);
  });

  it.each(MODES)('%s preset border reaches 3:1 (non-text) on bg and surface', (mode) => {
    const p = PRESETS[mode];
    expect(contrast(p['--bp-border']!, p['--bp-bg']!)).toBeGreaterThanOrEqual(3);
    expect(contrast(p['--bp-border']!, p['--bp-surface']!)).toBeGreaterThanOrEqual(3);
  });

  const extremes = ['#ffffff', '#000000', '#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#ff0000', '#0000ff', '#808080', '#2563eb'];
  it.each(MODES.flatMap((m) => extremes.map((a) => [m, a] as const)))(
    '%s mode keeps accent %s legible',
    (mode, accent) => {
      const vars = themeVars({ mode, accent });
      for (const bg of BACKGROUNDS) {
        expect(contrast(vars['--bp-accent']!, vars[bg]!), `accent on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(vars['--bp-accent-fg']!, vars['--bp-accent']!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('leaves an already legible accent unchanged', () => {
    expect(legibleAccent('#1d4ed8', 'light')).toBe('#1d4ed8');
  });

  it('picks black or white text on the accent', () => {
    expect(foregroundOn('#ffff00')).toBe('#000000');
    expect(foregroundOn('#1d4ed8')).toBe('#ffffff');
  });

  it('parses saved settings defensively', () => {
    expect(parseSettings({ mode: 'dark', accent: '#ABCDEF' })).toEqual({
      mode: 'dark',
      accent: '#abcdef',
      showAdvanced: false,
    });
    expect(parseSettings({ mode: 'neon', accent: 'red' })).toEqual({
      mode: 'light',
      accent: '#2563eb',
      showAdvanced: false,
    });
    expect(parseSettings(null).mode).toBe('light');
    expect(loadSettings(undefined, true).mode).toBe('dark');
  });
});
