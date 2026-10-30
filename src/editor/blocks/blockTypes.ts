/** Blockly block type names, one per IR construct (design.md §9). */
import { COMPOSITE_NAMES, type CompositeName } from '../../ir/composites.ts';
import { OP_NAMES, type OpName } from '../../ir/ops.ts';

export const B = {
  run: 'bp_run',
  // statements
  assign: 'bp_assign',
  if: 'bp_if',
  while: 'bp_while',
  forEach: 'bp_for_each',
  return: 'bp_return',
  do: 'bp_do',
  print: 'bp_print',
  // expressions
  number: 'bp_number',
  text: 'bp_text',
  bool: 'bp_bool',
  date: 'bp_date',
  list: 'bp_list',
  var: 'bp_var',
  arith: 'bp_arith',
  compare: 'bp_compare',
  logic: 'bp_logic',
  not: 'bp_not',
  neg: 'bp_negate',
  // functions
  function: 'bp_function',
  call: 'bp_call',
  callStmt: 'bp_call_stmt',
} as const;

export function opBlockType(op: OpName): string {
  return `bp_op_${op.replace(/\./g, '_')}`;
}

export function compositeBlockType(name: CompositeName): string {
  return `bp_task_${name}`;
}

const OP_BY_TYPE = new Map<string, OpName>(OP_NAMES.map((op) => [opBlockType(op), op]));
const COMPOSITE_BY_TYPE = new Map<string, CompositeName>(
  COMPOSITE_NAMES.map((n) => [compositeBlockType(n), n]),
);

export function opOfBlockType(type: string): OpName | null {
  return OP_BY_TYPE.get(type) ?? null;
}

export function compositeOfBlockType(type: string): CompositeName | null {
  return COMPOSITE_BY_TYPE.get(type) ?? null;
}
