/**
 * Rows of the file list (tasks E.1–E.3): either the children of a folder, or — while a hinted
 * list variable is shown — the list elements in list order with a 0-based position gutter.
 */
import type { FsNode, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { getNode } from '../../domains/fileExplorer/fsTypes.ts';
import type { Diff, DiffEntry } from './diff.ts';
import { canonicalPath, folderItems } from './explorer.ts';
import { formatValue } from './format.ts';
import { pathKey } from './paths.ts';
import type { ListView, TagModel } from './tags.ts';

export interface FileRow {
  key: string;
  /** null for list elements that are not paths. */
  path: string | null;
  /** null when the path doesn't exist (and wasn't deleted this step), or for non-path elements. */
  node: FsNode | null;
  /** Deleted by this step; rendered from the previous state. */
  ghost: boolean;
  diff?: DiffEntry;
  /** List view: 0-based position in the list. */
  position?: number;
  /** List view: shown value of a non-path element. */
  text?: string;
  /** Path variables naming this item. */
  tags: string[];
  /** Hinted number variables pointing at this item's list position. */
  indexTags: string[];
  /** Touched by the current step. */
  active: boolean;
}

/** Index-variable names keyed by `pathKey` of the list element they point at. */
export function indexTagsByPath(list: ListView | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of list?.rows ?? []) {
    if (r.path === undefined || r.indexTags.length === 0) continue;
    const key = pathKey(r.path);
    out.set(key, [...(out.get(key) ?? []), ...r.indexTags]);
  }
  return out;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Children of `folder` (plus this step's deleted ghosts), with tags and diff states. */
export function folderRows(
  fs: SandboxFS,
  folder: string,
  diff: Diff,
  tags: TagModel | null,
  active: ReadonlySet<string> = EMPTY_SET,
): FileRow[] {
  const byIndex = indexTagsByPath(tags?.list ?? null);
  return folderItems(fs, folder, diff).map((item) => {
    const key = pathKey(item.path);
    const row: FileRow = {
      key: `${item.ghost ? 'ghost:' : ''}${key}`,
      path: item.path,
      node: item.node,
      ghost: item.ghost,
      tags: tags?.pathTags.get(key) ?? [],
      indexTags: byIndex.get(key) ?? [],
      active: active.has(key),
    };
    if (item.diff) row.diff = item.diff;
    return row;
  });
}

/** Rows of a hinted list in list order (design.md §10 position gutter). */
export function listRows(
  list: ListView,
  fs: SandboxFS,
  diff: Diff,
  pathTags: ReadonlyMap<string, string[]>,
  active: ReadonlySet<string> = EMPTY_SET,
): FileRow[] {
  return list.rows.map((r) => {
    if (r.path === undefined) {
      return {
        key: `pos:${String(r.position)}`,
        path: null,
        node: null,
        ghost: false,
        position: r.position,
        text: formatValue(r.value),
        tags: [],
        indexTags: r.indexTags,
        active: false,
      };
    }
    const key = pathKey(r.path);
    const d = diff.get(key);
    const live = getNode(fs, r.path);
    const ghostNode = d?.kind === 'deleted' ? d.node : undefined;
    const row: FileRow = {
      key: `pos:${String(r.position)}`,
      path: live ? (canonicalPath(fs, r.path) ?? r.path) : r.path,
      node: live ?? ghostNode ?? null,
      ghost: !live && ghostNode !== undefined,
      position: r.position,
      tags: pathTags.get(key) ?? [],
      indexTags: r.indexTags,
      active: active.has(key),
    };
    if (d) row.diff = d;
    return row;
  });
}
