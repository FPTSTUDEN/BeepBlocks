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
  CompositeExprName,
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
import { everyFile } from './everyFile.ts';
import { makeFolderIfMissing } from './makeFolderIfMissing.ts';
import { goThrough } from './goThrough.ts';
import { repeatTimes } from './repeatTimes.ts';
import { keepDoingUntil } from './keepDoingUntil.ts';
import { findFile } from './findFile.ts';
import { halvingSearch } from './halvingSearch.ts';
import { filesIn } from './filesIn.ts';
import { countFiles } from './countFiles.ts';
import { typeOf } from './typeOf.ts';

export { CATEGORIES, NO_EXTENSION_FOLDER, OTHER_CATEGORY, categoryOf } from './sortByType.ts';

export const COMPOSITES: Partial<Record<CompositeName, CompositeDef>> = {
  renameByPattern,
  sortByType,
  findAndAct,
  findFirst,
  everyFile,
  makeFolderIfMissing,
  goThrough,
  repeatTimes,
  keepDoingUntil,
  findFile,
  halvingSearch,
};

/** Expression-action registry. Phase 0 keeps this open for action implementations. */
export const EXPRESSION_COMPOSITES: Partial<Record<CompositeExprName, CompositeExprDef>> = {
  filesIn,
  countFiles,
  typeOf,
};

interface RewrittenExpr {
  expr: Expr;
  pre: Stmt[];
}

