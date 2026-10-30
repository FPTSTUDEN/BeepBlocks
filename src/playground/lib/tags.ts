/**
 * Variable tags and the position gutter (design.md §10, task E.3).
 *
 * - A `path` variable becomes a tag on the item it names (case-insensitive).
 * - A number variable with a `VarHint` becomes a tag on `list[value]` of the hinted list, or on
 *   the "end" marker when value == length.
 * - The hinted list is shown in list order with 0-based positions and a final "end" row.
 */
import type { Snapshot, Value } from '../../ir/timeline.ts';
import type { SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { getNode } from '../../domains/fileExplorer/fsTypes.ts';
import { pathKey } from './paths.ts';

export interface VisibleVar {
  name: string;
  value: Value;
  /** null = program scope, otherwise the function name. */
  scope: string | null;
}

export interface ListRow {
  position: number;
  value: Value;
  /** Set when the element is a path. */
  path?: string;
  /** Path elements only: whether the item exists in the current state. */
  exists: boolean;
  /** Names of hinted number variables whose value is this position. */
  indexTags: string[];
}

export interface ListView {
  /** The list variable being shown. */
  name: string;
  rows: ListRow[];
  length: number;
  /** Hinted number variables whose value equals the length. */
  endTags: string[];
}

export type IndexStatus = 'in range' | 'end' | 'out of range';

export interface TagModel {
  vars: VisibleVar[];
  /** Variable names keyed by `pathKey(item path)`. */
  pathTags: Map<string, string[]>;
  /** Names of path variables whose path does not exist in the current state. */
  missing: Set<string>;
  list: ListView | null;
  /** Hinted number variables and where they point. */
  indexStatus: Map<string, IndexStatus>;
}

/**
 * Variables visible at a snapshot: the program scope plus the innermost frame
 * (the innermost frame shadows program-scope names, as in Python).
 */
export function visibleVars(snapshot: Snapshot<SandboxFS>): VisibleVar[] {
  const frames = snapshot.frames;
  const program = frames[0];
  const inner = frames.length > 1 ? frames[frames.length - 1] : undefined;
  const out = new Map<string, VisibleVar>();
  if (program) {
    for (const [name, value] of Object.entries(program.vars)) {
      out.set(name, { name, value, scope: null });
    }
  }
  if (inner) {
    for (const [name, value] of Object.entries(inner.vars)) {
      out.set(name, { name, value, scope: inner.fn });
    }
  }
  return [...out.values()];
}

/** Integer value of a number variable, or null. */
function intOf(v: Value): number | null {
  if ((v.t === 'int' || v.t === 'float') && Number.isInteger(v.v)) return v.v;
  return null;
}

export function computeTags(snapshot: Snapshot<SandboxFS>): TagModel {
  const vars = visibleVars(snapshot);
  const byName = new Map(vars.map((v) => [v.name, v]));
  const pathTags = new Map<string, string[]>();
  const missing = new Set<string>();

  for (const v of vars) {
    if (v.value.t !== 'path') continue;
    if (getNode(snapshot.state, v.value.v) === undefined) missing.add(v.name);
    const key = pathKey(v.value.v);
    pathTags.set(key, [...(pathTags.get(key) ?? []), v.name]);
  }

  // The first hinted list that is actually a list variable is the one shown.
  let listName: string | null = null;
  for (const [name, hint] of Object.entries(snapshot.hints)) {
    const target = byName.get(hint.indexInto);
    if (byName.has(name) && target?.value.t === 'list') {
      listName = hint.indexInto;
      break;
    }
  }

  const indexStatus = new Map<string, IndexStatus>();
  let list: ListView | null = null;
  if (listName !== null) {
    const listValue = byName.get(listName)!.value as Extract<Value, { t: 'list' }>;
    const rows: ListRow[] = listValue.v.map((value, position) =>
      value.t === 'path'
        ? {
            position,
            value,
            path: value.v,
            exists: getNode(snapshot.state, value.v) !== undefined,
            indexTags: [],
          }
        : { position, value, exists: true, indexTags: [] },
    );
    const endTags: string[] = [];
    for (const [name, hint] of Object.entries(snapshot.hints)) {
      if (hint.indexInto !== listName) continue;
      const v = byName.get(name);
      if (!v) continue;
      const i = intOf(v.value);
      if (i !== null && i >= 0 && i < rows.length) {
        rows[i]!.indexTags.push(name);
        indexStatus.set(name, 'in range');
      } else if (i === rows.length) {
        endTags.push(name);
        indexStatus.set(name, 'end');
      } else {
        indexStatus.set(name, 'out of range');
      }
    }
    list = { name: listName, rows, length: rows.length, endTags };
  }

  return { vars, pathTags, missing, list, indexStatus };
}
