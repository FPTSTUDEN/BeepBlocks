/**
 * Generator-based tree-walking interpreter over desugared primitive IR (design.md §7.2).
 *
 * Snapshot emission points (each counts as one step):
 *  - 'stmt'   after every assign / do / print statement completes (nodeId = statement);
 *  - 'cond'   after each condition evaluation of `if` and `while` (nodeId = statement);
 *             for `forEach`, once per iteration right after the loop variable is bound, plus
 *             one final 'cond' when the loop ends (also for an empty list), so every loop is
 *             visible when stepping. Compound statements emit no extra 'stmt' snapshot;
 *  - 'fsRead' after every read op, and `list.sortBy` by size/modified (nodeId = op);
 *  - 'fsOp'   after every file op, with `action` (nodeId = op);
 *  - 'call'   after entering a function, with the new frame (nodeId = call expression);
 *  - 'return' at a `return` statement (nodeId = statement) or when a function body ends
 *             (nodeId = function), still showing the callee frame;
 *  - a final 'done' (nodeId '') or 'error' (nodeId = the innermost failing node) snapshot.
 *
 * The step limit counts snapshots; the final 'done'/'error' snapshot is not limited.
 * When the limit is hit, the step that would exceed it raises STEP_LIMIT at its node.
 */
import type {
  CallExpr,
  Expr,
  FunctionDef,
  NodeId,
  OpExpr,
  Program,
  Stmt,
  VarHint,
} from '../ir/types.ts';
import { OPS } from '../ir/ops.ts';
import { isoDateToEpoch, validateProgram } from '../ir/validate.ts';
import type { ValidationError } from '../ir/errors.ts';
import {
  DEFAULT_STEP_LIMIT,
  RECURSION_LIMIT,
  formatAction,
  type Counters,
  type OutputLine,
  type SimulateOptions,
  type Snapshot,
  type SnapshotEvent,
  type Timeline,
  type Value,
} from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { initialClock } from '../domains/fileExplorer/fs.ts';
import { SimError, internal } from './errors.ts';
import {
  arith,
  compare,
  deepCopy,
  negate,
  numberLiteral,
  pyBool,
  pyInt,
  pyList,
  pyText,
} from './pyvalues.ts';
import { SIM_OPS } from './ops/index.ts';

export type SimulateResult =
  { ok: true; timeline: Timeline<SandboxFS> } | { ok: false; errors: ValidationError[] };

type FsSnapshot = Snapshot<SandboxFS>;
type Gen<T> = Generator<FsSnapshot, T, void>;
/** Set when a `return` statement executed. */
type Signal = { value: Value | null } | undefined;

interface RFrame {
  fn: string | null;
  vars: Map<string, Value>;
  hints: Record<string, VarHint>;
}

type Extra = Pick<FsSnapshot, 'action' | 'readPaths' | 'error'>;

/** Runs `fn`, attributing any SimError without a node id to `nodeId` (innermost node). */
function at<T>(nodeId: NodeId, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SimError && e.nodeId === null) e.nodeId = nodeId;
    throw e;
  }
}

class Interpreter {
  readonly output: OutputLine[] = [];
  private fs: SandboxFS;
  private clock: number;
  private index = 0;
  private readonly frames: RFrame[] = [{ fn: null, vars: new Map(), hints: {} }];
  private readonly counters: Counters = { steps: 0, reads: 0, fileOps: 0, comparisons: 0 };
  private readonly fns: Map<string, FunctionDef>;

  constructor(
    private readonly program: Program,
    fs: SandboxFS,
    private readonly stepLimit: number,
  ) {
    this.fs = fs;
    this.clock = initialClock(fs);
    this.fns = new Map(program.functions.map((f) => [f.name, f]));
  }

  *run(): Gen<'done' | 'error'> {
    try {
      yield* this.block(this.program.body);
    } catch (e) {
      if (!(e instanceof SimError)) throw e;
      const nodeId = e.nodeId ?? '';
      yield this.snapshot(nodeId, 'error', {
        error: { code: e.code, nodeId, message: e.message },
      });
      return 'error';
    }
    yield this.snapshot('', 'done');
    return 'done';
  }

  // ------------------------------------------------------------ snapshots

  private get frame(): RFrame {
    return this.frames[this.frames.length - 1]!;
  }

