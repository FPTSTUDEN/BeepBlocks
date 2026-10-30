/**
 * Op registry — CONTRACT (design.md §4.2, §5.2, §5.3).
 *
 * Signatures only. Implementations live in sim/ (TypeScript) and export/ (Python) and are
 * keyed by op name; completeness tests in each module assert every op here is implemented.
 */
import type { Type } from './types.ts';

/** Signature types: concrete types plus a single type variable `T` per signature. */
export type SigType =
  | { t: 'number' }
  | { t: 'text' }
  | { t: 'bool' }
  | { t: 'path' }
  | { t: 'list'; of: SigType }
  /** Type variable, bound on first use. `scalar` = number|text|bool|path; `orderable` = number|text. */
  | { t: 'T'; constraint?: 'scalar' | 'orderable' };

export interface OpArg {
  name: string;
  type: SigType;
  /** The argument must be a literal (`lit`) node, checked by the validator. */
  literal?: true;
  /** For literal text arguments: the allowed values. */
  oneOf?: readonly string[];
}

export type Counter = 'none' | 'read' | 'fileOp';

export interface OpSignature {
  name: string;
  domain: 'core' | 'fileExplorer';
  args: readonly OpArg[];
  /** null → statement-only (must be used via a `do` statement). */
  returns: SigType | null;
  /** Requirement 1.5. */
  destructive: boolean;
  counter: Counter;
  /** Plain-language label; `{0}`, `{1}`… are replaced by argument descriptions. */
  label: string;
}

const num = { t: 'number' } as const;
const text = { t: 'text' } as const;
const bool = { t: 'bool' } as const;
const path = { t: 'path' } as const;
const tv = { t: 'T' } as const;
const list = <S extends SigType>(of: S) => ({ t: 'list', of }) as const;
const a = (name: string, type: SigType, extra: Partial<OpArg> = {}): OpArg => ({
  name,
  type,
  ...extra,
});

type Def = Omit<OpSignature, 'name'>;
const core = (d: Omit<Def, 'domain' | 'destructive' | 'counter'>): Def => ({
  domain: 'core',
  destructive: false,
  counter: 'none',
  ...d,
});
const fsop = (d: Omit<Def, 'domain'>): Def => ({ domain: 'fileExplorer', ...d });

