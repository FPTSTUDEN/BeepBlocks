/**
 * Click-to-trace (design.md §10, Req 7.7, task E.6).
 *
 * The clicked item is identified by its path at snapshot `index`. Its path at every other
 * snapshot is reconstructed by following RENAME/MOVE actions (of the item or any ancestor
 * folder) backwards and forwards, so operations on its old names count too. Creation and
 * deletion don't stop the tracking: the trace is path-based, so e.g. an "exists?" check made
 * before a folder was created still counts for that folder.
 */
import type { Action, Timeline } from '../../ir/timeline.ts';
import type { NodeId } from '../../ir/types.ts';
import type { SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { rebase, samePath } from './paths.ts';

function isRelocation(a: Action): a is Action & { to: string } {
  return (a.op === 'RENAME' || a.op === 'MOVE') && a.to !== undefined;
}

/** The item's path before `a`, given its path after `a`. */
function pathBefore(after: string, a: Action): string {
  return isRelocation(a) ? (rebase(after, a.to, a.from) ?? after) : after;
}

/** The item's path after `a`, given its path before `a`. */
function pathAfter(before: string, a: Action): string {
  return isRelocation(a) ? (rebase(before, a.from, a.to) ?? before) : before;
}

/**
 * Unique node ids (in timeline order) of every snapshot whose action (`from`/`to`) or reads
 * refer to the item that has path `path` at snapshot `index` (for an item deleted by snapshot
 * `index`, the path it had).
 */
export function traceNodeIds(timeline: Timeline<SandboxFS>, index: number, path: string): NodeId[] {
  const snaps = timeline.snapshots;
  if (snaps.length === 0) return [];
  const at = Math.max(0, Math.min(index, snaps.length - 1));
  /** after[k] = the item's path after snapshot k; before[k] = before it. */
  const after: string[] = new Array<string>(snaps.length);
  const before: string[] = new Array<string>(snaps.length);

  let p = path;
  for (let k = at; k >= 0; k--) {
    after[k] = p;
    const a = snaps[k]!.action;
    if (a) p = pathBefore(p, a);
    before[k] = p;
  }
  let q = path;
  for (let k = at + 1; k < snaps.length; k++) {
    before[k] = q;
    const a = snaps[k]!.action;
    if (a) q = pathAfter(q, a);
    after[k] = q;
  }

  const ids: NodeId[] = [];
  const seen = new Set<NodeId>();
  snaps.forEach((s, k) => {
    const candidates = [before[k]!, after[k]!];
    const touched = [s.action?.from, s.action?.to, ...(s.readPaths ?? [])].filter(
      (t): t is string => t !== undefined,
    );
    const hit = touched.some((t) => candidates.some((c) => samePath(t, c)));
    if (hit && !seen.has(s.nodeId)) {
      seen.add(s.nodeId);
      ids.push(s.nodeId);
    }
  });
  return ids;
}