  private snapshot(nodeId: NodeId, event: SnapshotEvent, extra: Extra = {}): FsSnapshot {
    this.counters.steps += 1;
    const inner = this.frame;
    const hints: Record<string, VarHint> = {};
    for (const [name, h] of Object.entries(inner.hints)) {
      if (inner.vars.has(name)) hints[name] = { ...h };
    }
    return {
      index: this.index++,
      nodeId,
      event,
      state: this.fs,
      frames: this.frames.map((f) => ({
        fn: f.fn,
        vars: Object.fromEntries([...f.vars].map(([k, v]) => [k, deepCopy(v)])),
      })),
      hints,
      counters: { ...this.counters },
      output: this.output.length,
      ...extra,
    };
  }

  private *emit(nodeId: NodeId, event: SnapshotEvent, extra: Extra = {}): Gen<void> {
    if (this.index >= this.stepLimit) {
      throw new SimError(
        'STEP_LIMIT',
        `The program took more than ${this.stepLimit} steps, so the simulator stopped it. ` +
          'Is there a loop that never ends?',
        nodeId,
      );
    }
    yield this.snapshot(nodeId, event, extra);
  }

  // ----------------------------------------------------------- statements

  private *block(stmts: readonly Stmt[]): Gen<Signal> {
    for (const s of stmts) {
      const sig = yield* this.stmt(s);
      if (sig) return sig;
    }
    return undefined;
  }

  private *stmt(s: Stmt): Gen<Signal> {
    switch (s.kind) {
      case 'assign': {
        const v = yield* this.eval(s.value);
        this.frame.vars.set(s.name, v);
        if (s.hint) this.frame.hints[s.name] = s.hint;
        yield* this.emit(s.id, 'stmt');
        return undefined;
      }
      case 'if': {
        const c = yield* this.evalBool(s.cond);
        yield* this.emit(s.id, 'cond');
        return yield* this.block(c ? s.then : s.else);
      }
      case 'while':
        for (;;) {
          const c = yield* this.evalBool(s.cond);
          yield* this.emit(s.id, 'cond');
          if (!c) return undefined;
          const sig = yield* this.block(s.body);
          if (sig) return sig;
        }
      case 'forEach': {
        const listValue = yield* this.eval(s.list);
        if (listValue.t !== 'list') return internal('forEach over a non-list');
        const items = [...listValue.v]; // iterate over a snapshot copy (design.md §5.6)
        for (const item of items) {
          this.frame.vars.set(s.name, item);
          yield* this.emit(s.id, 'cond');
          const sig = yield* this.block(s.body);
          if (sig) return sig;
        }
        yield* this.emit(s.id, 'cond');
        return undefined;
      }
      case 'return': {
        const value = s.value ? yield* this.eval(s.value) : null;
        yield* this.emit(s.id, 'return');
        return { value };
      }
      case 'do':
        yield* this.evalMaybe(s.expr);
        yield* this.emit(s.id, 'stmt');
        return undefined;
      case 'print': {
        const v = yield* this.eval(s.value);
        if (v.t !== 'text') return internal('print of non-text');
        for (const line of v.v.split('\n')) this.output.push({ kind: 'print', text: line });
        yield* this.emit(s.id, 'stmt');
        return undefined;
      }
      case 'composite':
        return internal('composite reached the simulator; desugar first');
    }
  }

  // ---------------------------------------------------------- expressions

  private *evalBool(e: Expr): Gen<boolean> {
    const v = yield* this.eval(e);
    return v.t === 'bool' ? v.v : internal('condition is not bool');
  }

  private *eval(e: Expr): Gen<Value> {
    const v = yield* this.evalMaybe(e);
    return v ?? internal(`expression ${e.id} has no value`);
  }

