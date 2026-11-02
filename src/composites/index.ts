/**
 * Composite desugarings — Workstream C (design.md §6).
 *
 * - `desugarProgram` is pure and deterministic, desugars innermost composites first, and
 *   returns a program that passes `validateProgram(p, { primitiveOnly: true })`.
 * - Temporaries come from `DesugarCtx.freshName`, which avoids every name used anywhere
 *   in the enclosing scope (whole function or whole program body), not just earlier ones.
 * - Node ids are derived: `${composite.id}/${local}`.
 */
import type {
  CompositeDef,
  CompositeExprDef,
  CompositeExpr,
  CompositeName,
  CompositeStmt,
  DesugarOne,
  DesugarOneResult,
  DesugarFully,
  DesugarProgram,
} from '../ir/composites.ts';
import type { Expr, FunctionDef, NodeId, Program, Stmt } from '../ir/types.ts';
import { makeCtx, scopeNames } from './ctx.ts';
import { b } from '../ir/build.ts';
import { findAndAct } from './findAndAct.ts';
import { findFirst } from './findFirst.ts';
import { renameByPattern } from './renameByPattern.ts';
import { sortByType } from './sortByType.ts';

export { CATEGORIES, NO_EXTENSION_FOLDER, OTHER_CATEGORY, categoryOf } from './sortByType.ts';

export const COMPOSITES: Partial<Record<CompositeName, CompositeDef>> = {
  renameByPattern,
  sortByType,
  findAndAct,
  findFirst,
};

/** Expression-action registry. Phase 0 keeps this open for action implementations. */
export const EXPRESSION_COMPOSITES: Partial<Record<string, CompositeExprDef>> = {};

interface RewrittenExpr {
  expr: Expr;
  pre: Stmt[];
}

function rewriteExpr(e: Expr, used: Set<string>): RewrittenExpr {
  if (e.kind === 'compositeExpr') {
    const def = EXPRESSION_COMPOSITES[e.name];
    if (!def) return { expr: e, pre: [] };
    const result = def.desugar(e, makeCtx(e.id, used));
    return { expr: result.value, pre: result.pre };
  }
  if (e.kind === 'list') {
    const items = e.items.map((x) => rewriteExpr(x, used));
    return { expr: { ...e, items: items.map((x) => x.expr) }, pre: items.flatMap((x) => x.pre) };
  }
  if (e.kind === 'unary') {
    const x = rewriteExpr(e.arg, used);
    return { expr: { ...e, arg: x.expr }, pre: x.pre };
  }
  if (e.kind === 'op' || e.kind === 'call') {
    const args = e.args.map((x) => rewriteExpr(x, used));
    return { expr: { ...e, args: args.map((x) => x.expr) }, pre: args.flatMap((x) => x.pre) };
  }
  if (e.kind === 'binary') {
    const left = rewriteExpr(e.left, used);
    const right = rewriteExpr(e.right, used);
    if ((e.op === 'and' || e.op === 'or') && right.pre.length > 0) {
      const temp = usedName(used, 'ok');
      const guarded = e.op === 'and'
        ? b.if(b.v(temp, `${e.id}/sc.if`), [...right.pre, b.assign(temp, right.expr, `${e.id}/sc.right`)], [], `${e.id}/sc.if`)
        : b.if(b.not(b.v(temp, `${e.id}/sc.not`), `${e.id}/sc.not`), [...right.pre, b.assign(temp, right.expr, `${e.id}/sc.right`)], [], `${e.id}/sc.if`);
      return {
        expr: b.v(temp, `${e.id}/sc.value`),
        pre: [...left.pre, b.assign(temp, left.expr, `${e.id}/sc.left`), guarded],
      };
    }
    return { expr: { ...e, left: left.expr, right: right.expr }, pre: [...left.pre, ...right.pre] };
  }
  return { expr: e, pre: [] };
}

