/**
 * Simulator public API — Workstream A (design.md §7). Stubs until Phase 1.
 */
import type { Program } from '../ir/types.ts';
import type { SimulateOptions, Timeline } from '../ir/timeline.ts';
import type { ValidationError } from '../ir/errors.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';

export type SimulateResult =
  | { ok: true; timeline: Timeline<SandboxFS> }
  | { ok: false; errors: ValidationError[] };

/**
 * Runs a desugared program synchronously (tests, conformance). Validates with
 * `primitiveOnly: true` first and returns validation errors instead of running.
 */
export function simulateSync(
  _program: Program,
  _fs: SandboxFS,
  _options?: Partial<SimulateOptions>,
): SimulateResult {
  throw new Error('simulateSync: not implemented (Workstream A)');
}

/** Runs a desugared program in a Web Worker (app). Rejects only if the worker crashes. */
export function simulate(
  _program: Program,
  _fs: SandboxFS,
  _options?: Partial<SimulateOptions>,
): Promise<SimulateResult> {
  return Promise.reject(new Error('simulate: not implemented (Workstream A)'));
}
