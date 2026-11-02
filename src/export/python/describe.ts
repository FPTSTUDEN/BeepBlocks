/**
 * Plain-language descriptions of blocks, built from op and composite labels (design.md §8.1).
 * Used by the script header ("What it does", destructive operations) and the block comments.
 */
import type { Expr, FunctionDef, Stmt } from '../../ir/types.ts';
import { OPS, type OpArg, type OpName } from '../../ir/ops.ts';
import { COMPOSITE_SCHEMAS, getField, type CompositeStmt } from '../../ir/composites.ts';
import { pyNumber, truncate } from './pysyntax.ts';

const MAX_TEXT = 40;
const MAX_DEPTH = 4;

const quote = (s: string) => `"${truncate(s, MAX_TEXT)}"`;

export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

const BIN_WORDS: Record<string, string> = { and: 'and', or: 'or' };

function argText(e: Expr, sig: OpArg | undefined, depth: number): string {
  if (sig?.oneOf && e.kind === 'lit' && typeof e.value === 'string') return e.value;
  return describeExpr(e, depth + 1);
}

/** Fills an op label (`{0}`, `{1}`…) with descriptions of the arguments. */
export function describeOp(op: OpName, args: readonly Expr[], depth = 0): string {
  const sig = OPS[op];
  return sig.label.replace(/\{(\d)\}/g, (_m, i: string) => {
    const a = args[Number(i)];
    return a ? argText(a, sig.args[Number(i)], depth) : '?';
  });
}

export function describeExpr(e: Expr, depth = 0): string {
  if (depth > MAX_DEPTH) return '\u2026';
  switch (e.kind) {
    case 'lit':
      if (typeof e.value === 'string') return quote(e.value);
      if (typeof e.value === 'boolean') return e.value ? 'yes' : 'no';
      return pyNumber(e.value, e.float === true);
    case 'date':
      return e.iso;
    case 'list':
      if (e.items.length === 0) return 'an empty list';
      if (e.items.length > 4) return `a list of ${e.items.length} items`;
      return `[${e.items.map((x) => describeExpr(x, depth + 1)).join(', ')}]`;
    case 'var':
      return e.name;
    case 'unary':
      return e.op === 'not'
        ? `not ${describeExpr(e.arg, depth + 1)}`
        : `-${describeExpr(e.arg, depth + 1)}`;
    case 'binary': {
      const side = (x: Expr) => {
        const d = describeExpr(x, depth + 1);
        return x.kind === 'binary' ? `(${d})` : d;
      };
      return `${side(e.left)} ${BIN_WORDS[e.op] ?? e.op} ${side(e.right)}`;
    }
    case 'op':
      return describeOp(e.op, e.args, depth);
    case 'call':
      return `${e.fn}(${e.args.map((x) => describeExpr(x, depth + 1)).join(', ')})`;
    case 'compositeExpr':
      return e.name;
  }
}

/** Plain-language summary of one composite block, from its label and settings. */
export function describeComposite(c: CompositeStmt): string {
  const input = (key: string) => {
    const e = c.inputs[key];
    return e ? describeExpr(e, 1) : '?';
  };
  const text = (key: string) => {
    const v = getField(c, key);
    return v === null ? null : String(v);
  };
  switch (c.name) {
    case 'renameByPattern':
      return `Rename files in ${input('folder')} matching ${quote(text('match') ?? '*')} to ${quote(text('template') ?? '')}`;
    case 'sortByType':
      return `Sort files in ${input('folder')} into folders by ${text('grouping') ?? 'category'}`;
    case 'findAndAct': {
      const action = text('action') ?? 'move';
      const parts: string[] = [];
      const pattern = text('namePattern');
      if (pattern !== null) parts.push(`matching ${quote(pattern)}`);
      const ext = text('extension');
      if (ext !== null) parts.push(`with extension .${ext.replace(/^\./, '')}`);
      const min = text('minSize');
      if (min !== null) parts.push(`of at least ${min} bytes`);
      const max = text('maxSize');
      if (max !== null) parts.push(`of at most ${max} bytes`);
      const after = text('modifiedAfter');
      if (after !== null) parts.push(`modified on or after ${after}`);
      const before = text('modifiedBefore');
      if (before !== null) parts.push(`modified before ${before}`);
      const where =
        getField(c, 'recursive') === false
          ? `in ${input('folder')}`
          : `in ${input('folder')} and its subfolders`;
      let s = `${capitalize(action)} files ${where}`;
      if (parts.length > 0) s += ` ${parts.join(', ')}`;
      if (action === 'move' || action === 'copy') s += ` into ${input('destination')}`;
      if (action === 'rename') s += ` to ${quote(text('renameTemplate') ?? '')}`;
      return s;
    }
    case 'findFirst':
      return `Find the first file in ${input('folder')} (sorted by ${text('sortBy') ?? 'name'}) where ${input('condition')}`;
    default:
      return COMPOSITE_SCHEMAS[(c as CompositeStmt).name]?.label ?? 'Task block';
  }
}

/** Plain-language summary of one statement (nested bodies are not described). */
export function describeStmt(s: Stmt): string {
  switch (s.kind) {
    case 'assign':
      return `Set ${s.name} to ${describeExpr(s.value, 1)}`;
    case 'if':
      return s.else.length > 0
        ? `If ${describeExpr(s.cond, 1)} (otherwise something else)`
        : `If ${describeExpr(s.cond, 1)}`;
    case 'while':
      return `Repeat while ${describeExpr(s.cond, 1)}`;
    case 'forEach':
      return `For each ${s.name} in ${describeExpr(s.list, 1)}`;
    case 'return':
      return s.value ? `Give back ${describeExpr(s.value, 1)}` : 'Stop the function';
    case 'do':
      return s.expr.kind === 'op'
        ? capitalize(describeOp(s.expr.op, s.expr.args, 1))
        : `Run ${describeExpr(s.expr, 1)}`;
    case 'print':
      return `Show ${describeExpr(s.value, 1)}`;
    case 'composite':
      return describeComposite(s);
  }
}

export function describeFunction(f: FunctionDef): string {
  return `Function ${f.name}(${f.params.map((p) => p.name).join(', ')})`;
}
