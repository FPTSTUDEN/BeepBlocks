import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import type { WorkerRequest, WorkerResponse } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { handleWorkerRequest } from './handler.ts';
import { runInWorker, type WorkerLike } from './client.ts';

const FS: SandboxFS = { root: { type: 'folder', name: '', modified: 0, children: [] } };
const OPTS = { stepLimit: 100 };
const good = () => b.program([b.print(b.lit('hi'))]);

describe('handleWorkerRequest', () => {
  it('returns done with the timeline', () => {
    const res = handleWorkerRequest({ type: 'run', program: good(), state: FS, options: OPTS });
    expect(res.type).toBe('done');
    if (res.type === 'done') expect(res.timeline.output).toEqual([{ kind: 'print', text: 'hi' }]);
  });
  it('returns invalid for programs that fail validation', () => {
    const res = handleWorkerRequest({
      type: 'run',
      program: b.program([b.print(b.lit(3))]),
      state: FS,
      options: OPTS,
    });
    expect(res.type).toBe('invalid');
  });
  it('returns crash on unexpected exceptions', () => {
    const res = handleWorkerRequest({
      type: 'run',
      program: good(),
      state: null as unknown as SandboxFS,
      options: OPTS,
    });
    expect(res.type).toBe('crash');
  });
});

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  terminated = false;
  constructor(private readonly behave: (req: WorkerRequest<SandboxFS>, w: FakeWorker) => void) {}
  postMessage(req: WorkerRequest<SandboxFS>) {
    queueMicrotask(() => this.behave(req, this));
  }
  reply(msg: WorkerResponse<SandboxFS>) {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse<SandboxFS>>);
  }
  terminate() {
    this.terminated = true;
  }
}

describe('runInWorker', () => {
  it('resolves with the handler result and terminates the worker', async () => {
    const w = new FakeWorker((req, self) => self.reply(handleWorkerRequest(req)));
    const res = await runInWorker(good(), FS, OPTS, () => w);
    expect(res.ok).toBe(true);
    expect(w.terminated).toBe(true);
  });
  it('resolves invalid programs as { ok: false }', async () => {
    const w = new FakeWorker((req, self) => self.reply(handleWorkerRequest(req)));
    const res = await runInWorker(b.program([b.print(b.lit(1))]), FS, OPTS, () => w);
    expect(res.ok).toBe(false);
  });
  it('rejects on a crash message', async () => {
    const w = new FakeWorker((_r, self) => self.reply({ type: 'crash', message: 'boom' }));
    await expect(runInWorker(good(), FS, OPTS, () => w)).rejects.toThrow(/boom/);
    expect(w.terminated).toBe(true);
  });
  it('rejects on a worker error event', async () => {
    const w = new FakeWorker((_r, self) => self.onerror?.({ message: 'died' } as ErrorEvent));
    await expect(runInWorker(good(), FS, OPTS, () => w)).rejects.toThrow(/died/);
    expect(w.terminated).toBe(true);
  });
  it('rejects when the worker cannot be created', async () => {
    await expect(
      runInWorker(good(), FS, OPTS, () => {
        throw new Error('no workers');
      }),
    ).rejects.toThrow(/no workers/);
  });
});
