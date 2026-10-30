/**
 * File explorer domain state — CONTRACT (design.md §7.1). Read-only for Phase 1 workstreams.
 */
import type { CompositeName } from '../../ir/composites.ts';

export interface FsFile {
  type: 'file';
  name: string;
  /** Integer epoch seconds (UTC). */
  modified: number;
  /** Text file content. Exactly one of `content` / `binarySize` is set. */
  content?: string;
  /** Opaque (non-text) file of this many bytes, e.g. a photo. */
  binarySize?: number;
}

export interface FsFolder {
  type: 'folder';
  name: string;
  modified: number;
  /** Sorted by lowercase name, then code point (design.md §5.3). Names unique case-insensitively. */
  children: readonly FsNode[];
}

export type FsNode = FsFile | FsFolder;

/** The root folder's own `name` is ignored (it is whatever folder the user picks). */
export interface SandboxFS {
  root: FsFolder;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  tree: SandboxFS;
  suggestedComposite?: CompositeName;
}

/** Size in bytes: UTF-8 length of the content, or the binary size. */
export function fileSize(f: FsFile): number {
  if (f.content !== undefined) return new TextEncoder().encode(f.content).length;
  return f.binarySize ?? 0;
}

/** Sort key comparison used for folder children everywhere (sim, Python runtime, UI). */
export function compareNames(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return compareCodePoints(la, lb);
  return compareCodePoints(a, b);
}

/** Code-point order (matches Python's str ordering, unlike JS's UTF-16 default). */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** Splits a relative POSIX path into segments ('' = root = no segments). */
export function splitPath(path: string): string[] {
  return path === '' ? [] : path.split('/');
}

export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/** Looks up a node by relative path, matching names case-insensitively. */
export function getNode(fs: SandboxFS, path: string): FsNode | undefined {
  let node: FsNode = fs.root;
  for (const seg of splitPath(path)) {
    if (node.type !== 'folder') return undefined;
    const lower = seg.toLowerCase();
    const next: FsNode | undefined = node.children.find((c) => c.name.toLowerCase() === lower);
    if (!next) return undefined;
    node = next;
  }
  return node;
}

// ---------------------------------------------------------------- Name rules

const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * Windows-strict file/folder name rules, applied on every OS (design.md §5.3).
 * Returns a plain-language problem, or null if the name is valid.
 * The Python runtime implements the same rules in `_bp_check_name`.
 */
export function checkName(name: string): string | null {
  const length = [...name].length;
  if (length === 0) return 'A name cannot be empty.';
  if (length > 255) return 'A name can be at most 255 characters.';
  if (name === '.' || name === '..') return `"${name}" is not allowed as a name.`;
  const bad = FORBIDDEN_CHARS.exec(name);
  if (bad) {
    const c = bad[0];
    const shown = c.charCodeAt(0) < 0x20 ? 'a control character' : `"${c}"`;
    return `"${name}" contains ${shown}, which is not allowed in names (< > : " / \\ | ? *).`;
  }
  if (name.endsWith(' ') || name.endsWith('.')) return `"${name}" cannot end with a space or a dot.`;
  const stem = name.split('.')[0]!.toUpperCase();
  if (RESERVED_NAMES.has(stem)) return `"${name}" is reserved by Windows; please choose another name.`;
  return null;
}