export const SORT_KEYS = ['name', 'size', 'modified', 'ext'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const DEFS = {
  // ------------------------------------------------------------------ text
  'text.from': core({
    args: [a('value', { t: 'T', constraint: 'scalar' })],
    returns: text,
    label: '{0} as text',
  }),
  'text.toNumber': core({ args: [a('text', text)], returns: num, label: '{0} as a number' }),
  'text.length': core({ args: [a('text', text)], returns: num, label: 'length of {0}' }),
  'text.lower': core({ args: [a('text', text)], returns: text, label: '{0} in lowercase' }),
  'text.upper': core({ args: [a('text', text)], returns: text, label: '{0} in uppercase' }),
  'text.contains': core({
    args: [a('text', text), a('part', text)],
    returns: bool,
    label: '{0} contains {1}',
  }),
  'text.startsWith': core({
    args: [a('text', text), a('start', text)],
    returns: bool,
    label: '{0} starts with {1}',
  }),
  'text.endsWith': core({
    args: [a('text', text), a('end', text)],
    returns: bool,
    label: '{0} ends with {1}',
  }),
  'text.replace': core({
    args: [a('text', text), a('old', text), a('new', text)],
    returns: text,
    label: 'in {0}, replace {1} with {2}',
  }),
  'text.padNumber': core({
    args: [a('number', num), a('width', num)],
    returns: text,
    label: '{0} padded with zeros to {1} digits',
  }),
  'text.date': core({
    args: [a('time', num)],
    returns: text,
    label: 'date of {0} (YYYY-MM-DD)',
  }),
  'text.wildcard': core({
    args: [a('text', text), a('pattern', text)],
    returns: bool,
    label: '{0} matches pattern {1}',
  }),
  'text.regexMatch': core({
    args: [a('text', text), a('pattern', text, { literal: true })],
    returns: bool,
    label: '{0} matches regex {1}',
  }),
  'text.regexReplace': core({
    args: [
      a('text', text),
      a('pattern', text, { literal: true }),
      a('replacement', text, { literal: true }),
    ],
    returns: text,
    label: 'in {0}, replace regex {1} with {2}',
  }),

  // ----------------------------------------------------------------- lists
  'list.length': core({ args: [a('list', list(tv))], returns: num, label: 'length of {0}' }),
  'list.get': core({
    args: [a('list', list(tv)), a('position', num)],
    returns: tv,
    label: 'item at position {1} of {0}',
  }),
  'list.append': core({
    args: [a('list', list(tv)), a('item', tv)],
    returns: null,
    label: 'add {1} to the end of {0}',
  }),
  'list.contains': core({
    args: [a('list', list(tv)), a('item', tv)],
    returns: bool,
    label: '{0} contains {1}',
  }),
  'list.range': core({
    args: [a('start', num), a('stop', num)],
    returns: list(num),
    label: 'numbers from {0} up to (not including) {1}',
  }),
  'list.sortBy': core({
    args: [
      a('list', list(path)),
      a('key', text, { literal: true, oneOf: SORT_KEYS }),
      a('descending', bool, { literal: true }),
    ],
    returns: list(path),
    label: '{0} sorted by {1}',
  }),
  'list.sort': core({
    args: [
      a('list', list({ t: 'T', constraint: 'orderable' })),
      a('descending', bool, { literal: true }),
    ],
    returns: list({ t: 'T', constraint: 'orderable' }),
    label: '{0} sorted',
  }),

  // ------------------------------------------------------------------ math
  'math.floor': core({ args: [a('x', num)], returns: num, label: '{0} rounded down' }),
  'math.abs': core({ args: [a('x', num)], returns: num, label: 'absolute value of {0}' }),
  'math.min': core({ args: [a('a', num), a('b', num)], returns: num, label: 'smaller of {0} and {1}' }),
  'math.max': core({ args: [a('a', num), a('b', num)], returns: num, label: 'larger of {0} and {1}' }),

  // ------------------------------------------------------------ file system
  'fs.root': fsop({
    args: [],
    returns: path,
    destructive: false,
    counter: 'none',
    label: 'the chosen folder',
  }),
  'fs.join': fsop({
    args: [a('folder', path), a('name', text)],
    returns: path,
    destructive: false,
    counter: 'none',
    label: '{1} inside {0}',
  }),
  'fs.parent': fsop({
    args: [a('path', path)],
    returns: path,
    destructive: false,
    counter: 'none',
    label: 'folder containing {0}',
  }),
  'fs.name': fsop({
    args: [a('path', path)],
    returns: text,
    destructive: false,
    counter: 'none',
    label: 'name of {0}',
  }),
  'fs.stem': fsop({
    args: [a('path', path)],
    returns: text,
    destructive: false,
    counter: 'none',
    label: 'name of {0} without extension',
  }),
  'fs.ext': fsop({
    args: [a('path', path)],
    returns: text,
    destructive: false,
    counter: 'none',
    label: 'extension of {0}',
  }),
  'fs.exists': fsop({
    args: [a('path', path)],
    returns: bool,
    destructive: false,
    counter: 'read',
    label: '{0} exists',
  }),
  'fs.isFolder': fsop({
    args: [a('path', path)],
    returns: bool,
    destructive: false,
    counter: 'read',
    label: '{0} is a folder',
  }),
  'fs.list': fsop({
    args: [a('folder', path)],
    returns: list(path),
    destructive: false,
    counter: 'read',
    label: 'items in {0}',
  }),
  'fs.walk': fsop({
    args: [a('folder', path)],
    returns: list(path),
    destructive: false,
    counter: 'read',
    label: 'all files in {0} and its subfolders',
  }),
  'fs.size': fsop({
    args: [a('file', path)],
    returns: num,
    destructive: false,
    counter: 'read',
    label: 'size of {0} (bytes)',
  }),
  'fs.modified': fsop({
    args: [a('path', path)],
    returns: num,
    destructive: false,
    counter: 'read',
    label: 'last modified time of {0}',
  }),
  'fs.readText': fsop({
    args: [a('file', path)],
    returns: text,
    destructive: false,
    counter: 'read',
    label: 'text inside {0}',
  }),
  'fs.writeText': fsop({
    args: [a('file', path), a('text', text)],
    returns: null,
    destructive: true,
    counter: 'fileOp',
    label: 'write {1} into {0} (replacing its contents)',
  }),
  'fs.makeFolder': fsop({
    args: [a('path', path)],
    returns: null,
    destructive: false,
    counter: 'fileOp',
    label: 'create folder {0}',
  }),
  'fs.rename': fsop({
    args: [a('path', path), a('newName', text)],
    returns: path,
    destructive: false,
    counter: 'fileOp',
    label: 'rename {0} to {1}',
  }),
  'fs.move': fsop({
    args: [a('path', path), a('folder', path)],
    returns: path,
    destructive: false,
    counter: 'fileOp',
    label: 'move {0} into {1}',
  }),
  'fs.copy': fsop({
    args: [a('path', path), a('folder', path)],
    returns: path,
    destructive: false,
    counter: 'fileOp',
    label: 'copy {0} into {1}',
  }),
  'fs.delete': fsop({
    args: [a('path', path)],
    returns: null,
    destructive: true,
    counter: 'fileOp',
    label: 'delete {0}',
  }),
} as const satisfies Record<string, Def>;

export type OpName = keyof typeof DEFS;

export const OPS: Readonly<Record<OpName, OpSignature>> = Object.fromEntries(
  Object.entries(DEFS).map(([name, d]) => [name, { name, ...d }]),
) as Record<OpName, OpSignature>;

export const OP_NAMES = Object.keys(OPS) as OpName[];

export function isOpName(name: string): name is OpName {
  return Object.prototype.hasOwnProperty.call(OPS, name);
}

/** Converts a concrete signature type (no type variable) to a Type. Returns null if it contains `T`. */
export function sigToType(s: SigType): Type | null {
  if (s.t === 'T') return null;
  if (s.t === 'list') {
    const of = sigToType(s.of);
    return of ? { t: 'list', of } : null;
  }
  return { t: s.t };
}
