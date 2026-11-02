/**
 * Desugared IR → Python source (design.md §8.2).
 *
 * General ops become idiomatic Python where its semantics already match the simulator
 * (`len(x)`, `s.lower()`, `a + b`, `sorted(xs)`); everything else goes through readable
 * runtime helpers (`_bp_get`, `_bp_wildcard`, `fs.rename`…). Every call that can fail gets
 * `at="<id>"` with the id of the innermost node that raises, exactly as in the simulator.
 */
import type {
  BinOp,
  Expr,
  FunctionDef,
  NodeId,
  OpExpr,
  Program,
  Stmt,
  Type,
} from '../../ir/types.ts';
import type { OpName } from '../../ir/ops.ts';
import { RUNTIME_PY } from './runtime.gen.ts';
import { describeFunction, describeStmt } from './describe.ts';
import { originOf } from './header.ts';
import {
  commentText,
  docstringText,
  pyNumber,
  pyPatternString,
  pyString,
  truncate,
} from './pysyntax.ts';

// ---------------------------------------------------------------- precedence

/** Python operator precedence (higher binds tighter). */
const PREC = { or: 2, and: 3, not: 4, cmp: 5, add: 7, mul: 8, neg: 9, atom: 11 } as const;

interface Code {
  text: string;
  prec: number;
}

const atom = (text: string): Code => ({ text, prec: PREC.atom });

/** Parenthesizes `c` if it binds less tightly than `min`. */
function wrap(c: Code, min: number): string {
  return c.prec >= min ? c.text : `(${c.text})`;
}

function call(fn: string, args: readonly Code[], at?: NodeId): Code {
  const parts = args.map((a) => a.text);
  if (at !== undefined) parts.push(`at=${pyString(at)}`);
  return atom(`${fn}(${parts.join(', ')})`);
}

function method(receiver: Code, name: string, args: readonly Code[] = []): Code {
  return atom(`${wrap(receiver, PREC.atom)}.${name}(${args.map((a) => a.text).join(', ')})`);
}

function infix(left: Code, op: string, right: Code, prec: number): Code {
  return { text: `${wrap(left, prec)} ${op} ${wrap(right, prec + 1)}`, prec };
}

/** Comparisons (and `in`) never chain: both sides must bind tighter (`(a < b) == c`). */
function compare(left: Code, op: string, right: Code): Code {
  return { text: `${wrap(left, PREC.cmp + 1)} ${op} ${wrap(right, PREC.cmp + 1)}`, prec: PREC.cmp };
}

// ------------------------------------------------------------------- op table

export interface OpEmitContext {
  node: OpExpr;
  /** Static type of an expression node (from `typecheck`). */
  typeOf(e: Expr): Type | undefined;
}

export type OpEmitter = (args: Code[], ctx: OpEmitContext) => Code;

const litText = (e: Expr | undefined): string =>
  e?.kind === 'lit' && typeof e.value === 'string' ? e.value : '';
const litBool = (e: Expr | undefined): boolean => e?.kind === 'lit' && e.value === true;

/** fs method that can fail: `fs.<name>(args…, at="id")`. */
const fsOp =
  (name: string): OpEmitter =>
  (args, { node }) =>
    call(`fs.${name}`, args, node.id);
/** fs method that never fails. */
const fsPure =
  (name: string): OpEmitter =>
  (args) =>
    call(`fs.${name}`, args);
/** Runtime helper that can fail. */
const helper =
  (name: string): OpEmitter =>
  (args, { node }) =>
    call(name, args, node.id);
/** Runtime helper or builtin that never fails. */
const pure =
  (name: string): OpEmitter =>
  (args) =>
    call(name, args);
const meth =
  (name: string): OpEmitter =>
  ([recv, ...rest]) =>
    method(recv!, name, rest);

/** Regex ops: the literal pattern is shown as a raw string when possible. */
const regexOp =
  (name: string): OpEmitter =>
  (args, { node }) =>
    call(name, [args[0]!, atom(pyPatternString(litText(node.args[1]))), ...args.slice(2)]);

const reverse = (desc: boolean) => (desc ? [atom('reverse=True')] : []);

