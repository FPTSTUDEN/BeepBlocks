/**
 * Pure helpers for the timeline controls (task E.5): speeds, step delays, keyboard shortcuts,
 * index clamping and the step announcement text.
 */
import { formatAction, type Snapshot, type Timeline } from '../../ir/timeline.ts';
import { displayPath } from './paths.ts';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 1;

/** Steps per second at 1× (design: about 4). */
export const BASE_STEPS_PER_SECOND = 4;

export function stepDelayMs(speed: number): number {
  return 1000 / (BASE_STEPS_PER_SECOND * speed);
}

export function formatSpeed(speed: number): string {
  return `${String(speed)}×`;
}

export function isSpeed(n: number): n is Speed {
  return (SPEEDS as readonly number[]).includes(n);
}

/** Clamps a controlled index into the timeline (0 when there is none). */
export function clampIndex(index: number, timeline: Timeline | null): number {
  const n = timeline?.snapshots.length ?? 0;
  if (n === 0 || !Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), n - 1));
}

export type Shortcut = 'toggle' | 'back' | 'forward' | 'reset';

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** Elements whose own Space/Enter activation must win over the run/pause shortcut. */
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

function elementOf(target: EventTarget | null): HTMLElement | null {
  return typeof HTMLElement !== 'undefined' && target instanceof HTMLElement ? target : null;
}

/**
 * Maps a keydown inside the playground region to a shortcut (Space, ←, →, Home), or null.
 * Ignored while typing in a form field, with modifier keys, when a child widget already
 * handled the key (e.g. tree arrow navigation), and Space on buttons/links.
 */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  const el = elementOf(e.target);
  if (el && (TYPING_TAGS.has(el.tagName) || el.isContentEditable)) return null;
  switch (e.key) {
    case ' ':
    case 'Spacebar':
      return el && ACTIVATABLE_TAGS.has(el.tagName) ? null : 'toggle';
    case 'ArrowLeft':
      return 'back';
    case 'ArrowRight':
      return 'forward';
    case 'Home':
      return 'reset';
    default:
      return null;
  }
}

/** What happened at this snapshot, in plain language. */
export function describeEvent<S>(s: Snapshot<S>): string {
  switch (s.event) {
    case 'fsOp':
      return s.action ? formatAction(s.action).replace(/\s+/g, ' ') : 'changed a file';
    case 'fsRead': {
      const paths = (s.readPaths ?? []).map(displayPath);
      return paths.length > 0 ? `looked at ${paths.join(', ')}` : 'looked at the files';
    }
    case 'cond':
      return 'checked a condition';
    case 'call':
      return `called ${s.frames.at(-1)?.fn ?? 'a function'}`;
    case 'return':
      return 'returned from a function';
    case 'error':
      return `stopped with an error: ${s.error?.message ?? 'unknown error'}`;
    case 'done':
      return 'done';
    case 'stmt':
      return 'ran a block';
  }
}

/** The polite live-region announcement for the current step. */
export function announce<S>(timeline: Timeline<S> | null, index: number): string {
  if (!timeline || timeline.snapshots.length === 0) return 'Not run yet.';
  const i = clampIndex(index, timeline);
  const s = timeline.snapshots[i]!;
  return `Step ${String(i + 1)} of ${String(timeline.snapshots.length)}: ${describeEvent(s)}.`;
}
