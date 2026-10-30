/**
 * Diff states of a snapshot relative to the previous one (design.md §10, task E.2).
 * Derived from `snapshot.action` plus the previous snapshot's state.
 */
import type { Snapshot } from '../../ir/timeline.ts';
import type { FsNode, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { getNode } from '../../domains/fileExplorer/fsTypes.ts';
import { pathKey } from './paths.ts';

export type DiffKind = 'created' | 'renamed' | 'moved' | 'modified' | 'deleted';

export interface DiffEntry {
  kind: DiffKind;
  /** Path of the item in the current state (for deleted: the path it had). */
  path: string;
  /** renamed/moved: where the item was before. */
  oldPath?: string;
  /** deleted: the node as it was in the previous state, rendered for this one step. */
  node?: FsNode;
}

/** Diff entries keyed by `pathKey(path)`. */
export type Diff = Map<string, DiffEntry>;

export const DIFF_LABELS: Record<DiffKind, { icon: string; label: string }> = {
  created: { icon: '＋', label: 'new' },
  renamed: { icon: '→', label: 'renamed' },
  moved: { icon: '→', label: 'moved' },
  modified: { icon: '✎', label: 'changed' },
  deleted: { icon: '✕', label: 'deleted' },
};

/**
 * Computes the diff produced by `current` (only fsOp snapshots change anything).
 * The "before" state is `prev.state`, or `initial` for the first snapshot. Without either,
 * WRITE is reported as "modified" and a deleted item has no ghost node.
 */
export function diffSnapshot(
  prev: Snapshot<SandboxFS> | undefined,
  current: Snapshot<SandboxFS>,
  initial?: SandboxFS,
): Diff {
  const diff: Diff = new Map();
  const a = current.action;
  if (!a) return diff;
  const prevState = prev?.state ?? initial;
  const put = (e: DiffEntry) => diff.set(pathKey(e.path), e);
  switch (a.op) {
    case 'MKDIR':
      put({ kind: 'created', path: a.from });
      break;
    case 'COPY':
      if (a.to !== undefined) put({ kind: 'created', path: a.to });
      break;
    case 'WRITE': {
      const existed = prevState ? getNode(prevState, a.from) !== undefined : true;
      put({ kind: existed ? 'modified' : 'created', path: a.from });
      break;
    }
    case 'RENAME':
    case 'MOVE':
      if (a.to !== undefined) {
        put({ kind: a.op === 'RENAME' ? 'renamed' : 'moved', path: a.to, oldPath: a.from });
      }
      break;
    case 'DELETE': {
      const node = prevState ? getNode(prevState, a.from) : undefined;
      put(node ? { kind: 'deleted', path: a.from, node } : { kind: 'deleted', path: a.from });
      break;
    }
  }
  return diff;
}