/** Emission of every op in the registry (the type makes the table complete). */
export const PY_OPS: Readonly<Record<OpName, OpEmitter>> = {
  'text.from': pure('str'),
  'text.toNumber': helper('_bp_to_number'),
  'text.length': pure('len'),
  'text.lower': meth('lower'),
  'text.upper': meth('upper'),
  'text.contains': ([text, part]) => compare(part!, 'in', text!),
  'text.startsWith': meth('startswith'),
  'text.endsWith': meth('endswith'),
  'text.replace': meth('replace'),
  'text.padNumber': helper('_bp_pad'),
  'text.date': helper('_bp_date'),
  'text.wildcard': pure('_bp_wildcard'),
  'text.regexMatch': regexOp('_bp_regex_match'),
  'text.regexReplace': regexOp('_bp_regex_replace'),

  'list.length': pure('len'),
  'list.get': helper('_bp_get'),
  'list.append': meth('append'),
  'list.contains': ([items, item], { node, typeOf }) => {
    const t = node.args[0] ? typeOf(node.args[0]) : undefined;
    const of = t?.t === 'list' ? t.of.t : undefined;
    // `in` is exact for text/yes-no/paths; numbers and lists need NaN-safe equality.
    if (of === 'text' || of === 'bool' || of === 'path') {
      return compare(item!, 'in', items!);
    }
    return call('_bp_contains', [items!, item!]);
  },
  'list.range': helper('_bp_range'),
  'list.sortBy': ([items], { node }) => {
    const key = litText(node.args[1]);
    const desc = litBool(node.args[2]);
    if (key === 'name' || key === 'ext') {
      return call('sorted', [items!, atom(`key=_bp_by_${key}`), ...reverse(desc)]);
    }
    return call(
      'fs.sort_by',
      [items!, atom(pyString(key)), atom(`descending=${desc ? 'True' : 'False'}`)],
      node.id,
    );
  },
  'list.sort': ([items], { node }) => call('sorted', [items!, ...reverse(litBool(node.args[1]))]),

  'math.floor': helper('_bp_floor'),
  'math.abs': pure('abs'),
  'math.min': pure('min'),
  'math.max': pure('max'),

  'fs.root': fsPure('root'),
  'fs.join': fsOp('join'),
  'fs.parent': fsOp('parent'),
  'fs.name': fsPure('name'),
  'fs.stem': fsPure('stem'),
  'fs.ext': fsPure('ext'),
  'fs.exists': fsOp('exists'),
  'fs.isFolder': fsOp('is_folder'),
  'fs.list': fsOp('list'),
  'fs.walk': fsOp('walk'),
  'fs.size': fsOp('size'),
  'fs.modified': fsOp('modified'),
  'fs.readText': fsOp('read_text'),
  'fs.writeText': fsOp('write_text'),
  'fs.makeFolder': fsOp('make_folder'),
  'fs.rename': fsOp('rename'),
  'fs.move': fsOp('move'),
  'fs.copy': fsOp('copy'),
  'fs.delete': fsOp('delete'),
};

/** Ops whose result is always a new list (no `list(...)` copy needed in `for` loops). */
const FRESH_LIST_OPS: ReadonlySet<OpName> = new Set<OpName>([
  'fs.list',
  'fs.walk',
  'list.range',
  'list.sort',
  'list.sortBy',
]);

const DIVISION: Partial<Record<BinOp, string>> = {
  '/': '_bp_div',
  '//': '_bp_floordiv',
  '%': '_bp_mod',
};

// --------------------------------------------------------------------- emitter

export interface EmitInput {
  /** Desugared, validated (primitive-only) program. */
  program: Program;
  /** Expression types from `typecheck(program, { primitiveOnly: true })`. */
  exprTypes: ReadonlyMap<NodeId, Type>;
  /** Header docstring text (plain; made safe here). */
  header: string;
  /** Labels of the composite blocks of the original program, keyed by block id. */
  composites: ReadonlyMap<NodeId, string>;
}

const INDENT = '    ';
const MAX_COMMENT = 100;

class Emitter {
  readonly lines: string[] = [];
  private depth = 0;

  constructor(private readonly input: EmitInput) {}