function usedName(used: Set<string>, base: string): string {
  for (let n = 1; n < 10_000; n++) {
    const name = n === 1 ? base : `${base}_${n}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  throw new Error(`Cannot create a temporary name from "${base}".`);
}

function rewriteStmtExpressions(s: Stmt, used: Set<string>): { pre: Stmt[]; stmt: Stmt } {
  const one = (e: Expr): RewrittenExpr => rewriteExpr(e, used);
  switch (s.kind) {
    case 'assign': {
      const x = one(s.value);
      return { pre: x.pre, stmt: { ...s, value: x.expr } };
    }
    case 'if': {
      const x = one(s.cond);
      return { pre: x.pre, stmt: { ...s, cond: x.expr, then: desugarStmts(s.then, used), else: desugarStmts(s.else, used) } };
    }
    case 'while': {
      const x = one(s.cond);
      const body = desugarStmts(s.body, used);
      if (x.pre.length === 0) return { pre: [], stmt: { ...s, cond: x.expr, body } };
      const again = structuredClone(x.pre).map((child, i) => ({ ...child, id: `${child.id}/again/${i}` }));
      return { pre: x.pre, stmt: { ...s, cond: x.expr, body: [...body, ...again] } };
    }
    case 'forEach': {
      const x = one(s.list);
      return { pre: x.pre, stmt: { ...s, list: x.expr, body: desugarStmts(s.body, used) } };
    }
    case 'return':
      if (!s.value) return { pre: [], stmt: s };
      { const x = one(s.value); return { pre: x.pre, stmt: { ...s, value: x.expr } }; }
    case 'do': {
      const x = one(s.expr);
      return { pre: x.pre, stmt: { ...s, expr: x.expr as typeof s.expr } };
    }
    case 'print': {
      const x = one(s.value);
      return { pre: x.pre, stmt: { ...s, value: x.expr } };
    }
    case 'composite':
      return { pre: [], stmt: s };
  }
}

function defFor(node: CompositeStmt): CompositeDef {
  const def = COMPOSITES[node.name];
  if (!def) throw new Error(`No desugaring registered for task block "${node.name}".`);
  return def;
}

// ============================================================ desugarProgram

/** Desugars every composite in `stmts` (innermost first). `used` is the scope's name set. */
function desugarStmts(stmts: readonly Stmt[], used: Set<string>): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    const rewritten = rewriteStmtExpressions(s, used);
    if (rewritten.pre.length > 0) out.push(...rewritten.pre);
    const current = rewritten.stmt;
    switch (s.kind) {
      case 'if':
        out.push(current);
        break;
      case 'while':
      case 'forEach':
        out.push(current);
        break;
      case 'composite': {
        const replacement = defFor(current as Extract<Stmt, { kind: 'composite' }>).desugar(current as Extract<Stmt, { kind: 'composite' }>, makeCtx(s.id, used));
        out.push(...desugarStmts(replacement, used));
        break;
      }
      default:
        out.push(current);
    }
  }
  return out;
}

export const desugarProgram: DesugarProgram = (input) => {
  // Clone so the output shares no objects with the input (callers may mutate either).
  const program = structuredClone(input);
  return {
    ...program,
    functions: program.functions.map((fn) => ({
      ...fn,
      body: desugarStmts(fn.body, scopeNames(program, fn)),
    })),
    body: desugarStmts(program.body, scopeNames(program, null)),
  };
};

// ================================================================ desugarOne

function findIn(stmts: readonly Stmt[], id: NodeId): Stmt | null {
  for (const s of stmts) {
    if (s.id === id) return s;
    let children: readonly (readonly Stmt[])[] = [];
    switch (s.kind) {
      case 'if':
        children = [s.then, s.else];
        break;
      case 'while':
      case 'forEach':
        children = [s.body];
        break;
      case 'composite':
        children = Object.values(s.bodies);
        break;
      default:
        break;
    }
    for (const c of children) {
      const r = findIn(c, id);
      if (r) return r;
    }
  }
  return null;
}

export const desugarOne: DesugarOne = (input, compositeId) => {
  const program = structuredClone(input);
  let scope: FunctionDef | null = null;
  let found = findIn(program.body, compositeId);
  for (const fn of program.functions) {
    if (found) break;
    found = findIn(fn.body, compositeId);
    if (found) scope = fn;
  }
  if (!found) throw new Error(`desugarOne: there is no block with id "${compositeId}".`);
  if (found.kind !== 'composite') {
    throw new Error(
      `desugarOne: block "${compositeId}" is a "${found.kind}" block, not a task block.`,
    );
  }
  const node = found;
  return defFor(node).desugar(node, makeCtx(node.id, scopeNames(program, scope)));
};

function findExprInExpr(e: Expr, id: NodeId): CompositeExpr | null {
  if (e.kind === 'compositeExpr' && e.id === id) return e;
  const children =
    e.kind === 'list'
      ? e.items
      : e.kind === 'binary'
        ? [e.left, e.right]
        : e.kind === 'unary'
          ? [e.arg]
          : e.kind === 'op' || e.kind === 'call'
            ? e.args
            : e.kind === 'compositeExpr'
              ? Object.values(e.inputs)
              : [];
  for (const child of children) {
    const found = findExprInExpr(child, id);
    if (found) return found;
  }
  return null;
}

function findExprInStmt(stmts: readonly Stmt[], id: NodeId): CompositeExpr | null {
  for (const s of stmts) {
    const values: Expr[] =
      s.kind === 'assign' ? [s.value] :
      s.kind === 'if' ? [s.cond] :
      s.kind === 'while' ? [s.cond] :
      s.kind === 'forEach' ? [s.list] :
      s.kind === 'return' && s.value ? [s.value] :
      s.kind === 'do' ? [s.expr] :
      s.kind === 'print' ? [s.value] : [];
    for (const e of values) {
      const found = findExprInExpr(e, id);
      if (found) return found;
    }
    const bodies = s.kind === 'if' ? [s.then, s.else] : s.kind === 'while' || s.kind === 'forEach' ? [s.body] : s.kind === 'composite' ? Object.values(s.bodies) : [];
    for (const body of bodies) {
      const found = findExprInStmt(body, id);
      if (found) return found;
    }
  }
  return null;
}

/** One expression expansion result, kept separate from the legacy statement API. */
export const desugarExpressionOne = (input: Program, compositeId: NodeId): DesugarOneResult => {
  const program = structuredClone(input);
  const node = findExprInStmt(program.body, compositeId) ??
    program.functions.map((f) => findExprInStmt(f.body, compositeId)).find((x): x is CompositeExpr => x !== null);
  if (!node) throw new Error(`desugarExpressionOne: there is no expression action with id "${compositeId}".`);
  const def = EXPRESSION_COMPOSITES[node.name];
  if (!def) throw new Error(`No desugaring registered for expression action "${node.name}".`);
  const scope = scopeNames(program, null);
  const result = def.desugar(node, makeCtx(node.id, scope));
  return { kind: 'expr', ...result, anchor: node.id, anchorRole: 'before' };
};

/** Full expansion entry point for editor integrations; statement composites use the v1-compatible result shape. */
export const desugarFully: DesugarFully = (input, compositeId) => {
  const found = findIn(input.body, compositeId);
  if (found?.kind === 'composite') {
    const fn = input.functions.find((f) => findIn(f.body, compositeId) !== null) ?? null;
    const replacement = desugarOne(input, compositeId);
    return {
      kind: 'stmt',
      stmts: desugarStmts(replacement, scopeNames(input, fn)),
    };
  }
  return desugarExpressionOne(input, compositeId);
};