  private *evalMaybe(e: Expr): Gen<Value | null> {
    switch (e.kind) {
      case 'lit': {
        const value = e.value;
        if (typeof value === 'number') return at(e.id, () => numberLiteral(value, e.float));
        return typeof value === 'string' ? pyText(value) : pyBool(value);
      }
      case 'date':
        return pyInt(isoDateToEpoch(e.iso) ?? internal(`bad date ${e.iso}`));
      case 'list': {
        const items: Value[] = [];
        for (const item of e.items) items.push(yield* this.eval(item));
        return pyList(items);
      }
      case 'var':
        return this.frame.vars.get(e.name) ?? internal(`undefined variable ${e.name}`);
      case 'unary': {
        const v = yield* this.eval(e.arg);
        if (e.op === 'not') return pyBool(v.t === 'bool' ? !v.v : internal('not on non-bool'));
        return at(e.id, () => negate(v));
      }
      case 'binary': {
        if (e.op === 'and' || e.op === 'or') {
          const l = yield* this.evalBool(e.left);
          if (e.op === 'and' ? !l : l) return pyBool(l);
          return pyBool(yield* this.evalBool(e.right));
        }
        const l = yield* this.eval(e.left);
        const r = yield* this.eval(e.right);
        const op = e.op;
        switch (op) {
          case '==':
          case '!=':
          case '<':
          case '<=':
          case '>':
          case '>=':
            this.counters.comparisons += 1;
            return pyBool(compare(op, l, r));
          default:
            return at(e.id, () => arith(op, l, r));
        }
      }
      case 'op':
        return yield* this.op(e);
      case 'call':
        return yield* this.call(e);
      case 'compositeExpr':
        throw new Error('Expression composites must be desugared before simulation.');
    }
  }

  private *op(e: OpExpr): Gen<Value | null> {
    const args: Value[] = [];
    for (const a of e.args) args.push(yield* this.eval(a));
    const sig = OPS[e.op];
    const impl = SIM_OPS[e.op];
    const res = at(e.id, () => impl({ fs: this.fs, now: this.clock }, args));
    if (sig.counter === 'fileOp') {
      const action = res.action ?? internal(`${e.op} returned no action`);
      if (res.fs) this.fs = res.fs;
      this.clock += 1;
      this.counters.fileOps += 1;
      this.output.push({ kind: 'action', text: formatAction(action) });
      yield* this.emit(e.id, 'fsOp', { action });
    } else if (res.readPaths) {
      this.counters.reads += 1;
      yield* this.emit(e.id, 'fsRead', { readPaths: res.readPaths });
    }
    return res.value;
  }

  private *call(e: CallExpr): Gen<Value | null> {
    const f = this.fns.get(e.fn) ?? internal(`unknown function ${e.fn}`);
    const args: Value[] = [];
    for (const a of e.args) args.push(yield* this.eval(a));
    if (this.frames.length - 1 >= RECURSION_LIMIT) {
      throw new SimError(
        'RECURSION_LIMIT',
        `"${f.name}" called functions more than ${RECURSION_LIMIT} levels deep, so the simulator stopped.`,
        e.id,
      );
    }
    this.frames.push({
      fn: f.name,
      vars: new Map(f.params.map((p, i) => [p.name, args[i] ?? internal('missing argument')])),
      hints: {},
    });
    yield* this.emit(e.id, 'call');
    const sig = yield* this.block(f.body);
    if (!sig) yield* this.emit(f.id, 'return');
    this.frames.pop();
    return sig ? sig.value : null;
  }
}

// ================================================================== Public

/**
 * Lazily executes an already-validated primitive program, yielding snapshots one by one.
 * The generator's return value is the outcome; `output` fills in as the run proceeds.
 */
export function execute(
  program: Program,
  fs: SandboxFS,
  options: SimulateOptions,
): { snapshots: Gen<'done' | 'error'>; output: OutputLine[] } {
  const interp = new Interpreter(program, fs, options.stepLimit);
  return { snapshots: interp.run(), output: interp.output };
}

/** Runs an already-validated primitive program to completion. */
export function runTimeline(
  program: Program,
  fs: SandboxFS,
  options: SimulateOptions,
): Timeline<SandboxFS> {
  const { snapshots: gen, output } = execute(program, fs, options);
  const snapshots: FsSnapshot[] = [];
  for (;;) {
    const r = gen.next();
    if (r.done) return { snapshots, output, outcome: r.value };
    snapshots.push(r.value);
  }
}

/** Validates (primitive-only) and runs. Validation errors are returned instead of running. */
export function simulateProgram(
  program: Program,
  fs: SandboxFS,
  options: Partial<SimulateOptions> = {},
): SimulateResult {
  const errors = validateProgram(program, { primitiveOnly: true }).filter(
    (e) => e.severity === 'error',
  );
  if (errors.length > 0) return { ok: false, errors };
  const stepLimit = options.stepLimit ?? DEFAULT_STEP_LIMIT;
  return { ok: true, timeline: runTimeline(program, fs, { stepLimit }) };
}