  private line(text: string): void {
    this.lines.push(`${INDENT.repeat(this.depth)}${text}`.replace(/\s+$/, ''));
  }

  private blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('');
  }

  private comment(id: NodeId, label: string): void {
    this.line(`# [block ${commentText(id)}] ${truncate(commentText(label), MAX_COMMENT)}`);
  }

  private indented(fn: () => void): void {
    this.depth += 1;
    fn();
    this.depth -= 1;
  }

  // ---------------------------------------------------------------- program

  emitFunction(f: FunctionDef): void {
    this.comment(f.id, describeFunction(f));
    this.line(`def ${f.name}(${f.params.map((p) => p.name).join(', ')}):`);
    this.indented(() => this.block(f.body, true, null));
  }

  emitMain(body: readonly Stmt[]): void {
    this.line('def main(fs):');
    this.indented(() => this.block(body, true, null));
  }

  // ------------------------------------------------------------- statements

  private compositeOf(id: NodeId): NodeId | null {
    return originOf(id, this.input.composites);
  }

  /**
   * Emits a statement list. Top-level statements get a `# [block id]` comment; statements
   * produced by a desugared composite get one comment above the whole expansion.
   */
  private block(stmts: readonly Stmt[], topLevel: boolean, enclosing: NodeId | null): void {
    if (stmts.length === 0) {
      this.line('pass');
      return;
    }
    let current = enclosing;
    stmts.forEach((s, i) => {
      const comp = this.compositeOf(s.id);
      if (comp !== null && comp !== current) {
        if (topLevel && i > 0) this.blank();
        this.comment(comp, this.input.composites.get(comp) ?? '');
      } else if (comp === null && topLevel) {
        if (i > 0) this.blank();
        this.comment(s.id, describeStmt(s));
      }
      current = comp ?? enclosing;
      this.stmt(s, current);
    });
  }

  /** ctx: the composite whose expansion this statement belongs to, if any. */
  private stmt(s: Stmt, ctx: NodeId | null): void {
    switch (s.kind) {
      case 'assign': {
        const hint = s.hint ? `  # position in ${s.hint.indexInto}` : '';
        this.line(`${s.name} = ${this.expr(s.value).text}${hint}`);
        return;
      }
      case 'if':
        this.ifChain(s, 'if', ctx);
        return;
      case 'while':
        this.line(`while ${this.expr(s.cond).text}:`);
        this.indented(() => this.block(s.body, false, ctx));
        return;
      case 'forEach': {
        const list = this.expr(s.list);
        // forEach iterates over a snapshot copy (design.md §5.6); new lists need no copy.
        const fresh =
          s.list.kind === 'list' ||
          (s.list.kind === 'binary' && s.list.op === '+') ||
          (s.list.kind === 'op' && FRESH_LIST_OPS.has(s.list.op));
        this.line(`for ${s.name} in ${fresh ? list.text : `list(${list.text})`}:`);
        this.indented(() => this.block(s.body, false, ctx));
        return;
      }
      case 'return':
        this.line(s.value ? `return ${this.expr(s.value).text}` : 'return');
        return;
      case 'do':
        this.line(this.expr(s.expr).text);
        return;
      case 'print':
        this.line(`print(${this.expr(s.value).text})`);
        return;
      case 'composite':
        throw new Error('emit: composite reached the emitter; desugar first');
    }
  }

  private ifChain(
    s: Extract<Stmt, { kind: 'if' }>,
    keyword: 'if' | 'elif',
    ctx: NodeId | null,
  ): void {
    this.line(`${keyword} ${this.expr(s.cond).text}:`);
    this.indented(() => this.block(s.then, false, ctx));
    if (s.else.length === 0) return;
    const only = s.else[0]!;
    // `else: if …` becomes `elif …` unless the inner `if` starts a composite (needs a comment).
    if (
      s.else.length === 1 &&
      only.kind === 'if' &&
      this.compositeOf(only.id) === this.compositeOf(s.id)
    ) {
      this.ifChain(only, 'elif', ctx);
      return;
    }
    this.line('else:');
    this.indented(() => this.block(s.else, false, ctx));
  }

  // ------------------------------------------------------------ expressions

  private expr(e: Expr): Code {
    switch (e.kind) {
      case 'lit': {
        if (typeof e.value === 'string') return atom(pyString(e.value));
        if (typeof e.value === 'boolean') return atom(e.value ? 'True' : 'False');
        const text = pyNumber(e.value, e.float === true);
        return { text, prec: text.startsWith('-') ? PREC.neg : PREC.atom };
      }
      case 'date':
        return atom(`_bp_epoch(${pyString(e.iso)})`);
      case 'list':
        return atom(`[${e.items.map((x) => this.expr(x).text).join(', ')}]`);
      case 'var':
        return atom(e.name);
      case 'unary': {
        const arg = this.expr(e.arg);
        if (e.op === 'not') return { text: `not ${wrap(arg, PREC.not)}`, prec: PREC.not };
        return { text: `-${wrap(arg, PREC.atom)}`, prec: PREC.neg };
      }
      case 'binary':
        return this.binary(e);
      case 'op':
        return PY_OPS[e.op](
          e.args.map((a) => this.expr(a)),
          { node: e, typeOf: (x) => this.input.exprTypes.get(x.id) },
        );
      case 'call':
        return call(
          e.fn,
          e.args.map((a) => this.expr(a)),
        );
    }
  }

  private binary(e: Extract<Expr, { kind: 'binary' }>): Code {
    const l = this.expr(e.left);
    const r = this.expr(e.right);
    switch (e.op) {
      case 'and':
        return infix(l, 'and', r, PREC.and);
      case 'or':
        return infix(l, 'or', r, PREC.or);
      case '+':
      case '-':
        return infix(l, e.op, r, PREC.add);
      case '*':
        return infix(l, e.op, r, PREC.mul);
      case '/':
      case '//':
      case '%': {
        // A non-zero number literal divisor cannot fail, so plain Python is exact.
        const divisor = e.right.kind === 'unary' && e.right.op === 'neg' ? e.right.arg : e.right;
        if (divisor.kind === 'lit' && typeof divisor.value === 'number' && divisor.value !== 0) {
          return infix(l, e.op, r, PREC.mul);
        }
        return call(DIVISION[e.op]!, [l, r], e.id);
      }
      case '==':
      case '!=': {
        if (this.input.exprTypes.get(e.left.id)?.t === 'list') {
          const eq = call('_bp_eq', [l, r]);
          return e.op === '==' ? eq : { text: `not ${eq.text}`, prec: PREC.not };
        }
        return compare(l, e.op, r);
      }
      case '<':
      case '<=':
      case '>':
      case '>=':
        return compare(l, e.op, r);
    }
  }
}

