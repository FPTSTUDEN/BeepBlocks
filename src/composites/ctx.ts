/**
 * Desugaring context and scope analysis (design.md §4.3, §4.4, §6.1).
 *
 * A *scope* is the whole program body or one whole function body (plus its parameters).
 * `freshName` avoids every variable name used anywhere in that scope — including names in
 * nested composites' bodies and binds, forEach variables and temporaries already handed
 * out to other composites in the same scope — plus every function name and every name the
 * validator would reject.
 */
import type { CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_SCHEMAS, getBind } from '../ir/composites.ts';
import { derivedId } from '../ir/ids.ts';
import type { Expr, FunctionDef, NodeId, Program, Stmt } from '../ir/types.ts';
import { checkIdentifier } from '../ir/validate.ts';

// ============================================================ Name collection

function collectExpr(e: Expr, out: Set<string>): void {
  switch (e.kind) {
    case 'var':
      out.add(e.name);
      return;
    case 'list':
      for (const item of e.items) collectExpr(item, out);
      return;
    case 'binary':
      collectExpr(e.left, out);
      collectExpr(e.right, out);
      return;
    case 'unary':
      collectExpr(e.arg, out);
      return;
    case 'op':
    case 'call':
      for (const a of e.args) collectExpr(a, out);
      return;
    case 'lit':
    case 'date':
      return;
  }
}

function collectComposite(s: CompositeStmt, out: Set<string>): void {
  const schema = COMPOSITE_SCHEMAS[s.name];
  for (const bind of schema.binds) out.add(getBind(s, bind.key));
  // Unknown bind keys are invalid, but avoiding their names costs nothing.
  for (const name of Object.values(s.binds)) if (name) out.add(name);
  for (const e of Object.values(s.inputs)) collectExpr(e, out);
  for (const body of Object.values(s.bodies)) collectStmts(body, out);
}

/** Adds every variable name used in `stmts` (recursively) to `out`. */
export function collectStmts(stmts: readonly Stmt[], out: Set<string>): void {
  for (const s of stmts) {
    switch (s.kind) {
      case 'assign':
        out.add(s.name);
        collectExpr(s.value, out);
        break;
      case 'if':
        collectExpr(s.cond, out);
        collectStmts(s.then, out);
        collectStmts(s.else, out);
        break;
      case 'while':
        collectExpr(s.cond, out);
        collectStmts(s.body, out);
        break;
      case 'forEach':
        out.add(s.name);
        collectExpr(s.list, out);
        collectStmts(s.body, out);
        break;
      case 'return':
        if (s.value) collectExpr(s.value, out);
        break;
      case 'do':
        collectExpr(s.expr, out);
        break;
      case 'print':
        collectExpr(s.value, out);
        break;
      case 'composite':
        collectComposite(s, out);
        break;
    }
  }
}

/**
 * All names a temporary must avoid in the given scope: function names, the function's
 * parameters (if any), and every variable name used anywhere in the scope's body.
 */
export function scopeNames(program: Program, fn: FunctionDef | null): Set<string> {
  const used = new Set<string>(program.functions.map((f) => f.name));
  if (fn) {
    for (const p of fn.params) used.add(p.name);
    collectStmts(fn.body, used);
  } else {
    collectStmts(program.body, used);
  }
  return used;
}

// ================================================================== Context

/**
 * Creates the context for desugaring one composite. `used` is the scope's shared name set;
 * names handed out by `freshName` are added to it so later composites avoid them too.
 */
export function makeCtx(compositeId: NodeId, used: Set<string>): DesugarCtx {
  const locals = new Set<string>();
  return {
    freshName(base: string): string {
      for (let k = 1; k <= 10_000; k++) {
        const name = k === 1 ? base : `${base}_${k}`;
        if (used.has(name) || checkIdentifier(name) !== null) continue;
        used.add(name);
        return name;
      }
      throw new Error(`freshName: cannot derive a valid variable name from "${base}".`);
    },
    id(local: string): NodeId {
      if (locals.has(local)) {
        throw new Error(`Desugaring of "${compositeId}" reused the local id "${local}".`);
      }
      locals.add(local);
      return derivedId(compositeId, local);
    },
  };
}
