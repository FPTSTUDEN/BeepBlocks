/** Editor layout type, kept separate from index.tsx so convert/ can import it without cycles. */
import type { NodeId } from '../ir/types.ts';

/**
 * Positions of top-level blocks: function definitions keyed by their id, and the "when run"
 * hat keyed by `RUN_BLOCK_ID`.
 */
export type Layout = Record<NodeId, { x: number; y: number }>;