// -------------------------------------------------------------------- runtime

function section(begin: string, end: string): string {
  const text = RUNTIME_PY.replace(/\r\n/g, '\n');
  const i = text.indexOf(`${begin}\n`);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`runtime.py: missing ${begin} / ${end} markers`);
  return text.slice(i + begin.length + 1, j).replace(/\s+$/, '');
}

/** The runtime's import block and body, as embedded into every script. */
export const RUNTIME_IMPORTS = section('# @bp-imports-begin', '# @bp-imports-end');
export const RUNTIME_BODY = section('# @bp-runtime-begin', '# @bp-runtime-end');

// ---------------------------------------------------------------------- script

/** Emits the complete script: header, imports, program, runtime, entry point. */
export function emitScript(input: EmitInput): string {
  const program = new Emitter(input);
  for (const f of input.program.functions) {
    program.emitFunction(f);
    program.lines.push('', '');
  }
  program.emitMain(input.program.body);

  const out = [
    '#!/usr/bin/env python3',
    `r"""${docstringText(input.header)}`,
    '"""',
    RUNTIME_IMPORTS,
    '',
    '',
    '# ======================= YOUR PROGRAM =======================',
    '',
    '',
    ...program.lines,
    '',
    '',
    '# ============ BEEPBLOCKS RUNTIME (do not edit) ============',
    '',
    RUNTIME_BODY,
    '',
    '',
    'if __name__ == "__main__":',
    '    _bp_entry(main)',
  ];
  return `${out
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')}\n`;
}
