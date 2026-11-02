/**
 * IR core types — CONTRACT (design.md §4.1). Read-only for Phase 1 workstreams.
 *
 * The IR is the single source of truth for program meaning. The editor produces it,
 * the composites module desugars it, and the simulator and exporter consume the
 * desugared (primitive-only) form.
 */
import type { CompositeStmt } from './composites.ts';
import type { OpName } from './ops.ts';

export type NodeId = string;

/** Static types. `number` covers both Python int and float at runtime. */
export type Type =
  | { t: 'number' }
  | { t: 'text' }
  | { t: 'bool' }
  | { t: 'path' }
  | { t: 'list'; of: Type };

export const T = {
  number: { t: 'number' } as Type,
  text: { t: 'text' } as Type,
  bool: { t: 'bool' } as Type,
  path: { t: 'path' } as Type,
  list: (of: Type): Type => ({ t: 'list', of }),
} as const;

export interface Program {
  format: 'beepblocks-ir';
  version: 1;
  functions: FunctionDef[];
  body: Stmt[];
}

export interface FunctionDef {
  id: NodeId;
  kind: 'function';
  /** Valid Python identifier; see validate.ts for reserved names. */
  name: string;
  params: { name: string; type: Type }[];
  /** null = the function returns nothing (used as a statement via `do`). */
  returns: Type | null;
  body: Stmt[];
}

// ---------------------------------------------------------------- Statements

export type Stmt = Assign | If | While | ForEach | Return | Do | Print | CompositeStmt;

/** Primitive statements only — what the simulator and exporter accept. */
export type PrimitiveStmt = Exclude<Stmt, CompositeStmt>;

export interface Assign {
  id: NodeId;
  kind: 'assign';
  name: string;
  value: Expr;
  hint?: VarHint;
}

export interface If {
  id: NodeId;
  kind: 'if';
  cond: Expr;
  then: Stmt[];
  else: Stmt[];
}

export interface While {
  id: NodeId;
  kind: 'while';
  cond: Expr;
  body: Stmt[];
}

/** The list is evaluated once before the first iteration. The loop variable lives in the enclosing scope. */
export interface ForEach {
  id: NodeId;
  kind: 'forEach';
  name: string;
  list: Expr;
  body: Stmt[];
}

export interface Return {
  id: NodeId;
  kind: 'return';
  value: Expr | null;
}

/** Expression statement: an op or call whose result (if any) is discarded. */
export interface Do {
  id: NodeId;
  kind: 'do';
  expr: OpExpr | CallExpr;
}

/** `value` must be of type text. */
export interface Print {
  id: NodeId;
  kind: 'print';
  value: Expr;
}

/** Visualization hint: this number variable is an index into list variable `indexInto`. */
export interface VarHint {
  indexInto: string;
}

// --------------------------------------------------------------- Expressions

export type Expr = Lit | DateLit | ListLit | Var | Binary | Unary | OpExpr | CallExpr;

/**
 * Literal. For numbers, `float: true` marks a Python float literal (`3.0`);
 * otherwise an integral number is a Python int. Non-integral numbers are always float.
 */
export interface Lit {
  id: NodeId;
  kind: 'lit';
  value: number | string | boolean;
  float?: boolean;
}

/** 'YYYY-MM-DD' at UTC midnight; evaluates to integer epoch seconds (type number). */
export interface DateLit {
  id: NodeId;
  kind: 'date';
  iso: string;
}

export interface ListLit {
  id: NodeId;
  kind: 'list';
  itemType: Type;
  items: Expr[];
}

export interface Var {
  id: NodeId;
  kind: 'var';
  name: string;
}

export type ArithOp = '+' | '-' | '*' | '/' | '//' | '%';
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type LogicOp = 'and' | 'or';
export type BinOp = ArithOp | CompareOp | LogicOp;

export const COMPARE_OPS: readonly CompareOp[] = ['==', '!=', '<', '<=', '>', '>='];
export const ARITH_OPS: readonly ArithOp[] = ['+', '-', '*', '/', '//', '%'];

export interface Binary {
  id: NodeId;
  kind: 'binary';
  op: BinOp;
  left: Expr;
  right: Expr;
}

export interface Unary {
  id: NodeId;
  kind: 'unary';
  op: 'not' | 'neg';
  arg: Expr;
}

export interface OpExpr {
  id: NodeId;
  kind: 'op';
  op: OpName;
  args: Expr[];
}

export interface CallExpr {
  id: NodeId;
  kind: 'call';
  fn: string;
  args: Expr[];
}

// ------------------------------------------------------------------- Helpers

export function typeEquals(a: Type, b: Type): boolean {
  if (a.t !== b.t) return false;
  if (a.t === 'list' && b.t === 'list') return typeEquals(a.of, b.of);
  return true;
}

export function typeToString(t: Type): string {
  return t.t === 'list' ? `list of ${typeToString(t.of)}` : t.t;
}

/** Plain-language type names for user-facing messages. */
export function typeToPlain(t: Type): string {
  switch (t.t) {
    case 'number':
      return 'a number';
    case 'text':
      return 'text';
    case 'bool':
      return 'a yes/no value';
    case 'path':
      return 'a file or folder';
    case 'list':
      return `a list of ${typePlural(t.of)}`;
  }
}

function typePlural(t: Type): string {
  switch (t.t) {
    case 'number':
      return 'numbers';
    case 'text':
      return 'texts';
    case 'bool':
      return 'yes/no values';
    case 'path':
      return 'files or folders';
    case 'list':
      return `lists of ${typePlural(t.of)}`;
  }
}

export function emptyProgram(): Program {
  return { format: 'beepblocks-ir', version: 1, functions: [], body: [] };
}
