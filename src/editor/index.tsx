/**
 * Block editor public API — Workstream D (design.md §9). Stub until Phase 1.
 */
import type { NodeId, Program } from '../ir/types.ts';
import type { DesugarOne } from '../ir/composites.ts';
import type { ValidationError } from '../ir/errors.ts';

export type Layout = Record<NodeId, { x: number; y: number }>;

export interface BlockEditorProps {
  program: Program;
  layout: Layout;
  /** Called after every workspace change with the regenerated IR, layout and validation result. */
  onChange: (program: Program, layout: Layout, issues: ValidationError[]) => void;
  /** Injected by app/ for the Expand action. */
  desugarOne: DesugarOne;
  /** Currently executing block(s) — already resolved to existing block ids. */
  highlightIds?: readonly NodeId[];
  /** Blocks to mark (e.g. click-to-trace results). */
  markedIds?: readonly NodeId[];
  readOnly?: boolean;
}

export function BlockEditor(_props: BlockEditorProps) {
  return <div role="region" aria-label="Block editor">Block editor (Workstream D)</div>;
}