function containsExpr(e: Expr, id: NodeId): boolean {
  if (e.id === id) return true;
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
  return children.some((child) => containsExpr(child, id));
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
        ? b.if(b.v(temp, `${e.id}/sc.cond`), [...right.pre, b.assign(temp, right.expr, `${e.id}/sc.right`)], [], `${e.id}/sc.if`)
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

function rewriteExprOne(e: Expr, target: NodeId, replacement: RewrittenExpr, used: Set<string>): RewrittenExpr {
  if (e.kind === 'compositeExpr' && e.id === target) return replacement;
  if (e.kind === 'list') {
    const items = e.items.map((x) => rewriteExprOne(x, target, replacement, used));
    return { expr: { ...e, items: items.map((x) => x.expr) }, pre: items.flatMap((x) => x.pre) };
  }
  if (e.kind === 'unary') {
    const x = rewriteExprOne(e.arg, target, replacement, used);
    return { expr: { ...e, arg: x.expr }, pre: x.pre };
  }
  if (e.kind === 'op' || e.kind === 'call') {
    const args = e.args.map((x) => rewriteExprOne(x, target, replacement, used));
    return { expr: { ...e, args: args.map((x) => x.expr) }, pre: args.flatMap((x) => x.pre) };
  }
  if (e.kind === 'binary') {
    const left = rewriteExprOne(e.left, target, replacement, used);
    const right = rewriteExprOne(e.right, target, replacement, used);
    if ((e.op === 'and' || e.op === 'or') && right.pre.length > 0) {
      const temp = usedName(used, 'ok');
      const guarded = e.op === 'and'
        ? b.if(b.v(temp, `${e.id}/sc.cond`), [...right.pre, b.assign(temp, right.expr, `${e.id}/sc.right`)], [], `${e.id}/sc.if`)
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

function deriveExpr(e: Expr, suffix: string): Expr {
  const id = `${e.id}/${suffix}`;
  switch (e.kind) {
    case 'list':
      return { ...e, id, items: e.items.map((item) => deriveExpr(item, suffix)) };
    case 'binary':
      return { ...e, id, left: deriveExpr(e.left, suffix), right: deriveExpr(e.right, suffix) };
    case 'unary':
      return { ...e, id, arg: deriveExpr(e.arg, suffix) };
    case 'op':
    case 'call':
      return { ...e, id, args: e.args.map((arg) => deriveExpr(arg, suffix)) };
    case 'compositeExpr':
      return {
        ...e,
        id,
        inputs: Object.fromEntries(Object.entries(e.inputs).map(([key, value]) => [key, deriveExpr(value, suffix)])),
      };
    default:
      return { ...e, id };
  }
}

function deriveStmt(s: Stmt, suffix: string): Stmt {
  const id = `${s.id}/${suffix}`;
  switch (s.kind) {
    case 'assign':
      return { ...s, id, value: deriveExpr(s.value, suffix) };
    case 'if':
      return { ...s, id, cond: deriveExpr(s.cond, suffix), then: s.then.map((x) => deriveStmt(x, suffix)), else: s.else.map((x) => deriveStmt(x, suffix)) };
    case 'while':
      return { ...s, id, cond: deriveExpr(s.cond, suffix), body: s.body.map((x) => deriveStmt(x, suffix)) };
    case 'forEach':
      return { ...s, id, list: deriveExpr(s.list, suffix), body: s.body.map((x) => deriveStmt(x, suffix)) };
    case 'return':
      return { ...s, id, value: s.value === null ? null : deriveExpr(s.value, suffix) };
    case 'do':
      return { ...s, id, expr: deriveExpr(s.expr, suffix) as typeof s.expr };
    case 'print':
      return { ...s, id, value: deriveExpr(s.value, suffix) };
    case 'composite':
      return {
        ...s,
        id,
        inputs: Object.fromEntries(Object.entries(s.inputs).map(([key, value]) => [key, deriveExpr(value, suffix)])),
        bodies: Object.fromEntries(Object.entries(s.bodies).map(([key, body]) => [key, body.map((x) => deriveStmt(x, suffix))])),
      };
  }
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
      const again = x.pre.map((child) => deriveStmt(child, 'again'));
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

interface ExpressionLocation {
  node: CompositeExpr;
  stmt: Stmt;
  role: 'before' | 'whileCond' | 'shortCircuit';
}

function expressionLocation(stmts: readonly Stmt[], id: NodeId): ExpressionLocation | null {
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
      const node = findExprInExpr(e, id);
      if (!node) continue;
      const shortCircuit = (x: Expr): boolean =>
        x.kind === 'binary' &&
        (x.op === 'and' || x.op === 'or') &&
        (containsExpr(x.right, id) || shortCircuit(x.left) || shortCircuit(x.right));
      return {
        node,
        stmt: s,
        role: s.kind === 'while' ? 'whileCond' : shortCircuit(e) ? 'shortCircuit' : 'before',
      };
    }
    const bodies =
      s.kind === 'if' ? [s.then, s.else] :
      s.kind === 'while' || s.kind === 'forEach' ? [s.body] :
      s.kind === 'composite' ? Object.values(s.bodies) : [];
    for (const body of bodies) {
      const found = expressionLocation(body, id);
      if (found) return found;
    }
  }
  return null;
}

function replaceStmtInLists(stmts: readonly Stmt[], id: NodeId, replacement: readonly Stmt[]): Stmt[] {
  return stmts.flatMap((s): Stmt[] => {
    if (s.id === id) return [...replacement];
    switch (s.kind) {
      case 'if':
        return [{ ...s, then: replaceStmtInLists(s.then, id, replacement), else: replaceStmtInLists(s.else, id, replacement) }];
      case 'while':
      case 'forEach':
        return [{ ...s, body: replaceStmtInLists(s.body, id, replacement) }];
      case 'composite':
        return [{ ...s, bodies: Object.fromEntries(Object.entries(s.bodies).map(([k, v]) => [k, replaceStmtInLists(v, id, replacement)])) }];
      default:
        return [s];
    }
  });
}

export interface ExpressionExpansion {
  result: Extract<DesugarOneResult, { kind: 'expr' }>;
  program: Program;
  replacement: Stmt[];
}

/** Applies one expression expansion using the same rewrite rules as desugarProgram. */
export function expandExpressionOne(input: Program, compositeId: NodeId): ExpressionExpansion {
  const program = structuredClone(input);
  let location = expressionLocation(program.body, compositeId);
  let scope: FunctionDef | null = null;
  for (const fn of program.functions) {
    if (location) break;
    location = expressionLocation(fn.body, compositeId);
    if (location) scope = fn;
  }

  if (!location) throw new Error(`desugarExpressionOne: there is no expression action with id "${compositeId}".`);
  const used = scopeNames(program, scope);
  const def = EXPRESSION_COMPOSITES[location.node.name];
  if (!def) throw new Error(`No desugaring registered for expression action "${location.node.name}".`);
  const result = def.desugar(location.node, makeCtx(location.node.id, used));
  const rewritten = rewriteStmtExpressionsOne(
    location.stmt,
    compositeId,
    { pre: result.pre, expr: result.value },
    used,
  );
  const replacement =
    rewritten.pre.length > 0
      ? [...rewritten.pre, rewritten.stmt]
      : [rewritten.stmt];
  const functions = program.functions.map((fn) =>
    fn === scope ? { ...fn, body: replaceStmtInLists(fn.body, location!.stmt.id, replacement) } : fn,
  );
  const body = scope ? program.body : replaceStmtInLists(program.body, location.stmt.id, replacement);
  return {
    result: { kind: 'expr', ...result, anchor: location.stmt.id, anchorRole: location.role },
    program: { ...program, functions, body },
    replacement,
  };
}

/** Fully expands the statements introduced by one expression action. */
export function expandExpressionFully(input: Program, compositeId: NodeId): ExpressionExpansion {
  const one = expandExpressionOne(input, compositeId);
  let scope: FunctionDef | null = null;
  for (const fn of one.program.functions) {
    if (findIn(fn.body, one.result.anchor)) {
      scope = fn;
      break;
    }
  }
  const replacement = desugarStmts(one.replacement, scopeNames(one.program, scope));
  const functions = one.program.functions.map((fn) =>
    fn === scope ? { ...fn, body: replaceStmtInLists(fn.body, one.result.anchor, replacement) } : fn,
  );
  const body = scope ? one.program.body : replaceStmtInLists(one.program.body, one.result.anchor, replacement);
  return {
    result: one.result,
    program: { ...one.program, functions, body },
    replacement,
  };
}

function rewriteStmtExpressionsOne(
  s: Stmt,
  target: NodeId,
  result: RewrittenExpr,
  used: Set<string>,
): { pre: Stmt[]; stmt: Stmt } {
  const one = (e: Expr): RewrittenExpr => rewriteExprOne(e, target, result, used);
  switch (s.kind) {
    case 'assign': { const x = one(s.value); return { pre: x.pre, stmt: { ...s, value: x.expr } }; }
    case 'if': { const x = one(s.cond); return { pre: x.pre, stmt: { ...s, cond: x.expr } }; }
    case 'while': {
      const x = one(s.cond);
      const again = x.pre.map((child) => deriveStmt(child, 'again'));
      return { pre: x.pre, stmt: { ...s, cond: x.expr, body: [...s.body, ...again] } };
    }
    case 'forEach': { const x = one(s.list); return { pre: x.pre, stmt: { ...s, list: x.expr } }; }
    case 'return': { if (!s.value) return { pre: [], stmt: s }; const x = one(s.value); return { pre: x.pre, stmt: { ...s, value: x.expr } }; }
    case 'do': { const x = one(s.expr); return { pre: x.pre, stmt: { ...s, expr: x.expr as typeof s.expr } }; }
    case 'print': { const x = one(s.value); return { pre: x.pre, stmt: { ...s, value: x.expr } }; }
    case 'composite': return { pre: [], stmt: s };
  }
}

/** One expression expansion result, kept separate from the legacy statement API. */
export const desugarExpressionOne = (input: Program, compositeId: NodeId): DesugarOneResult => {
  return expandExpressionOne(input, compositeId).result;
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
