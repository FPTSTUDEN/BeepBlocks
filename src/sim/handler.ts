/** Worker message handler (design.md §7.2), kept free of Worker globals so it is unit-testable. */
import type { WorkerRequest, WorkerResponse } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { simulateProgram } from './interpreter.ts';

export function handleWorkerRequest(req: WorkerRequest<SandboxFS>): WorkerResponse<SandboxFS> {
  try {
    if (req.type !== 'run')
      return { type: 'crash', message: `Unknown request "${String(req.type)}".` };
    const res = simulateProgram(req.program, req.state, req.options);
    return res.ok
      ? { type: 'done', timeline: res.timeline }
      : { type: 'invalid', errors: res.errors };
  } catch (e) {
    return { type: 'crash', message: e instanceof Error ? e.message : String(e) };
  }
}
