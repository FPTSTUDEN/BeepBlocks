/** Error contract (design.md §5.5). Shared verbatim with the Python runtime. */
import type { NodeId } from './types.ts';

export const RUNTIME_ERROR_CODES = [
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'NOT_EMPTY',
  'INVALID_NAME',
  'NOT_A_FOLDER',
  'NOT_A_FILE',
  'NOT_TEXT',
  'INVALID_MOVE',
  /** Rename/move/copy/delete/write targeting the root folder itself. */
  'ROOT_PROTECTED',
  'OUTSIDE_ROOT',
  'INDEX_OUT_OF_RANGE',
  'DIVISION_BY_ZERO',
  'INVALID_NUMBER',
  'INT_OVERFLOW',
  // Simulator-only (design.md §12):
  'STEP_LIMIT',
  'RECURSION_LIMIT',
] as const;

export type ErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export const SIMULATOR_ONLY_CODES: readonly ErrorCode[] = ['STEP_LIMIT', 'RECURSION_LIMIT'];

export interface RuntimeError {
  code: ErrorCode;
  nodeId: NodeId;
  message: string;
}

export type ValidationCode =
  | 'STRUCTURE'
  | 'UNKNOWN_OP'
  | 'UNKNOWN_COMPOSITE'
  | 'UNKNOWN_FUNCTION'
  | 'UNDEFINED_VARIABLE'
  | 'TYPE_MISMATCH'
  | 'VARIABLE_RETYPED'
  | 'ARITY'
  | 'NOT_LITERAL'
  | 'BAD_LITERAL'
  | 'BAD_NAME'
  | 'DUPLICATE_NAME'
  | 'DUPLICATE_ID'
  | 'MISSING_RETURN'
  | 'RETURN_OUTSIDE_FUNCTION'
  | 'BAD_RETURN'
  | 'STATEMENT_ONLY'
  | 'VALUE_UNUSED'
  | 'BAD_PATTERN'
  | 'BAD_TEMPLATE'
  | 'BAD_FIELD'
  | 'MISSING_INPUT'
  | 'LARGE_INT'
  | 'MISPLACED_BLOCK'
  | 'INCOMPLETE_SEARCH';

export interface ValidationError {
  nodeId: NodeId;
  code: ValidationCode;
  message: string;
  /** Warnings do not block running or exporting. */
  severity: 'error' | 'warning';
}
