/**
 * IR validator and typechecker (design.md §4.3, Req 1.7, 3.4).
 *
 * `validateProgram` never throws, even on malformed JSON-shaped input. It runs in two phases:
 *   1. structure — node shapes, known kinds, unique ids (stops here if anything is wrong)
 *   2. semantics — names, scopes, definite assignment, types, literals, composite schemas
 *
 * `typecheck` additionally returns the inferred type of every expression node, which the
 * exporter and editor may use.
 */
import type {
  Expr,
  FunctionDef,
  NodeId,
  Program,
  Stmt,
  Type,
} from './types.ts';
import { ARITH_OPS, COMPARE_OPS, typeEquals, typeToPlain } from './types.ts';
import type { ValidationCode, ValidationError } from './errors.ts';
import { OPS, isOpName, type SigType } from './ops.ts';
import {
  COMPOSITE_NAMES,
  COMPOSITE_SCHEMAS,
  getBind,
  type CompositeSchema,
  type CompositeStmt,
  type FieldSchema,
} from './composites.ts';
import { checkRegex, checkRegexReplacement, checkTemplate, checkWildcard } from './syntax.ts';
import { RUN_BLOCK_ID } from './ids.ts';

// ===================================================================== Names

const PY_KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield',
];
/**
 * Builtins the exporter emits, plus module-level names of the exported script that don't
 * start with "_bp" (those are reserved by prefix). Kept in sync with runtime.py by
 * src/export/reserved.test.ts.
 */
