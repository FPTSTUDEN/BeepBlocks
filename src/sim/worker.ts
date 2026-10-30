/** Simulator Web Worker entry (design.md §7.2). Protocol: `WorkerRequest` → `WorkerResponse`. */
import type { WorkerRequest, WorkerResponse } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { handleWorkerRequest } from './handler.ts';

/** The subset of DedicatedWorkerGlobalScope used here (the DOM lib does not declare it). */
interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest<SandboxFS>>) => void) | null;
  postMessage(message: WorkerResponse<SandboxFS>): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (ev) => {
  scope.postMessage(handleWorkerRequest(ev.data));
};
