/** Node-id helpers (design.md §4.4). */
import type { NodeId } from './types.ts';

export const ID_SEPARATOR = '/';

/** Fixed id of the editor's single "when run" hat block; no program node may use it. */
export const RUN_BLOCK_ID = 'when-run';

/** Derived id for a node produced by desugaring composite `compositeId`. */
export function derivedId(compositeId: NodeId, local: string): NodeId {
  return `${compositeId}${ID_SEPARATOR}${local}`;
}

/**
 * Maps an id (possibly derived) to the nearest id that exists, by stripping `/…` suffixes.
 * Used to highlight a collapsed composite while its desugared internals execute.
 */
export function resolveToExisting(id: NodeId, exists: (id: NodeId) => boolean): NodeId | null {
  let current: string = id;
  for (;;) {
    if (exists(current)) return current;
    const cut = current.lastIndexOf(ID_SEPARATOR);
    if (cut <= 0) return null;
    current = current.slice(0, cut);
  }
}

let counter = 0;
/** Generates a fresh id for programmatically created nodes (tests, fixtures, scenarios). */
export function freshId(prefix = 'n'): NodeId {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}
