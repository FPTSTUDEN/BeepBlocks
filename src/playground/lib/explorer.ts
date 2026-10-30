/**
 * Pure helpers for the explorer view (task E.1): which item a snapshot affects, which folder to
 * show, the visible folder-tree rows, and the rows of the file list.
 */
import type { Snapshot } from '../../ir/timeline.ts';
import type { FsFolder, FsNode, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { compareNames, getNode, joinPath } from '../../domains/fileExplorer/fsTypes.ts';
import type { Diff, DiffEntry } from './diff.ts';
import { ancestorsOf, parentPath, pathKey, samePath } from './paths.ts';

/** The main item a snapshot affects: the action's target (or source), else the first read. */
export function affectedPath(snapshot: Snapshot<SandboxFS> | undefined): string | null {
  if (!snapshot) return null;
  const a = snapshot.action;
  if (a) return a.op === 'DELETE' ? a.from : (a.to ?? a.from);
  return snapshot.readPaths?.[0] ?? null;
}

/** Every path a snapshot touches (highlighted as "active" in the explorer, Req 7.2). */
export function activePaths(snapshot: Snapshot<SandboxFS> | undefined): Set<string> {
  const out = new Set<string>();
  if (!snapshot) return out;
  const a = snapshot.action;
  if (a) {
    out.add(pathKey(a.from));
    if (a.to !== undefined) out.add(pathKey(a.to));
  }
  for (const p of snapshot.readPaths ?? []) out.add(pathKey(p));
  return out;
}

/**
 * The folder to auto-select for a snapshot: the folder containing the affected item
 * (the root for root-level items and for the root itself). Null when nothing is affected.
 */
export function folderForSnapshot(snapshot: Snapshot<SandboxFS> | undefined): string | null {
  const p = affectedPath(snapshot);
  if (p === null) return null;
  if (p === '') return '';
  return existingFolder(snapshot!.state, parentPath(p));
}

/** `path` with each segment in its stored case; null when it doesn't exist. */
export function canonicalPath(fs: SandboxFS, path: string): string | null {
  let node: FsNode = fs.root;
  let out = '';
  for (const seg of path === '' ? [] : path.split('/')) {
    if (node.type !== 'folder') return null;
    const lower = seg.toLowerCase();
    const next: FsNode | undefined = node.children.find((c) => c.name.toLowerCase() === lower);
    if (!next) return null;
    out = joinPath(out, next.name);
    node = next;
  }
  return out;
}

/** The deepest existing folder at or above `path`, in stored case ('' at worst). */
export function existingFolder(fs: SandboxFS, path: string): string {
  const chain = [...ancestorsOf(path), path].reverse();
  for (const p of chain) {
    const node = getNode(fs, p);
    if (node?.type === 'folder') return canonicalPath(fs, p) ?? '';
  }
  return '';
}

/** Ancestor folders to expand so that `folder` is visible in the tree. */
export function foldersToExpand(folder: string): string[] {
  return [...ancestorsOf(folder), folder].map(pathKey);
}

/** Highest modified time in the tree (used as a deterministic default for new items). */
export function latestModified(fs: SandboxFS): number {
  let max = fs.root.modified;
  const visit = (n: FsNode) => {
    if (n.modified > max) max = n.modified;
    if (n.type === 'folder') n.children.forEach(visit);
  };
  visit(fs.root);
  return max;
}

export interface TreeRow {
  path: string;
  node: FsFolder;
  /** 1-based, for aria-level. */
  level: number;
  hasSubfolders: boolean;
  expanded: boolean;
  /** 1-based position among sibling folders, and their count (aria-posinset/setsize). */
  posInSet: number;
  setSize: number;
}

/** Visible rows of the folder tree (folders only), depth-first. `expanded` holds path keys. */
export function treeRows(fs: SandboxFS, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (node: FsFolder, path: string, level: number, pos: number, size: number) => {
    const sub = node.children.filter((c): c is FsFolder => c.type === 'folder');
    const isOpen = expanded.has(pathKey(path));
    rows.push({
      path,
      node,
      level,
      hasSubfolders: sub.length > 0,
      expanded: isOpen,
      posInSet: pos,
      setSize: size,
    });
    if (isOpen)
      sub.forEach((c, i) => visit(c, joinPath(path, c.name), level + 1, i + 1, sub.length));
  };
  visit(fs.root, '', 1, 1, 1);
  return rows;
}

export interface ItemRow {
  path: string;
  node: FsNode;
  /** True for an item deleted by this snapshot, rendered from the previous state. */
  ghost: boolean;
  diff?: DiffEntry;
}

/** Children of `folder` in the current state plus this step's deleted items, sorted by name. */
export function folderItems(fs: SandboxFS, folder: string, diff: Diff): ItemRow[] {
  const node = getNode(fs, folder);
  const rows: ItemRow[] = [];
  if (node?.type === 'folder') {
    for (const c of node.children) {
      const path = joinPath(folder, c.name);
      const d = diff.get(pathKey(path));
      rows.push(d ? { path, node: c, ghost: false, diff: d } : { path, node: c, ghost: false });
    }
  }
  for (const d of diff.values()) {
    if (d.kind === 'deleted' && d.node && samePath(parentPath(d.path), folder)) {
      rows.push({ path: d.path, node: d.node, ghost: true, diff: d });
    }
  }
  return rows.sort((a, b) => compareNames(a.node.name, b.node.name));
}
