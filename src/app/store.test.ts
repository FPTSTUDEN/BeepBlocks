import { describe, expect, it, vi } from 'vitest';
import { b } from '../ir/build.ts';
import type { Program } from '../ir/types.ts';
import type { Timeline } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { SCENARIOS } from '../domains/fileExplorer/scenarios/index.ts';
import { desugarOne, desugarProgram } from '../composites/index.ts';
import { simulateSync } from '../sim/index.ts';
import { activeNodeIds, createAppStore, isStale, type SimulateFn } from './store.ts';
import { PROJECT_KEY, newProject } from './project.ts';
import { SETTINGS_KEY } from './settings.ts';
import { STARTERS } from './starters.ts';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const realSimulate: SimulateFn = (p, fs, o) => Promise.resolve(simulateSync(p, fs, o));

function setup(simulate: SimulateFn = realSimulate, storage: Storage = memoryStorage()) {
  const store = createAppStore({ simulate, desugarProgram, desugarOne, storage, autosaveMs: 10 });
  return { store, storage, s: () => store.getState() };
}

const hello: Program = b.program([b.print(b.lit('hello'), 'p1')]);

describe('app store', () => {
  it('opens the first starter project when nothing is saved yet', () => {
    const { s } = setup();
    expect(s().project.title).toBe(STARTERS[0]!.title);
    expect(s().project.program).toEqual(STARTERS[0]!.program);
    expect(s().project.scenario.id).toBe(STARTERS[0]!.scenarioId);
  });
  it('runs a valid program and records the timeline', async () => {
    const { s } = setup();
    s().editorChanged(hello, {}, []);
    await s().run();
    expect(s().runProblem).toBeNull();
    expect(s().timeline?.outcome).toBe('done');
    expect(s().timeline?.output.map((l) => l.text)).toEqual(['hello']);
    expect(isStale(s())).toBe(false);
  });

  it('validates before desugaring: programs with empty sockets never reach the simulator', async () => {
    const simulate = vi.fn(realSimulate);
    const { s } = setup(simulate);
    const holey = b.program([b.print(null as never, 'p1')]);
    s().editorChanged(holey, {}, []);
    await s().run();
    expect(simulate).not.toHaveBeenCalled();
    expect(s().runProblem?.kind).toBe('invalid');
    expect(s().timeline).toBeNull();
  });

  it('reports a worker crash without throwing', async () => {
    const { s } = setup(() => Promise.reject(new Error('The simulator stopped unexpectedly: boom')));
    s().editorChanged(hello, {}, []);
    await s().run();
    expect(s().runProblem).toEqual({
      kind: 'crash',
      message: 'The simulator stopped unexpectedly: boom',
    });
    expect(s().running).toBe(false);
  });

  it('is not stale when the editor re-emits an equal program (e.g. after a reload)', async () => {
    const { s } = setup();
    s().editorChanged(hello, {}, []);
    await s().run();
    const before = s().project.program;
    // Same content, new object, different key order.
    const reEmitted = JSON.parse(JSON.stringify(hello)) as Program;
    const reordered = { body: reEmitted.body, functions: [], version: 1, format: reEmitted.format } as Program;
    s().editorChanged(reordered, { 'when-run': { x: 1, y: 2 } }, []);
    expect(isStale(s())).toBe(false);
    expect(s().project.program).toBe(before);
    expect(s().project.layout).toEqual({ 'when-run': { x: 1, y: 2 } });
  });

  it('becomes stale when the program or the scenario changes', async () => {
    const { s } = setup();
    s().editorChanged(hello, {}, []);
    await s().run();
    s().editorChanged(b.program([b.print(b.lit('bye'), 'p1')]), {}, []);
    expect(isStale(s())).toBe(true);
    s().editorChanged(hello, {}, []);
    expect(isStale(s())).toBe(false);
    const tree = s().project.scenario.tree;
    s().setScenarioTree({ root: { ...tree.root, children: [] } });
    expect(isStale(s())).toBe(true);
  });

  it('ignores a run that finished after a newer one started', async () => {
    let release: (v: Awaited<ReturnType<SimulateFn>>) => void = () => {};
    const timeline = (text: string): Timeline<SandboxFS> => ({
      snapshots: [],
      output: [{ kind: 'print', text }],
      outcome: 'done',
    });
    let calls = 0;
    const simulate: SimulateFn = () => {
      calls++;
      if (calls === 1) return new Promise((r) => (release = r));
      return Promise.resolve({ ok: true, timeline: timeline('second') });
    };
    const { s } = setup(simulate);
    s().editorChanged(hello, {}, []);
    const first = s().run();
    await s().run();
    release({ ok: true, timeline: timeline('first') });
    await first;
    expect(s().timeline?.output[0]?.text).toBe('second');
  });

  it('highlights the failing block on an error snapshot', async () => {
    const { s } = setup();
    const prog = b.program([
      b.print(b.lit('start'), 'p0'),
      b.assign('x', b.bin('/', b.lit(1), b.lit(0), 'div'), 'a1'),
    ]);
    s().editorChanged(prog, {}, []);
    await s().run();
    const tl = s().timeline!;
    expect(tl.outcome).toBe('error');
    expect(activeNodeIds({ timeline: tl, index: tl.snapshots.length - 1 })).toEqual(['div']);
  });

  it('autosaves the project (debounced) and restores it', async () => {
    const storage = memoryStorage();
    const { store, s } = setup(realSimulate, storage);
    s().setTitle('Mine');
    s().editorChanged(hello, {}, []);
    expect(storage.getItem(PROJECT_KEY)).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(JSON.parse(storage.getItem(PROJECT_KEY)!).title).toBe('Mine');
    store.dispose();
    const again = setup(realSimulate, storage);
    expect(again.s().project.title).toBe('Mine');
    expect(again.s().project.program).toEqual(hello);
  });

  it('flush writes a pending autosave immediately', () => {
    const storage = memoryStorage();
    const { store, s } = setup(realSimulate, storage);
    s().setTitle('Now');
    store.flush();
    expect(JSON.parse(storage.getItem(PROJECT_KEY)!).title).toBe('Now');
  });

  it('flags a failed autosave', async () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    const { s } = setup(realSimulate, storage);
    s().setTitle('x');
    await new Promise((r) => setTimeout(r, 30));
    expect(s().saveFailed).toBe(true);
  });

  it('persists settings', () => {
    const storage = memoryStorage();
    const { s } = setup(realSimulate, storage);
    s().setSettings({ mode: 'dark', accent: '#ff0000' });
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).toEqual({ mode: 'dark', accent: '#ff0000' });
    expect(setup(realSimulate, storage).s().settings).toEqual({ mode: 'dark', accent: '#ff0000' });
  });

  it('migrates an autosave from the pre-rename keys once', () => {
    const storage = memoryStorage();
    const old = { ...newProject(), title: 'Old one' } as Record<string, unknown>;
    old.format = 'block-playground-project';
    old.program = { ...(old.program as object), format: 'block-playground-ir' };
    storage.setItem('bp.project', JSON.stringify(old));
    storage.setItem('bp.settings', JSON.stringify({ mode: 'dark', accent: '#ff0000' }));
    const { s } = setup(realSimulate, storage);
    expect(s().project.title).toBe('Old one');
    expect(s().project.program.format).toBe('beepblocks-ir');
    expect(s().settings.mode).toBe('dark');
    expect(storage.getItem('bp.project')).toBeNull();
    expect(storage.getItem('bp.settings')).toBeNull();
  });

  it('replacing the project clears the run', async () => {
    const { s } = setup();
    s().editorChanged(hello, {}, []);
    await s().run();
    s().replaceProject(newProject(SCENARIOS[1]));
    expect(s().timeline).toBeNull();
    expect(s().project.scenario.id).toBe(SCENARIOS[1]!.id);
  });
});
