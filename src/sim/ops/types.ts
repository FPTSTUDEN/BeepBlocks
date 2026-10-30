/** Op implementation contract inside the simulator (design.md §4.2). */
import type { Action, Value } from '../../ir/timeline.ts';
import type { SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { SimError, internal } from '../errors.ts';
import type { ListValue, NumValue } from '../pyvalues.ts';
import type { FsFail } from '../../domains/fileExplorer/fs.ts';

export interface OpCtx {
  fs: SandboxFS;
  /** Simulation clock value for this op (design.md §5.3). */
  now: number;
}

export interface OpResult {
  /** null for statement-only ops. */
  value: Value | null;
  /** New FS state (file ops only). */
  fs?: SandboxFS;
  /** Set by every file op. */
  action?: Action;
  /** Paths read; set by every read op (and by `list.sortBy` with a disk key). */
  readPaths?: string[];
}

/** Throws `SimError` (without node id) on runtime errors. Arguments are already typechecked. */
export type OpImpl = (ctx: OpCtx, args: readonly Value[]) => OpResult;

// ----------------------------------------------------------- arg accessors

export function arg(args: readonly Value[], i: number): Value {
  return args[i] ?? internal(`missing argument ${i}`);
}
export function text(args: readonly Value[], i: number): string {
  const v = arg(args, i);
  return v.t === 'text' ? v.v : internal(`argument ${i} should be text, got ${v.t}`);
}
export function bool(args: readonly Value[], i: number): boolean {
  const v = arg(args, i);
  return v.t === 'bool' ? v.v : internal(`argument ${i} should be bool, got ${v.t}`);
}
export function path(args: readonly Value[], i: number): string {
  const v = arg(args, i);
  return v.t === 'path' ? v.v : internal(`argument ${i} should be a path, got ${v.t}`);
}
export function num(args: readonly Value[], i: number): NumValue {
  const v = arg(args, i);
  return v.t === 'int' || v.t === 'float' ? v : internal(`argument ${i} should be a number`);
}
export function list(args: readonly Value[], i: number): ListValue {
  const v = arg(args, i);
  return v.t === 'list' ? v : internal(`argument ${i} should be a list, got ${v.t}`);
}

/** int argument required by `list.get`, `list.range`, `text.padNumber` (design.md §5.6). */
export function intArg(args: readonly Value[], i: number, what: string): number {
  const v = num(args, i);
  if (v.t !== 'int') {
    throw new SimError(
      'INVALID_NUMBER',
      `${what} must be a whole number, but got a decimal number.`,
    );
  }
  return v.v;
}

export const pure =
  (fn: (args: readonly Value[]) => Value | null): OpImpl =>
  (_ctx, args) => ({ value: fn(args) });

/** Unwraps an FS result, raising its error code. */
export function unwrap<T extends { ok: true }>(r: T | FsFail): T {
  if (!r.ok) throw new SimError(r.code, r.message);
  return r;
}
