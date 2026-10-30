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
  CompositeName,
  CompositeStmt,
  DesugarOne,
  DesugarProgram,
} from '../ir/composites.ts';
import type { FunctionDef, NodeId, Stmt } from '../ir/types.ts';
import { makeCtx, scopeNames } from './ctx.ts';
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
    switch (s.kind) {
      case 'if':
        out.push({ ...s, then: desugarStmts(s.then, used), else: desugarStmts(s.else, used) });
        break;
      case 'while':
      case 'forEach':
        out.push({ ...s, body: desugarStmts(s.body, used) });
        break;
      case 'composite': {
        const bodies: Record<string, Stmt[]> = {};
        for (const [key, body] of Object.entries(s.bodies)) bodies[key] = desugarStmts(body, used);
        out.push(...defFor(s).desugar({ ...s, bodies }, makeCtx(s.id, used)));
        break;
      }
      default:
        out.push(s);
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