const RESERVED = [
  'print', 'len', 'str', 'int', 'float', 'range', 'sorted', 'min', 'max', 'abs', 'list',
  'bool', 'isinstance', 'fs', 'main', 're', 'shutil', 'sys', 'os', 'argparse', 'Path',
  'datetime', 'timezone', 'math', '_RealFS', '_PlanFS',
];
const RESERVED_SET = new Set([...PY_KEYWORDS, ...RESERVED]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Returns a plain-language problem with `name` as a variable/function name, or null if valid. */
export function checkIdentifier(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return 'A name is required.';
  if (name.length > 60) return 'Names can be at most 60 characters.';
  if (!IDENT.test(name)) {
    return `"${name}" can only use letters, digits and _, and cannot start with a digit.`;
  }
  if (/^_bp/i.test(name)) return `Names starting with "_bp" are reserved.`;
  if (RESERVED_SET.has(name)) return `"${name}" is a reserved word; please choose another name.`;
  return null;
}

// ================================================================ Utilities

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses 'YYYY-MM-DD' to epoch seconds at UTC midnight, or null if invalid. */
export function isoDateToEpoch(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  if (y < 1970 || y > 9999) return null;
  return ms / 1000;
}

function isValidType(t: unknown): t is Type {
  if (!isObj(t)) return false;
  if (t.t === 'list') return isValidType(t.of);
  return t.t === 'number' || t.t === 'text' || t.t === 'bool' || t.t === 'path';
}

class Reporter {
  readonly issues: ValidationError[] = [];
  error(nodeId: NodeId, code: ValidationCode, message: string) {
    this.issues.push({ nodeId, code, message, severity: 'error' });
  }
  warn(nodeId: NodeId, code: ValidationCode, message: string) {
    this.issues.push({ nodeId, code, message, severity: 'warning' });
  }
  get hasErrors() {
    return this.issues.some((i) => i.severity === 'error');
  }
}

// ================================================================ Structure

const STMT_KINDS = ['assign', 'if', 'while', 'forEach', 'return', 'do', 'print', 'composite'];
const EXPR_KINDS = ['lit', 'date', 'list', 'var', 'binary', 'unary', 'op', 'call'];
const BIN_OPS = [...ARITH_OPS, ...COMPARE_OPS, 'and', 'or'];

function checkStructure(p: unknown, r: Reporter, primitiveOnly: boolean, allowHoles = false): void {
  const ids = new Set<string>();
  const nodeId = (n: Record<string, unknown>, where: string): string | null => {
    if (typeof n.id !== 'string' || n.id.length === 0) {
      r.error('', 'STRUCTURE', `A ${where} is missing its id.`);
      return null;
    }
    if (ids.has(n.id)) r.error(n.id, 'DUPLICATE_ID', `Two blocks share the id "${n.id}".`);
    if (n.id === RUN_BLOCK_ID) {
      r.error(n.id, 'DUPLICATE_ID', `The id "${RUN_BLOCK_ID}" is reserved for the "when run" block.`);
    }
    ids.add(n.id);
    return n.id;
  };
  const stmtList = (v: unknown, owner: string, what: string) => {
    if (!Array.isArray(v)) {
      r.error(owner, 'STRUCTURE', `Expected a list of statements for ${what}.`);
      return;
    }
    v.forEach(stmt);
  };
  const expr = (v: unknown, owner: string, what: string): void => {
    if (v === null && allowHoles) return;
    if (!isObj(v) || typeof v.kind !== 'string' || !EXPR_KINDS.includes(v.kind)) {
      r.error(owner, 'STRUCTURE', `Expected a value for ${what}.`);
      return;
    }
    const id = nodeId(v, 'value block') ?? owner;
    switch (v.kind) {
      case 'lit':
        if (!['number', 'string', 'boolean'].includes(typeof v.value)) {
          r.error(id, 'STRUCTURE', 'A literal must be a number, text or yes/no value.');
        }
        break;
      case 'date':
        if (typeof v.iso !== 'string') r.error(id, 'STRUCTURE', 'A date block needs a date.');
        break;
      case 'list':
        if (!isValidType(v.itemType)) r.error(id, 'STRUCTURE', 'A list needs an item type.');
        if (!Array.isArray(v.items)) r.error(id, 'STRUCTURE', 'A list needs items.');
        else v.items.forEach((it, i) => expr(it, id, `item ${i}`));
        break;
      case 'var':
        if (typeof v.name !== 'string') r.error(id, 'STRUCTURE', 'A variable block needs a name.');
        break;
      case 'binary':
        if (typeof v.op !== 'string' || !BIN_OPS.includes(v.op)) {
          r.error(id, 'STRUCTURE', `Unknown operator "${String(v.op)}".`);
        }
        expr(v.left, id, 'the left side');
        expr(v.right, id, 'the right side');
        break;
      case 'unary':
        if (v.op !== 'not' && v.op !== 'neg') {
          r.error(id, 'STRUCTURE', `Unknown operator "${String(v.op)}".`);
        }
        expr(v.arg, id, 'the operand');
        break;
      case 'op':
        if (typeof v.op !== 'string' || !isOpName(v.op)) {
          r.error(id, 'UNKNOWN_OP', `Unknown operation "${String(v.op)}".`);
        }
        if (!Array.isArray(v.args)) r.error(id, 'STRUCTURE', 'An operation needs arguments.');
        else v.args.forEach((x, i) => expr(x, id, `argument ${i + 1}`));
        break;
      case 'call':
        if (typeof v.fn !== 'string') r.error(id, 'STRUCTURE', 'A call needs a function name.');
        if (!Array.isArray(v.args)) r.error(id, 'STRUCTURE', 'A call needs arguments.');
        else v.args.forEach((x, i) => expr(x, id, `argument ${i + 1}`));
        break;
    }
  };
  const stmt = (v: unknown): void => {
    if (!isObj(v) || typeof v.kind !== 'string' || !STMT_KINDS.includes(v.kind)) {
      r.error('', 'STRUCTURE', 'Found something that is not a statement block.');
      return;
    }
    const id = nodeId(v, 'statement block') ?? '';
    switch (v.kind) {
      case 'assign':
        if (typeof v.name !== 'string') r.error(id, 'STRUCTURE', 'Missing variable name.');
        expr(v.value, id, 'the new value');
        if (v.hint !== undefined && !(isObj(v.hint) && typeof v.hint.indexInto === 'string')) {
          r.error(id, 'STRUCTURE', 'Invalid visualization hint.');
        }
        break;
      case 'if':
        expr(v.cond, id, 'the condition');
        stmtList(v.then, id, '"then"');
        stmtList(v.else, id, '"else"');
        break;
      case 'while':
        expr(v.cond, id, 'the condition');
        stmtList(v.body, id, 'the loop body');
        break;
      case 'forEach':
        if (typeof v.name !== 'string') r.error(id, 'STRUCTURE', 'Missing loop variable name.');
        expr(v.list, id, 'the list');
        stmtList(v.body, id, 'the loop body');
        break;
      case 'return':
        if (v.value !== null) expr(v.value, id, 'the returned value');
        break;
      case 'do':
        if (!isObj(v.expr) || (v.expr.kind !== 'op' && v.expr.kind !== 'call')) {
          r.error(id, 'STRUCTURE', 'Only operations and function calls can be used as steps.');
        } else expr(v.expr, id, 'the step');
        break;
      case 'print':
        expr(v.value, id, 'the text to show');
        break;
      case 'composite': {
        if (primitiveOnly) {
          r.error(id, 'STRUCTURE', 'Task blocks must be desugared before running or exporting.');
        }
        if (typeof v.name !== 'string' || !(COMPOSITE_NAMES as readonly string[]).includes(v.name)) {
          r.error(id, 'UNKNOWN_COMPOSITE', `Unknown task block "${String(v.name)}".`);
        }
        for (const key of ['fields', 'inputs', 'bodies', 'binds'] as const) {
          if (!isObj(v[key])) r.error(id, 'STRUCTURE', `Task block is missing "${key}".`);
        }
        if (isObj(v.inputs)) {
          for (const [k, e] of Object.entries(v.inputs)) expr(e, id, `input "${k}"`);
        }
        if (isObj(v.bodies)) {
          for (const [k, b] of Object.entries(v.bodies)) stmtList(b, id, `slot "${k}"`);
        }
        break;
      }
    }
  };

  if (!isObj(p) || !Array.isArray(p.functions) || !Array.isArray(p.body)) {
    r.error('', 'STRUCTURE', 'A program needs "functions" and "body" lists.');
    return;
  }
  for (const f of p.functions) {
    if (!isObj(f) || f.kind !== 'function') {
      r.error('', 'STRUCTURE', 'Found something that is not a function definition.');
      continue;
    }
    const id = nodeId(f, 'function') ?? '';
    if (typeof f.name !== 'string') r.error(id, 'STRUCTURE', 'A function needs a name.');
    if (
      !Array.isArray(f.params) ||
      !f.params.every((x) => isObj(x) && typeof x.name === 'string' && isValidType(x.type))
    ) {
      r.error(id, 'STRUCTURE', 'Function parameters need a name and a type.');
    }
    if (f.returns !== null && !isValidType(f.returns)) {
      r.error(id, 'STRUCTURE', 'Invalid function return type.');
    }
    stmtList(f.body, id, 'the function body');
  }
  stmtList(p.body, '', 'the program');
}

// ================================================================ Typecheck

interface Scope {
  fn: FunctionDef | null;
  /** Fixed type of each variable name in this scope (first assignment wins). */
  types: Map<string, Type>;
}

export interface TypecheckResult {
  issues: ValidationError[];
  /** Inferred type of every expression node that typechecked. */
  exprTypes: Map<NodeId, Type>;
  /** Variable types per scope: key null = program scope, otherwise function name. */
  varTypes: Map<string | null, Map<string, Type>>;
}

/** Thrown inside expression checking to abort the current expression after reporting. */
class Bail {}

function sigMatch(
  sig: SigType,
  actual: Type,
  binding: { t?: Type },
): boolean {
  switch (sig.t) {
    case 'T': {
      if (sig.constraint === 'scalar' && actual.t === 'list') return false;
      if (sig.constraint === 'orderable' && actual.t !== 'number' && actual.t !== 'text') return false;
      if (!binding.t) {
        binding.t = actual;
        return true;
      }
      return typeEquals(binding.t, actual);
    }
    case 'list':
      return actual.t === 'list' && sigMatch(sig.of, actual.of, binding);
    default:
      return sig.t === actual.t;
  }
}

function sigResolve(sig: SigType, binding: { t?: Type }): Type | null {
  switch (sig.t) {
    case 'T':
      return binding.t ?? null;
    case 'list': {
      const of = sigResolve(sig.of, binding);
      return of ? { t: 'list', of } : null;
    }
    default:
      return { t: sig.t };
  }
}

function sigToPlain(sig: SigType): string {
  switch (sig.t) {
    case 'T':
      return sig.constraint === 'orderable'
        ? 'a number or text'
        : sig.constraint === 'scalar'
          ? 'a number, text, yes/no value or file'
          : 'a value';
    case 'list':
      return sig.of.t === 'T' ? 'a list' : `a list of ${sigToPlain(sig.of)}`;
    default:
      return typeToPlain({ t: sig.t } as Type);
  }
}

function alwaysReturns(stmts: Stmt[]): boolean {
  for (const s of stmts) {
    if (s.kind === 'return') return true;
    if (s.kind === 'if' && alwaysReturns(s.then) && alwaysReturns(s.else)) return true;
  }
  return false;
}

class Checker {
  readonly exprTypes = new Map<NodeId, Type>();
  readonly varTypes = new Map<string | null, Map<string, Type>>();
  private readonly fns = new Map<string, FunctionDef>();

  constructor(
    private readonly program: Program,
    private readonly r: Reporter,
  ) {}

  run(): void {
    // Function signatures.
    for (const f of this.program.functions) {
      const problem = checkIdentifier(f.name);
      if (problem) this.r.error(f.id, 'BAD_NAME', problem);
      if (this.fns.has(f.name)) {
        this.r.error(f.id, 'DUPLICATE_NAME', `There are two functions named "${f.name}".`);
      }
      this.fns.set(f.name, f);
      const seen = new Set<string>();
      for (const p of f.params) {
        const pp = checkIdentifier(p.name);
        if (pp) this.r.error(f.id, 'BAD_NAME', pp);
        if (seen.has(p.name)) {
          this.r.error(f.id, 'DUPLICATE_NAME', `"${f.name}" has two inputs named "${p.name}".`);
        }
        seen.add(p.name);
      }
    }
    // Bodies.
    for (const f of this.program.functions) {
      const scope: Scope = { fn: f, types: new Map(f.params.map((p) => [p.name, p.type])) };
      this.varTypes.set(f.name, scope.types);
      this.block(f.body, scope, new Set(f.params.map((p) => p.name)));
      if (f.returns !== null && !alwaysReturns(f.body)) {
        this.r.error(
          f.id,
          'MISSING_RETURN',
          `"${f.name}" must give back ${typeToPlain(f.returns)} on every path; add a "return" at the end.`,
        );
      }
    }
    const top: Scope = { fn: null, types: new Map() };
    this.varTypes.set(null, top.types);
    this.block(this.program.body, top, new Set());
  }

  // ---------------------------------------------------------------- stmts

  /** Checks a statement list; returns the set of definitely-assigned names afterwards. */
  private block(stmts: Stmt[], scope: Scope, defined: Set<string>): Set<string> {
    let cur = new Set(defined);
    for (const s of stmts) cur = this.stmt(s, scope, cur);
    return cur;
  }

  private declare(scope: Scope, name: string, type: Type, nodeId: NodeId): void {
    const problem = checkIdentifier(name);
    if (problem) {
      this.r.error(nodeId, 'BAD_NAME', problem);
      return;
    }
    if (this.fns.has(name)) {
      this.r.error(nodeId, 'DUPLICATE_NAME', `"${name}" is already the name of a function.`);
      return;
    }
    const existing = scope.types.get(name);
    if (!existing) scope.types.set(name, type);
    else if (!typeEquals(existing, type)) {
      this.r.error(
        nodeId,
        'VARIABLE_RETYPED',
        `"${name}" already holds ${typeToPlain(existing)}, so it can't also hold ${typeToPlain(type)}. Use a different variable.`,
      );
    }
  }

  private stmt(s: Stmt, scope: Scope, defined: Set<string>): Set<string> {
    const out = new Set(defined);
    switch (s.kind) {
      case 'assign': {
        const t = this.exprSafe(s.value, scope, defined);
        if (t) this.declare(scope, s.name, t, s.id);
        if (s.hint) {
          const listT = scope.types.get(s.hint.indexInto);
          if (t && t.t !== 'number') {
            this.r.error(s.id, 'STRUCTURE', 'Only number variables can be shown as positions.');
          } else if (listT && listT.t !== 'list') {
            this.r.error(s.id, 'STRUCTURE', `"${s.hint.indexInto}" is not a list.`);
          }
        }
        out.add(s.name);
        return out;
      }
      case 'if': {
        this.cond(s.cond, scope, defined, s.id, '"if"');
        const a = this.block(s.then, scope, defined);
        const b = this.block(s.else, scope, defined);
        return new Set([...a].filter((n) => b.has(n)));
      }
      case 'while':
        this.cond(s.cond, scope, defined, s.id, '"repeat while"');
        this.block(s.body, scope, defined);
        return out;
      case 'forEach': {
        const t = this.exprSafe(s.list, scope, defined);
        if (t && t.t !== 'list') {
          this.r.error(s.id, 'TYPE_MISMATCH', `"for each" needs a list, but got ${typeToPlain(t)}.`);
        } else if (t && t.t === 'list') {
          this.declare(scope, s.name, t.of, s.id);
        }
        const inner = new Set(defined);
        inner.add(s.name);
        this.block(s.body, scope, inner);
        return out;
      }
      case 'return': {
        if (!scope.fn) {
          this.r.error(s.id, 'RETURN_OUTSIDE_FUNCTION', '"return" can only be used inside a function.');
          return out;
        }
        const want = scope.fn.returns;
        if (want === null) {
          if (s.value !== null) {
            this.r.error(s.id, 'BAD_RETURN', `"${scope.fn.name}" doesn't give back a value.`);
            this.exprSafe(s.value, scope, defined);
          }
        } else if (s.value === null) {
          this.r.error(s.id, 'BAD_RETURN', `"${scope.fn.name}" must give back ${typeToPlain(want)}.`);
        } else {
          const t = this.exprSafe(s.value, scope, defined);
          if (t && !typeEquals(t, want)) {
            this.r.error(
              s.id,
              'TYPE_MISMATCH',
              `"${scope.fn.name}" should give back ${typeToPlain(want)}, but this is ${typeToPlain(t)}.`,
            );
          }
        }
        return out;
      }
      case 'do':
        this.exprSafe(s.expr, scope, defined, { statement: true });
        return out;
      case 'print': {
        const t = this.exprSafe(s.value, scope, defined);
        if (t && t.t !== 'text') {
          this.r.error(
            s.id,
            'TYPE_MISMATCH',
            `"show" needs text, but got ${typeToPlain(t)}. Use "as text" to convert it.`,
          );
        }
        return out;
      }
      case 'composite':
        this.composite(s, scope, defined);
        return out;
    }
  }

  private cond(e: Expr, scope: Scope, defined: Set<string>, nodeId: NodeId, what: string): void {
    const t = this.exprSafe(e, scope, defined);
    if (t && t.t !== 'bool') {
      this.r.error(nodeId, 'TYPE_MISMATCH', `This ${what} needs a yes/no condition, but got ${typeToPlain(t)}.`);
    }
  }

  // ----------------------------------------------------------- composites

  private composite(s: CompositeStmt, scope: Scope, defined: Set<string>): void {
    const schema: CompositeSchema | undefined = COMPOSITE_SCHEMAS[s.name];
    if (!schema) return;

    // Fields.
    const known = new Set(schema.fields.map((f) => f.key));
    for (const key of Object.keys(s.fields)) {
      if (!known.has(key)) this.r.error(s.id, 'BAD_FIELD', `Unknown setting "${key}".`);
    }
    for (const f of schema.fields) this.field(s, f);

    // Cross-field requirements.
    for (const req of schema.requires ?? []) {
      const v = s.fields[req.when.field] ?? schema.fields.find((f) => f.key === req.when.field)?.default;
      if (!req.when.equals.includes(v ?? null)) continue;
      for (const need of req.need) {
        const isInput = schema.inputs.some((i) => i.key === need);
        const present = isInput ? s.inputs[need] !== undefined : (s.fields[need] ?? null) !== null;
        if (!present) {
          const label =
            schema.inputs.find((i) => i.key === need)?.label ??
            schema.fields.find((f) => f.key === need)?.label ??
            need;
          this.r.error(s.id, 'MISSING_INPUT', `"${String(v)}" needs "${label}" to be filled in.`);
        }
      }
    }

    // Binds: fixed type in scope, defined only where visible.
    const bindNames = new Map<string, string>();
    for (const b of schema.binds) {
      const name = getBind(s, b.key);
      this.declare(scope, name, b.type, s.id);
      bindNames.set(b.key, name);
    }
    for (const key of Object.keys(s.binds)) {
      if (!schema.binds.some((b) => b.key === key)) {
        this.r.error(s.id, 'BAD_FIELD', `Unknown variable slot "${key}".`);
      }
    }
    const visibleIn = (slot: string): Set<string> => {
      const d = new Set(defined);
      for (const b of schema.binds) if (b.visibleIn.includes(slot)) d.add(bindNames.get(b.key)!);
      return d;
    };

    // Inputs.
    for (const key of Object.keys(s.inputs)) {
      if (!schema.inputs.some((i) => i.key === key)) {
        this.r.error(s.id, 'BAD_FIELD', `Unknown input "${key}".`);
      }
    }
    for (const inp of schema.inputs) {
      const e = s.inputs[inp.key];
      if (!e) {
        if (!inp.optional) {
          this.r.error(s.id, 'MISSING_INPUT', `Please fill in "${inp.label}".`);
        }
        continue;
      }
      const t = this.exprSafe(e, scope, visibleIn(inp.key));
      if (t && !typeEquals(t, inp.type)) {
        this.r.error(
          e.id,
          'TYPE_MISMATCH',
          `"${inp.label}" needs ${typeToPlain(inp.type)}, but got ${typeToPlain(t)}.`,
        );
      }
    }

    // Bodies.
    for (const key of Object.keys(s.bodies)) {
      if (!schema.bodies.some((b) => b.key === key)) {
        this.r.error(s.id, 'BAD_FIELD', `Unknown slot "${key}".`);
      }
    }
    for (const b of schema.bodies) this.block(s.bodies[b.key] ?? [], scope, visibleIn(b.key));
  }

  private field(s: CompositeStmt, f: FieldSchema): void {
    const v = f.key in s.fields ? s.fields[f.key] : f.default;
    const bad = (msg: string) => this.r.error(s.id, 'BAD_FIELD', `"${f.label}": ${msg}`);
    if (v === null || v === undefined) {
      if (!f.optional) bad('this setting is required.');
      return;
    }
    switch (f.kind) {
      case 'text': {
        if (typeof v !== 'string') return bad('expected text.');
        const problem =
          f.syntax === 'wildcard'
            ? checkWildcard(v)
            : f.syntax === 'template'
              ? checkTemplate(v)
              : f.syntax === 'extension'
                ? /^\.?[A-Za-z0-9_-]+$/.test(v)
                  ? null
                  : 'use just the extension, like "jpg".'
                : null;
        if (problem) {
          this.r.error(s.id, f.syntax === 'template' ? 'BAD_TEMPLATE' : 'BAD_PATTERN', `"${f.label}": ${problem}`);
        }
        return;
      }
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) return bad('expected a number.');
        if (!Number.isSafeInteger(v)) return bad('expected a whole number.');
        if (f.min !== undefined && v < f.min) return bad(`must be at least ${f.min}.`);
        return;
      case 'bool':
        if (typeof v !== 'boolean') bad('expected yes or no.');
        return;
      case 'enum':
        if (typeof v !== 'string' || !f.options?.includes(v)) {
          bad(`must be one of ${(f.options ?? []).join(', ')}.`);
        }
        return;
      case 'date':
        if (isoDateToEpoch(v) === null) bad('expected a date like 2026-01-31.');
        return;
    }
  }

  // ---------------------------------------------------------------- exprs

  private exprSafe(
    e: Expr,
    scope: Scope,
    defined: Set<string>,
    opts: { statement?: boolean } = {},
  ): Type | null {
    try {
      return this.expr(e, scope, defined, opts.statement === true);
    } catch (err) {
      if (err instanceof Bail) return null;
      throw err;
    }
  }

  private fail(nodeId: NodeId, code: ValidationCode, message: string): never {
    this.r.error(nodeId, code, message);
    throw new Bail();
  }

  private expr(e: Expr, scope: Scope, defined: Set<string>, statement = false): Type {
    const t = this.exprInner(e, scope, defined, statement);
    this.exprTypes.set(e.id, t);
    return t;
  }

  /** Typechecks `e`; `null` result type is only permitted when `statement` is true. */
  private exprInner(e: Expr, scope: Scope, defined: Set<string>, statement: boolean): Type {
    const sub = (x: Expr) => this.expr(x, scope, defined);
    switch (e.kind) {
      case 'lit': {
        if (typeof e.value === 'number') {
          if (!Number.isFinite(e.value)) this.fail(e.id, 'BAD_LITERAL', 'Numbers must be finite.');
          if (Number.isInteger(e.value) && !e.float && !Number.isSafeInteger(e.value)) {
            this.fail(e.id, 'LARGE_INT', 'This whole number is too large (max 9007199254740991).');
          }
          return { t: 'number' };
        }
        return typeof e.value === 'string' ? { t: 'text' } : { t: 'bool' };
      }
      case 'date':
        if (isoDateToEpoch(e.iso) === null) {
          this.fail(e.id, 'BAD_LITERAL', `"${e.iso}" is not a valid date (use YYYY-MM-DD, 1970 or later).`);
        }
        return { t: 'number' };
      case 'list': {
        for (const item of e.items) {
          const it = sub(item);
          if (!typeEquals(it, e.itemType)) {
            this.fail(
              item.id,
              'TYPE_MISMATCH',
              `This list holds ${typeToPlain(e.itemType).replace(/^an? /, '')} items, but this item is ${typeToPlain(it)}.`,
            );
          }
        }
        return { t: 'list', of: e.itemType };
      }
      case 'var': {
        const t = scope.types.get(e.name);
        if (!t || !defined.has(e.name)) {
          const where = scope.fn ? ` Functions can only use their own inputs and variables.` : '';
          this.fail(
            e.id,
            'UNDEFINED_VARIABLE',
            t
              ? `"${e.name}" might not have a value yet here. Give it a value before this block on every path.`
              : `There is no variable "${e.name}" here.${where}`,
          );
        }
        return t;
      }
      case 'unary': {
        const t = sub(e.arg);
        if (e.op === 'not') {
          if (t.t !== 'bool') this.fail(e.id, 'TYPE_MISMATCH', `"not" needs a yes/no value, but got ${typeToPlain(t)}.`);
          return { t: 'bool' };
        }
        if (t.t !== 'number') this.fail(e.id, 'TYPE_MISMATCH', `"-" needs a number, but got ${typeToPlain(t)}.`);
        return { t: 'number' };
      }
      case 'binary': {
        const l = sub(e.left);
        const r = sub(e.right);
        const mismatch = (need: string): never =>
          this.fail(
            e.id,
            'TYPE_MISMATCH',
            `"${e.op}" needs ${need}, but got ${typeToPlain(l)} and ${typeToPlain(r)}.`,
          );
        if (e.op === 'and' || e.op === 'or') {
          if (l.t !== 'bool' || r.t !== 'bool') mismatch('two yes/no values');
          return { t: 'bool' };
        }
        if (e.op === '==' || e.op === '!=') {
          if (!typeEquals(l, r)) mismatch('two values of the same kind');
          return { t: 'bool' };
        }
        if (e.op === '<' || e.op === '<=' || e.op === '>' || e.op === '>=') {
          const ok = (l.t === 'number' && r.t === 'number') || (l.t === 'text' && r.t === 'text');
          if (!ok) mismatch('two numbers or two texts');
          return { t: 'bool' };
        }
        if (e.op === '+') {
          if (l.t === 'number' && r.t === 'number') return l;
          if (l.t === 'text' && r.t === 'text') return l;
          if (l.t === 'list' && typeEquals(l, r)) return l;
          if ((l.t === 'text') !== (r.t === 'text')) {
            mismatch('two numbers, two texts or two lists (use "as text" to join a number to text)');
          }
          mismatch('two numbers, two texts or two lists of the same kind');
        }
        if (l.t !== 'number' || r.t !== 'number') mismatch('two numbers');
        return { t: 'number' };
      }
      case 'op': {
        const sig = OPS[e.op];
        if (e.args.length !== sig.args.length) {
          this.fail(e.id, 'ARITY', `"${e.op}" needs ${sig.args.length} input(s), but got ${e.args.length}.`);
        }
        const binding: { t?: Type } = {};
        sig.args.forEach((arg, i) => {
          const x = e.args[i]!;
          const t = sub(x);
          if (!sigMatch(arg.type, t, binding)) {
            this.fail(
              x.id,
              'TYPE_MISMATCH',
              `"${arg.name}" needs ${binding.t && arg.type.t === 'T' ? typeToPlain(binding.t) : sigToPlain(arg.type)}, but got ${typeToPlain(t)}.`,
            );
          }
          if (arg.literal) {
            if (x.kind !== 'lit') this.fail(x.id, 'NOT_LITERAL', `"${arg.name}" must be typed in directly, not computed.`);
            if (arg.oneOf && !arg.oneOf.includes(String(x.value))) {
              this.fail(x.id, 'BAD_LITERAL', `"${arg.name}" must be one of: ${arg.oneOf.join(', ')}.`);
            }
          }
        });
        if (e.op === 'text.regexMatch' || e.op === 'text.regexReplace') {
          const pattern = e.args[1];
          if (pattern?.kind === 'lit' && typeof pattern.value === 'string') {
            const res = checkRegex(pattern.value);
            if (res.error) this.fail(pattern.id, 'BAD_PATTERN', res.error);
            const repl = e.args[2];
            if (e.op === 'text.regexReplace' && repl?.kind === 'lit' && typeof repl.value === 'string') {
              const problem = checkRegexReplacement(repl.value, res.groups);
              if (problem) this.fail(repl.id, 'BAD_PATTERN', problem);
            }
          }
        }
        if (sig.returns === null) {
          if (!statement) {
            this.fail(e.id, 'STATEMENT_ONLY', `"${sig.label.replace(/\{\d\}/g, '…')}" is a step, not a value.`);
          }
          return { t: 'bool' }; // placeholder; statement results are discarded
        }
        const rt = sigResolve(sig.returns, binding);
        if (!rt) this.fail(e.id, 'TYPE_MISMATCH', 'Could not work out the result type (is the list empty?).');
        return rt;
      }
      case 'call': {
        const f = this.fns.get(e.fn);
        if (!f) this.fail(e.id, 'UNKNOWN_FUNCTION', `There is no function named "${e.fn}".`);
        if (e.args.length !== f.params.length) {
          this.fail(e.id, 'ARITY', `"${f.name}" needs ${f.params.length} input(s), but got ${e.args.length}.`);
        }
        f.params.forEach((p, i) => {
          const x = e.args[i]!;
          const t = sub(x);
          if (!typeEquals(t, p.type)) {
            this.fail(
              x.id,
              'TYPE_MISMATCH',
              `"${p.name}" of "${f.name}" needs ${typeToPlain(p.type)}, but got ${typeToPlain(t)}.`,
            );
          }
        });
        if (f.returns === null) {
          if (!statement) this.fail(e.id, 'STATEMENT_ONLY', `"${f.name}" doesn't give back a value.`);
          return { t: 'bool' };
        }
        return f.returns;
      }
    }
  }
}

// ================================================================== Public

export interface ValidateOptions {
  /** Reject composites (for desugared programs given to the simulator and exporter). */
  primitiveOnly?: boolean;
}

export function typecheck(program: Program, opts: ValidateOptions = {}): TypecheckResult {
  const r = new Reporter();
  checkStructure(program, r, opts.primitiveOnly === true);
  if (r.hasErrors) return { issues: r.issues, exprTypes: new Map(), varTypes: new Map() };
  const c = new Checker(program, r);
  c.run();
  return { issues: r.issues, exprTypes: c.exprTypes, varTypes: c.varTypes };
}

/** Validates a program. Returns errors and warnings (empty = valid). Never throws. */
export function validateProgram(program: Program, opts: ValidateOptions = {}): ValidationError[] {
  return typecheck(program, opts).issues;
}

/**
 * Structure-only check for programs that are still being edited (saved projects): the same
 * shape rules as `validateProgram`'s first phase, except that empty sockets (`null` where a
 * value belongs, as produced by the editor) are allowed. Never throws.
 */
export function validateStructure(program: unknown): ValidationError[] {
  const r = new Reporter();
  checkStructure(program, r, false, true);
  return r.issues;
}

export function hasErrors(issues: ValidationError[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
