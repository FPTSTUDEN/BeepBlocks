/** Runtime error raised inside the simulator (design.md §5.5). */
import type { ErrorCode } from '../ir/errors.ts';
import type { NodeId } from '../ir/types.ts';

/**
 * Thrown by value semantics and op implementations. `nodeId` is filled in by the interpreter
 * at the innermost node that raised it (the `op` / `binary` / `call` expression).
 */
export class SimError extends Error {
  nodeId: NodeId | null;

  constructor(
    readonly code: ErrorCode,
    message: string,
    nodeId: NodeId | null = null,
  ) {
    super(message);
    this.name = 'SimError';
    this.nodeId = nodeId;
  }
}

/** Internal invariant violation (a bug or an unvalidated program), never a user error. */
export function internal(message: string): never {
  throw new Error(`Simulator internal error: ${message}`);
}
