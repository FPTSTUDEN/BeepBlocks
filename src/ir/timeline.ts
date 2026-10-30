/**
 * Runtime contract — values, snapshots, timelines, worker protocol (design.md §5.1, §7.2–§7.4).
 *
 * Lives in ir/ (not sim/) so playground/ and export/ can depend on it without importing sim/.
 * Generic over the domain state `S` (file explorer: `SandboxFS`).
 */
import type { NodeId, Program, VarHint } from './types.ts';
import type { ErrorCode, RuntimeError, ValidationError } from './errors.ts';

export type Value =
  | { t: 'int'; v: number }
  | { t: 'float'; v: number }
  | { t: 'text'; v: string }
  | { t: 'bool'; v: boolean }
  /** Relative POSIX path from the root; '' is the root itself. */
  | { t: 'path'; v: string }
  | { t: 'list'; v: Value[] };

export type ActionOp = 'RENAME' | 'MOVE' | 'COPY' | 'DELETE' | 'MKDIR' | 'WRITE';

export interface Action {
  op: ActionOp;
  /** Relative POSIX path ('' = root). */
  from: string;
  /** RENAME: the new full relative path. MOVE/COPY: the new full relative path. */
  to?: string;
  destructive: boolean;
}

export type SnapshotEvent = 'stmt' | 'cond' | 'fsRead' | 'fsOp' | 'call' | 'return' | 'error' | 'done';

export interface Counters {
  steps: number;
  reads: number;
  fileOps: number;
  comparisons: number;
}

export interface Frame {
  /** null = program scope. */
  fn: string | null;
  vars: Record<string, Value>;
}

export interface Snapshot<S = unknown> {
  index: number;
  nodeId: NodeId;
  event: SnapshotEvent;
  state: S;
  /** frames[0] = program scope; last = innermost. */
  frames: Frame[];
  /** Visualization hints keyed by variable name, for variables visible in the innermost frame. */
  hints: Record<string, VarHint>;
  counters: Counters;
  /** Set when event = 'fsOp'. */
  action?: Action;
  /** Set when event = 'fsRead': the path(s) read, for click-to-trace. */
  readPaths?: string[];
  /** Number of output lines emitted so far. */
  output: number;
  error?: RuntimeError;
}

export type OutputLine = { kind: 'print'; text: string } | { kind: 'action'; text: string };

export interface Timeline<S = unknown> {
  snapshots: Snapshot<S>[];
  output: OutputLine[];
  /** How the run ended. */
  outcome: 'done' | 'error';
}

// ---------------------------------------------------------------- Action log

const VERB_WIDTH = 6;

function shown(path: string): string {
  return path === '' ? '.' : path;
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Formats an action exactly as both the simulator and the Python runtime print it (design.md §7.4). */
export function formatAction(action: Action): string {
  const verb = action.op.padEnd(VERB_WIDTH, ' ');
  switch (action.op) {
    case 'RENAME':
      return `${verb} ${shown(action.from)} -> ${baseName(action.to ?? '')}`;
    case 'MOVE':
    case 'COPY':
      return `${verb} ${shown(action.from)} -> ${shown(parentOf(action.to ?? ''))}/`;
    case 'MKDIR':
      return `${verb} ${shown(action.from)}/`;
    case 'DELETE':
    case 'WRITE':
      return `${verb} ${shown(action.from)}`;
  }
}

export const DRY_RUN_PREFIX = '[dry run] ';

// ------------------------------------------------------------ Worker protocol

export interface SimulateOptions {
  stepLimit: number;
}

export const DEFAULT_STEP_LIMIT = 10_000;
export const RECURSION_LIMIT = 200;

export type WorkerRequest<S = unknown> = {
  type: 'run';
  /** Must be desugared (no composites). */
  program: Program;
  state: S;
  options: SimulateOptions;
};

export type WorkerResponse<S = unknown> =
  | { type: 'done'; timeline: Timeline<S> }
  | { type: 'invalid'; errors: ValidationError[] }
  | { type: 'crash'; message: string };

export type { ErrorCode };
