/**
 * Terse IR builders for tests, fixtures, scenarios and desugarings.
 *
 * Every builder takes an optional explicit id as the LAST argument via `withId`, otherwise
 * ids are generated. Desugarings should always pass derived ids (`ctx.id('local')`).
 */
import type {
  Assign,
  BinOp,
  CallExpr,
  DateLit,
  Do,
  Expr,
  ForEach,
  FunctionDef,
  If,
  ListLit,
  Lit,
  NodeId,
  OpExpr,
  Print,
  Program,
  Return,
  Stmt,
  Type,
  Unary,
  Var,
  VarHint,
  While,
} from './types.ts';
import type { OpName } from './ops.ts';
import type { AnyCompositeName, CompositeExpr, CompositeExprName, CompositeStmt, FieldValue } from './composites.ts';
import { freshId } from './ids.ts';

const id = (given?: NodeId) => given ?? freshId();

export const b = {
  program: (body: Stmt[], functions: FunctionDef[] = []): Program => ({
    format: 'beepblocks-ir',
    version: 2,
    functions,
    body,
  }),
  fn: (
    name: string,
    params: { name: string; type: Type }[],
    returns: Type | null,
    body: Stmt[],
    nodeId?: NodeId,
  ): FunctionDef => ({ id: id(nodeId), kind: 'function', name, params, returns, body }),

  // ------------------------------------------------------------- exprs
  lit: (value: number | string | boolean, nodeId?: NodeId): Lit => ({ id: id(nodeId), kind: 'lit', value }),
  float: (value: number, nodeId?: NodeId): Lit => ({ id: id(nodeId), kind: 'lit', value, float: true }),
  date: (iso: string, nodeId?: NodeId): DateLit => ({ id: id(nodeId), kind: 'date', iso }),
  list: (itemType: Type, items: Expr[], nodeId?: NodeId): ListLit => ({
    id: id(nodeId),
    kind: 'list',
    itemType,
    items,
  }),
  v: (name: string, nodeId?: NodeId): Var => ({ id: id(nodeId), kind: 'var', name }),
  bin: (op: BinOp, left: Expr, right: Expr, nodeId?: NodeId) => ({
    id: id(nodeId),
    kind: 'binary' as const,
    op,
    left,
    right,
  }),
  not: (arg: Expr, nodeId?: NodeId): Unary => ({ id: id(nodeId), kind: 'unary', op: 'not', arg }),
  neg: (arg: Expr, nodeId?: NodeId): Unary => ({ id: id(nodeId), kind: 'unary', op: 'neg', arg }),
  op: (op: OpName, args: Expr[], nodeId?: NodeId): OpExpr => ({ id: id(nodeId), kind: 'op', op, args }),
  call: (fn: string, args: Expr[], nodeId?: NodeId): CallExpr => ({ id: id(nodeId), kind: 'call', fn, args }),

  // ------------------------------------------------------------- stmts
  assign: (name: string, value: Expr, nodeId?: NodeId, hint?: VarHint): Assign =>
    hint
      ? { id: id(nodeId), kind: 'assign', name, value, hint }
      : { id: id(nodeId), kind: 'assign', name, value },
  if: (cond: Expr, then: Stmt[], otherwise: Stmt[] = [], nodeId?: NodeId): If => ({
    id: id(nodeId),
    kind: 'if',
    cond,
    then,
    else: otherwise,
  }),
  while: (cond: Expr, body: Stmt[], nodeId?: NodeId): While => ({ id: id(nodeId), kind: 'while', cond, body }),
  forEach: (name: string, list: Expr, body: Stmt[], nodeId?: NodeId): ForEach => ({
    id: id(nodeId),
    kind: 'forEach',
    name,
    list,
    body,
  }),
  ret: (value: Expr | null, nodeId?: NodeId): Return => ({ id: id(nodeId), kind: 'return', value }),
  do: (expr: OpExpr | CallExpr, nodeId?: NodeId): Do => ({ id: id(nodeId), kind: 'do', expr }),
  print: (value: Expr, nodeId?: NodeId): Print => ({ id: id(nodeId), kind: 'print', value }),
  composite: (
    name: AnyCompositeName,
    parts: {
      fields?: Record<string, FieldValue>;
      inputs?: Record<string, Expr>;
      bodies?: Record<string, Stmt[]>;
      binds?: Record<string, string>;
    } = {},
    nodeId?: NodeId,
  ): CompositeStmt => ({
    id: id(nodeId),
    kind: 'composite',
    name,
    fields: parts.fields ?? {},
    inputs: parts.inputs ?? {},
    bodies: parts.bodies ?? {},
    binds: parts.binds ?? {},
  }),
  compositeExpr: (
    name: CompositeExprName,
    parts: { fields?: Record<string, FieldValue>; inputs?: Record<string, Expr>; binds?: Record<string, string> } = {},
    nodeId?: NodeId,
  ): CompositeExpr => ({
    id: id(nodeId),
    kind: 'compositeExpr',
    name,
    fields: parts.fields ?? {},
    inputs: parts.inputs ?? {},
    binds: parts.binds ?? {},
  }),

  // ---------------------------------------------------------- shorthands
  root: (nodeId?: NodeId): OpExpr => b.op('fs.root', [], nodeId),
  str: (value: Expr, nodeId?: NodeId): OpExpr => b.op('text.from', [value], nodeId),
};
