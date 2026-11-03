/** Blockly block type names, one per IR construct (design.md §9). */
import {
  ACTION_NAMES,
  COMPOSITE_NAMES,
  COMPOSITE_EXPR_NAMES,
  type CompositeName,
  type CompositeExprName,
} from '../../ir/composites.ts';
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
  textList: 'bp_text_list',
  size: 'bp_size',
  property: 'bp_its_property',
  readyCondition: 'bp_ready_condition',
  allOf: 'bp_all_of',
  anyOf: 'bp_any_of',
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

export function compositeExprBlockType(name: CompositeExprName): string {
  return `bp_expr_${name}`;
}

const OP_BY_TYPE = new Map<string, OpName>(OP_NAMES.map((op) => [opBlockType(op), op]));
const COMPOSITE_BY_TYPE = new Map<string, CompositeName>(
  [...COMPOSITE_NAMES, ...ACTION_NAMES].map((n) => [compositeBlockType(n), n]),
);
const COMPOSITE_EXPR_BY_TYPE = new Map<string, CompositeExprName>(
  COMPOSITE_EXPR_NAMES.map((n) => [compositeExprBlockType(n), n]),
);

export function opOfBlockType(type: string): OpName | null {
  return OP_BY_TYPE.get(type) ?? null;
}

export function compositeOfBlockType(type: string): CompositeName | null {
  return COMPOSITE_BY_TYPE.get(type) ?? null;
}

export function compositeExprOfBlockType(type: string): CompositeExprName | null {
  return COMPOSITE_EXPR_BY_TYPE.get(type) ?? null;
}
