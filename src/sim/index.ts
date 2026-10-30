/**
 * Simulator public API — Workstream A (design.md §7).
 */
import type { Program } from '../ir/types.ts';
import { DEFAULT_STEP_LIMIT, type SimulateOptions } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { simulateProgram, type SimulateResult } from './interpreter.ts';
import { runInWorker } from './client.ts';

export type { SimulateResult } from './interpreter.ts';

/**
 * Runs a desugared program synchronously (tests, conformance). Validates with
 * `primitiveOnly: true` first and returns validation errors instead of running.
 */
export function simulateSync(
  program: Program,
  fs: SandboxFS,
  options?: Partial<SimulateOptions>,
): SimulateResult {
  return simulateProgram(program, fs, options);
}

/** Runs a desugared program in a Web Worker (app). Rejects only if the worker crashes. */
export function simulate(
  program: Program,
  fs: SandboxFS,
  options?: Partial<SimulateOptions>,
): Promise<SimulateResult> {
  return runInWorker(program, fs, { stepLimit: options?.stepLimit ?? DEFAULT_STEP_LIMIT });
}
