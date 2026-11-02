/**
 * App store (Task 2.1): the project, the current timeline, playback position, staleness,
 * settings and dialog state. Dependencies are injected so tests need no Worker or storage.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { NodeId, Program } from '../ir/types.ts';
import type { DesugarOne, DesugarProgram } from '../ir/composites.ts';
import type { ValidationError } from '../ir/errors.ts';
import type { SimulateOptions, Timeline } from '../ir/timeline.ts';
import { validateProgram } from '../ir/validate.ts';
import type { SandboxFS, Scenario } from '../domains/fileExplorer/fsTypes.ts';
import { deepEqual } from './deepEqual.ts';
import {
  loadStoredProject,
  migrateLegacyStorage,
  saveStoredProject,
  type Layout,
  type ProjectFile,
} from './project.ts';
import { STARTERS, starterProject } from './starters.ts';
import { SETTINGS_KEY, loadSettings, saveSettings, type Settings } from './settings.ts';

export type SimulateFn = (
  program: Program,
  fs: SandboxFS,
  options?: Partial<SimulateOptions>,
) => Promise<{ ok: true; timeline: Timeline<SandboxFS> } | { ok: false; errors: ValidationError[] }>;

export interface AppDeps {
  simulate: SimulateFn;
  desugarProgram: DesugarProgram;
  desugarOne: DesugarOne;
  storage?: Storage;
  prefersDark?: boolean;
  /** Autosave debounce (design.md §13: 1 s). */
  autosaveMs?: number;
}

/** Why the last Run did not produce a timeline. */
export type RunProblem =
  | { kind: 'invalid'; issues: ValidationError[] }
  | { kind: 'crash'; message: string };

export interface AppState {
  project: ProjectFile;
  /** Latest validation issues reported by the editor (or by Run). */
  issues: ValidationError[];
  timeline: Timeline<SandboxFS> | null;
  index: number;
  /** Program and tree the current timeline was produced from (for staleness). */
  ranWith: { program: Program; tree: SandboxFS } | null;
  running: boolean;
  runProblem: RunProblem | null;
  editingScenario: boolean;
  /** Blocks marked by click-to-trace or "show block". */
  marked: NodeId[];
  settings: Settings;
  /** Autosave failed (quota or blocked storage). */
  saveFailed: boolean;

  editorChanged(program: Program, layout: Layout, issues: ValidationError[]): void;
  setTitle(title: string): void;
  pickScenario(scenario: Scenario): void;
  setScenarioTree(tree: SandboxFS): void;
  setEditingScenario(on: boolean): void;
  run(): Promise<void>;
  setIndex(index: number): void;
  reset(): void;
  mark(ids: NodeId[]): void;
  replaceProject(project: ProjectFile): void;
  setSettings(patch: Partial<Settings>): void;
  dismissRunProblem(): void;
}

export type AppStore = StoreApi<AppState> & {
  deps: AppDeps;
  /** Writes any pending autosave now. */
  flush(): void;
  dispose(): void;
};

/** True when the program or the scenario changed after the current timeline was produced. */
export function isStale(s: Pick<AppState, 'ranWith' | 'timeline' | 'project'>): boolean {
  if (!s.timeline || !s.ranWith) return false;
  return (
    !deepEqual(s.ranWith.program, s.project.program) ||
    !deepEqual(s.ranWith.tree, s.project.scenario.tree)
  );
}

/** Node ids to highlight in the editor for the current snapshot. */
export function activeNodeIds(s: Pick<AppState, 'timeline' | 'index'>): NodeId[] {
  const snap = s.timeline?.snapshots[s.index];
  if (!snap) return [];
  return [snap.error?.nodeId ?? snap.nodeId].filter((id) => id !== '');
}

const errorsOf = (issues: ValidationError[]) => issues.filter((i) => i.severity === 'error');

export function createAppStore(deps: AppDeps): AppStore {
  let runId = 0;
  migrateLegacyStorage(deps.storage, SETTINGS_KEY);
  const store = createStore<AppState>()((set, get) => ({
    // First run (nothing saved yet): open a starter so there is something to run straight away.
    project: loadStoredProject(deps.storage) ?? starterProject(STARTERS[0]!),
    issues: [],
    timeline: null,
    index: 0,
    ranWith: null,
    running: false,
    runProblem: null,
    editingScenario: false,
    marked: [],
    settings: loadSettings(deps.storage, deps.prefersDark),
    saveFailed: false,

    editorChanged(program, layout, issues) {
      const { project } = get();
      const normalized = program.version === 1 ? { ...program, version: 2 as const } : program;
      // Keep the old reference when the editor re-emits an equal program (e.g. after a reload).
      const same = deepEqual(normalized, project.program);
      set({
        project: { ...project, program: same ? project.program : normalized, layout },
        issues,
      });
    },

    setTitle(title) {
      set({ project: { ...get().project, title } });
    },

    pickScenario(scenario) {
      set({
        project: { ...get().project, scenario: structuredClone(scenario) },
        timeline: null,
        ranWith: null,
        index: 0,
        marked: [],
      });
    },

    setScenarioTree(tree) {
      const { project } = get();
      set({ project: { ...project, scenario: { ...project.scenario, tree } } });
    },

    setEditingScenario(on) {
      set({ editingScenario: on });
    },

    async run() {
      const { project } = get();
      const program = project.program;
      const tree = project.scenario.tree;
      const id = ++runId;
      // The editor leaves empty sockets as null: always validate before desugaring.
      const issues = validateProgram(program);
      if (errorsOf(issues).length > 0) {
        set({ runProblem: { kind: 'invalid', issues }, issues });
        return;
      }
      set({ running: true, runProblem: null, marked: [] });
      try {
        const desugared = deps.desugarProgram(program);
        const res = await deps.simulate(desugared, tree);
        if (id !== runId) return;
        if (!res.ok) {
          set({ running: false, runProblem: { kind: 'invalid', issues: res.errors } });
          return;
        }
        set({
          running: false,
          timeline: res.timeline,
          index: 0,
          ranWith: { program, tree },
        });
      } catch (err) {
        if (id !== runId) return;
        set({
          running: false,
          runProblem: {
            kind: 'crash',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },

    setIndex(index) {
      set({ index });
    },

    reset() {
      runId++;
      set({ timeline: null, ranWith: null, index: 0, marked: [], running: false });
    },

    mark(ids) {
      set({ marked: ids });
    },

    replaceProject(project) {
      runId++;
      set({
        project,
        issues: [],
        timeline: null,
        ranWith: null,
        index: 0,
        marked: [],
        running: false,
        runProblem: null,
        editingScenario: false,
      });
    },

    setSettings(patch) {
      const settings = { ...get().settings, ...patch };
      saveSettings(deps.storage, settings);
      set({ settings });
    },

    dismissRunProblem() {
      set({ runProblem: null });
    },
  }));

  // Autosave (design.md §13): debounced, project only.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const ok = saveStoredProject(deps.storage, store.getState().project);
    if (store.getState().saveFailed === ok) store.setState({ saveFailed: !ok });
  };
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, deps.autosaveMs ?? 1000);
  });

  return Object.assign(store, {
    deps,
    flush() {
      if (timer) {
        clearTimeout(timer);
        save();
      }
    },
    dispose() {
      if (timer) clearTimeout(timer);
      unsubscribe();
    },
  });
}
