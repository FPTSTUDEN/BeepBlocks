/**
 * Type-check naming scheme for Blockly connection checks.
 *
 * Every IR `Type` has a *type key*: `number`, `text`, `bool`, `path`, and `list:<elem>` for
 * lists (recursively, e.g. `list:list:number`).
 *
 * Blockly connects an output to an input when their check arrays share at least one string
 * (or either is null). So:
 * - An **output** of a scalar type checks `[key]`; an output of a list type checks
 *   `['list', key]`, so it fits both "any list" inputs and inputs that need exactly that list.
 * - An **input** that needs a concrete type checks `[key]`.
 * - Inputs over the signature type variable `T`:
 *   - `T` with no constraint → `null` (anything).
 *   - `T` scalar → `['number', 'text', 'bool', 'path']`; `T` orderable → `['number', 'text']`.
 *   - `list<T>` → `['list']` (any list). `list<orderable>` → `['list:number', 'list:text']`.
 * - Outputs over `T` enumerate every type they could be (or `null` when the result is the
 *   element of an arbitrary list, as for `list.get`).
 *
 * Checks only prevent obviously wrong drops; the validator remains the source of truth.
 */
import type { Type } from '../../ir/types.ts';
import type { SigType } from '../../ir/ops.ts';

export type TypeKey = string;

export const SCALAR_KEYS = ['number', 'text', 'bool', 'path'] as const;
export const ANY_LIST = 'list';

export function typeKey(t: Type): TypeKey {
  return t.t === 'list' ? `list:${typeKey(t.of)}` : t.t;
}

export function parseTypeKey(key: string): Type | null {
  if ((SCALAR_KEYS as readonly string[]).includes(key)) {
    return { t: key as (typeof SCALAR_KEYS)[number] };
  }
  if (key.startsWith('list:')) {
    const of = parseTypeKey(key.slice(5));
    return of ? { t: 'list', of } : null;
  }
  return null;
}

/** Type keys offered in type dropdowns (scalars and lists up to two levels deep). */
export const TYPE_KEYS: readonly TypeKey[] = [
  ...SCALAR_KEYS,
  ...SCALAR_KEYS.map((k) => `list:${k}`),
  ...SCALAR_KEYS.map((k) => `list:list:${k}`),
];

const LIST_KEYS = TYPE_KEYS.filter((k) => k.startsWith('list:'));

const SCALAR_LABEL: Record<(typeof SCALAR_KEYS)[number], [string, string]> = {
  number: ['number', 'numbers'],
  text: ['text', 'texts'],
  bool: ['yes/no', 'yes/no values'],
  path: ['file/folder', 'files/folders'],
};

/** Short plain-language name of a type key for dropdowns ("list of files/folders"). */
export function typeKeyLabel(key: TypeKey, plural = false): string {
  if (key.startsWith('list:')) return `list of ${typeKeyLabel(key.slice(5), true)}`;
  const pair = SCALAR_LABEL[key as (typeof SCALAR_KEYS)[number]];
  if (!pair) return key;
  return plural ? pair[1] : pair[0];
}

export function typeDropdownOptions(): [string, string][] {
  return TYPE_KEYS.map((k) => [typeKeyLabel(k), k]);
}

/** Check for an output producing a value of (concrete) type `t`; null = unknown. */
export function outputCheck(t: Type | null): string[] | null {
  if (!t) return null;
  const key = typeKey(t);
  return t.t === 'list' ? [ANY_LIST, key] : [key];
}

/** Check for an input that needs exactly type `t`; null = accepts anything. */
export function inputCheck(t: Type | null): string[] | null {
  return t ? [typeKey(t)] : null;
}

function concreteKey(s: SigType): TypeKey | null {
  if (s.t === 'T') return null;
  if (s.t === 'list') {
    const of = concreteKey(s.of);
    return of ? `list:${of}` : null;
  }
  return s.t;
}

function tvKeys(constraint: 'scalar' | 'orderable' | undefined): string[] | null {
  if (constraint === 'scalar') return [...SCALAR_KEYS];
  if (constraint === 'orderable') return ['number', 'text'];
  return null;
}

/** Input check for an op argument signature. */
export function sigInputCheck(s: SigType): string[] | null {
  const key = concreteKey(s);
  if (key) return [key];
  if (s.t === 'T') return tvKeys(s.constraint);
  if (s.t === 'list') {
    if (s.of.t === 'T') {
      const inner = tvKeys(s.of.constraint);
      return inner ? inner.map((k) => `list:${k}`) : [ANY_LIST];
    }
    return [ANY_LIST];
  }
  return null;
}

/** Output check for an op result signature (statement ops have no output). */
export function sigOutputCheck(s: SigType): string[] | null {
  const key = concreteKey(s);
  if (key) return s.t === 'list' ? [ANY_LIST, key] : [key];
  if (s.t === 'T') return tvKeys(s.constraint);
  if (s.t === 'list') {
    if (s.of.t === 'T') {
      const inner = tvKeys(s.of.constraint);
      return [ANY_LIST, ...(inner ? inner.map((k) => `list:${k}`) : LIST_KEYS)];
    }
    return [ANY_LIST, ...LIST_KEYS];
  }
  return null;
}

/** Output of `+`: a number, text or any list. */
export const PLUS_OUTPUT: readonly string[] = ['number', 'text', ANY_LIST, ...LIST_KEYS];
/** Inputs of arithmetic blocks (`+` also joins texts and lists). */
export const ARITH_INPUT: readonly string[] = ['number', 'text', ANY_LIST];
