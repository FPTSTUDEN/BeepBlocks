/** Main-thread client for the simulator worker (design.md §7.2, §14). */
import type { Program } from '../ir/types.ts';
import type { SimulateOptions, WorkerRequest, WorkerResponse } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import type { SimulateResult } from './interpreter.ts';

/** The subset of `Worker` the client uses (lets tests inject a fake). */
export interface WorkerLike {
  onmessage: ((ev: MessageEvent<WorkerResponse<SandboxFS>>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror: ((ev: MessageEvent) => void) | null;
  postMessage(message: WorkerRequest<SandboxFS>): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

export const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

/**
 * Runs one simulation in a fresh worker. Resolves with the result; rejects only if the worker
 * crashes (error event, unreadable message, or a `crash` response). The worker is always
 * terminated afterwards.
 */
export function runInWorker(
  program: Program,
  state: SandboxFS,
  options: SimulateOptions,
  createWorker: WorkerFactory = defaultWorkerFactory,
): Promise<SimulateResult> {
  return new Promise<SimulateResult>((resolve, reject) => {
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      fn();
    };
    worker.onmessage = (ev) => {
      const msg = ev.data;
      finish(() => {
        if (msg.type === 'done') resolve({ ok: true, timeline: msg.timeline });
        else if (msg.type === 'invalid') resolve({ ok: false, errors: msg.errors });
        else reject(new Error(`The simulator stopped unexpectedly: ${msg.message}`));
      });
    };
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      finish(() =>
        reject(new Error(`The simulator stopped unexpectedly: ${ev.message || 'worker error'}`)),
      );
    };
    worker.onmessageerror = () =>
      finish(() => reject(new Error('The simulator stopped unexpectedly: unreadable message.')));
    try {
      worker.postMessage({ type: 'run', program, state, options });
    } catch (e) {
      finish(() => reject(e instanceof Error ? e : new Error(String(e))));
    }
  });
}
