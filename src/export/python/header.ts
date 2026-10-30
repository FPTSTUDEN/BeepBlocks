/**
 * Script header (design.md §8.1, Req 9.4, 9.6): what the program does, which blocks can
 * delete or overwrite files, how to run it, and what to watch out for.
 */
import type { Expr, FunctionDef, NodeId, Program, Stmt } from '../../ir/types.ts';
import { OPS } from '../../ir/ops.ts';
import { ID_SEPARATOR } from '../../ir/ids.ts';
import {
  capitalize,
  describeComposite,
  describeFunction,
  describeOp,
  describeStmt,
} from './describe.ts';
import { truncate } from './pysyntax.ts';

type AnyNode = Stmt | Expr | FunctionDef;

const MAX_LINE = 110;

// ------------------------------------------------------------------ traversal

function visitExpr(e: Expr, fn: (n: AnyNode) => void): void {
  fn(e);
  switch (e.kind) {
    case 'list':
      e.items.forEach((x) => visitExpr(x, fn));
      return;
    case 'binary':
      visitExpr(e.left, fn);
      visitExpr(e.right, fn);
      return;
    case 'unary':
      visitExpr(e.arg, fn);
      return;
    case 'op':
    case 'call':
      e.args.forEach((x) => visitExpr(x, fn));
      return;
    default:
      return;
  }
}

function visitStmts(stmts: readonly Stmt[], fn: (n: AnyNode) => void): void {
  for (const s of stmts) {
    fn(s);
    switch (s.kind) {
      case 'assign':
        visitExpr(s.value, fn);
        break;
      case 'if':
        visitExpr(s.cond, fn);
        visitStmts(s.then, fn);
        visitStmts(s.else, fn);
        break;
      case 'while':
        visitExpr(s.cond, fn);
        visitStmts(s.body, fn);
        break;
      case 'forEach':
        visitExpr(s.list, fn);
        visitStmts(s.body, fn);
        break;
      case 'return':
        if (s.value) visitExpr(s.value, fn);
        break;
      case 'do':
        visitExpr(s.expr, fn);
        break;
      case 'print':
        visitExpr(s.value, fn);
        break;
      case 'composite':
        Object.values(s.inputs).forEach((x) => visitExpr(x, fn));
        Object.values(s.bodies).forEach((b) => visitStmts(b, fn));
        break;
    }
  }
}

/** Calls `fn` on every function, statement and expression of the program. */
export function visitProgram(p: Program, fn: (n: AnyNode) => void): void {
  for (const f of p.functions) {
    fn(f);
    visitStmts(f.body, fn);
  }
  visitStmts(p.body, fn);
}

/** Maps a (possibly derived) id to the nearest id present in `nodes` (design.md §4.4). */
export function originOf<T>(id: NodeId, nodes: ReadonlyMap<NodeId, T>): NodeId | null {
  let cur = id;
  for (;;) {
    if (nodes.has(cur)) return cur;
    const cut = cur.lastIndexOf(ID_SEPARATOR);
    if (cut <= 0) return null;
    cur = cur.slice(0, cut);
  }
}

// ------------------------------------------------------------------ sections

export interface DestructiveOp {
  /** Id of the block in the original (undesugared) program. */
  blockId: NodeId;
  text: string;
}

/**
 * Blocks that can delete or overwrite files (ops with `destructive: true`, found in the
 * desugared program and attributed to the originating block — composites included).
 */
export function destructiveOps(original: Program, desugared: Program): DestructiveOp[] {
  const nodes = new Map<NodeId, AnyNode>();
  visitProgram(original, (n) => nodes.set(n.id, n));
  const out: DestructiveOp[] = [];
  const seen = new Set<NodeId>();
  visitProgram(desugared, (n) => {
    if (n.kind !== 'op' || !OPS[n.op].destructive) return;
    const blockId = originOf(n.id, nodes) ?? n.id;
    if (seen.has(blockId)) return;
    seen.add(blockId);
    const origin = nodes.get(blockId);
    let text: string;
    if (origin?.kind === 'composite') text = describeComposite(origin);
    else if (origin?.kind === 'op') text = capitalize(describeOp(origin.op, origin.args));
    else text = capitalize(describeOp(n.op, n.args));
    out.push({ blockId, text });
  });
  return out;
}

export interface HeaderInput {
  title: string;
  /** Undesugared program (composites preserved), for the descriptions. */
  original: Program;
  desugared: Program;
}

/** Header docstring text (unescaped; the emitter makes it safe for a raw docstring). */
export function buildHeader({ title, original, desugared }: HeaderInput): string {
  const line = (s: string) => `  - ${truncate(s, MAX_LINE)}`;
  const out: string[] = [`${title} \u2014 exported from Block Playground`, '', 'What it does:'];
  if (original.body.length === 0) out.push('  (nothing yet: the program is empty)');
  for (const s of original.body) out.push(line(describeStmt(s)));
  if (original.functions.length > 0) {
    out.push('', 'Functions it uses:');
    for (const f of original.functions) out.push(line(describeFunction(f)));
  }
  const destructive = destructiveOps(original, desugared);
  if (destructive.length > 0) {
    out.push('', '\u26a0 This script can DELETE or OVERWRITE files:');
    for (const d of destructive) out.push(line(`${d.text} (block ${d.blockId})`));
  }
  out.push(
    '',
    'How to run:',
    '  python script.py "C:\\path\\to\\folder"            # preview only (dry run, default)',
    '  python script.py "C:\\path\\to\\folder" --apply    # actually make the changes',
    '  (On macOS and Linux, use python3 and a path like ~/folder.)',
    '',
    'Changes are not undoable. Run the preview first.',
    '',
    'Good to know:',
    '  - The preview lists every change it would make, marked "[dry run]", and changes',
    '    nothing. Only --apply touches your files.',
    '  - If the script stops with an error part-way through, the changes it already made',
    '    with --apply stay made; nothing is rolled back. Check the folder before running',
    '    it again.',
    '  - Names are compared ignoring upper/lower case, as on Windows. On a case-sensitive',
    '    disk (usually Linux), two names that differ only in case (a.txt and A.txt) make',
    '    the script stop with an INVALID_NAME error.',
    '  - Unlike the playground, the script has no step limit, and items it creates get',
    "    the computer's current time as their modified time.",
  );
  return out.join('\n');
}
