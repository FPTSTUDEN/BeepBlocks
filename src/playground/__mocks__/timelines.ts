/**
 * Hand-written timelines for building the Playground UI without the simulator (task 0.6).
 * They follow the contract in src/ir/timeline.ts but are NOT produced by the real simulator,
 * so exact snapshot granularity may differ slightly from real runs.
 */
import {
  formatAction,
  type Action,
  type Counters,
  type OutputLine,
  type Snapshot,
  type Timeline,
  type Value,
} from '../../ir/timeline.ts';
import type { VarHint } from '../../ir/types.ts';
import type { FsFile, FsFolder, FsNode, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { compareNames } from '../../domains/fileExplorer/fsTypes.ts';

const DAY = 86_400;
const T0 = 1_759_276_800; // 2025-10-01T00:00:00Z

// ------------------------------------------------------------ tiny helpers

const file = (name: string, modified: number, content?: string, binarySize?: number): FsFile =>
  content !== undefined ? { type: 'file', name, modified, content } : { type: 'file', name, modified, binarySize: binarySize ?? 0 };
const folder = (name: string, children: FsNode[], modified = T0): FsFolder => ({
  type: 'folder',
  name,
  modified,
  children: [...children].sort((a, b) => compareNames(a.name, b.name)),
});
const rootOf = (children: FsNode[]): SandboxFS => ({ root: folder('', children) });

/** Applies an action to a flat-ish tree (mock only; handles the cases used below). */
function apply(fs: SandboxFS, a: Action, clock: number): SandboxFS {
  const split = (p: string) => p.split('/');
  const update = (f: FsFolder, segs: string[], fn: (f: FsFolder) => FsFolder): FsFolder => {
    if (segs.length === 0) return fn(f);
    const [head, ...rest] = segs;
    return folder(
      f.name,
      f.children.map((c) => (c.name === head && c.type === 'folder' ? update(c, rest, fn) : c)),
      f.modified,
    );
  };
  const parent = (p: string) => split(p).slice(0, -1);
  const base = (p: string) => split(p).slice(-1)[0]!;
  const find = (p: string): FsNode => {
    let n: FsNode = fs.root;
    for (const s of split(p)) n = (n as FsFolder).children.find((c) => c.name === s)!;
    return n;
  };
  switch (a.op) {
    case 'MKDIR':
      return { root: update(fs.root, parent(a.from), (f) => folder(f.name, [...f.children, folder(base(a.from), [], clock)], f.modified)) };
    case 'RENAME':
    case 'MOVE': {
      const node = { ...find(a.from), name: base(a.to!) };
      const removed = update(fs.root, parent(a.from), (f) => folder(f.name, f.children.filter((c) => c.name !== base(a.from)), f.modified));
      return { root: update(removed, parent(a.to!), (f) => folder(f.name, [...f.children, node], f.modified)) };
    }
    case 'DELETE':
      return { root: update(fs.root, parent(a.from), (f) => folder(f.name, f.children.filter((c) => c.name !== base(a.from)), f.modified)) };
    default:
      throw new Error(`mock apply: ${a.op} not supported`);
  }
}

const int = (v: number): Value => ({ t: 'int', v });
const text = (v: string): Value => ({ t: 'text', v });
const path = (v: string): Value => ({ t: 'path', v });
const list = (v: Value[]): Value => ({ t: 'list', v });

interface Step {
  nodeId: string;
  event: Snapshot['event'];
  vars?: Record<string, Value>;
  hints?: Record<string, VarHint>;
  action?: Action;
  readPaths?: string[];
  print?: string;
  count?: Partial<Counters>;
  error?: Snapshot['error'];
}

/** Builds a timeline from steps; vars accumulate, counters add up, actions mutate state. */
function build(initial: SandboxFS, steps: Step[]): Timeline<SandboxFS> {
  const snapshots: Snapshot<SandboxFS>[] = [];
  const output: OutputLine[] = [];
  let state = initial;
  let vars: Record<string, Value> = {};
  let hints: Record<string, VarHint> = {};
  const counters: Counters = { steps: 0, reads: 0, fileOps: 0, comparisons: 0 };
  let clock = T0 + 60;
  steps.forEach((s, index) => {
    if (s.action) {
      state = apply(state, s.action, clock++);
      output.push({ kind: 'action', text: formatAction(s.action) });
      counters.fileOps += 1;
    }
    if (s.print !== undefined) output.push({ kind: 'print', text: s.print });
    if (s.readPaths) counters.reads += 1;
    counters.steps += 1;
    for (const [k, v] of Object.entries(s.count ?? {})) counters[k as keyof Counters] += v;
    vars = { ...vars, ...s.vars };
    hints = { ...hints, ...s.hints };
    const snap: Snapshot<SandboxFS> = {
      index,
      nodeId: s.nodeId,
      event: s.event,
      state,
      frames: [{ fn: null, vars }],
      hints,
      counters: { ...counters },
      output: output.length,
    };
    if (s.action) snap.action = s.action;
    if (s.readPaths) snap.readPaths = s.readPaths;
    if (s.error) snap.error = s.error;
    snapshots.push(snap);
  });
  return { snapshots, output, outcome: steps.some((s) => s.error) ? 'error' : 'done' };
}

// ------------------------------------------------------- 1. rename by pattern

const cameraInitial = rootOf([
  file('IMG_0001.JPG', T0 + 1 * DAY, undefined, 2_400_000),
  file('IMG_0002.JPG', T0 + 2 * DAY, undefined, 2_100_000),
  file('notes.txt', T0 + 3 * DAY, 'Trip to the coast\n'),
]);

/** Composite id "ren1", desugared children "ren1/…". Shows a skipped non-match. */
export const renameTimeline = build(cameraInitial, [
  { nodeId: 'ren1/n', event: 'stmt', vars: { n: int(0) } },
  { nodeId: 'ren1/list', event: 'fsRead', readPaths: [''] },
  { nodeId: 'ren1/loop', event: 'cond', vars: { item: path('IMG_0001.JPG') } },
  { nodeId: 'ren1/match', event: 'cond', readPaths: ['IMG_0001.JPG'] },
  { nodeId: 'ren1/inc', event: 'stmt', vars: { n: int(1) } },
  { nodeId: 'ren1/newName', event: 'stmt', vars: { new_name: text('photo_001.JPG') } },
  { nodeId: 'ren1/changed', event: 'cond', count: { comparisons: 1 } },
  { nodeId: 'ren1/rename', event: 'fsOp', action: { op: 'RENAME', from: 'IMG_0001.JPG', to: 'photo_001.JPG', destructive: false } },
  { nodeId: 'ren1/loop', event: 'cond', vars: { item: path('IMG_0002.JPG') } },
  { nodeId: 'ren1/match', event: 'cond', readPaths: ['IMG_0002.JPG'] },
  { nodeId: 'ren1/inc', event: 'stmt', vars: { n: int(2) } },
  { nodeId: 'ren1/newName', event: 'stmt', vars: { new_name: text('photo_002.JPG') } },
  { nodeId: 'ren1/changed', event: 'cond', count: { comparisons: 1 } },
  { nodeId: 'ren1/rename', event: 'fsOp', action: { op: 'RENAME', from: 'IMG_0002.JPG', to: 'photo_002.JPG', destructive: false } },
  { nodeId: 'ren1/loop', event: 'cond', vars: { item: path('notes.txt') } },
  { nodeId: 'ren1/match', event: 'cond', readPaths: ['notes.txt'] },
  { nodeId: 'ren1', event: 'done' },
]);

// ---------------------------------------------------- 2. sort into folders

const downloadsInitial = rootOf([
  file('report.pdf', T0, undefined, 180_000),
  file('song.mp3', T0 + DAY, undefined, 4_000_000),
  file('todo.txt', T0 + 2 * DAY, '- buy milk\n'),
]);

export const sortTimeline = build(downloadsInitial, [
  { nodeId: 'srt1/list', event: 'fsRead', readPaths: [''] },
  { nodeId: 'srt1/loop', event: 'cond', vars: { item: path('report.pdf') } },
  { nodeId: 'srt1/ext', event: 'stmt', vars: { ext: text('pdf') } },
  { nodeId: 'srt1/group', event: 'stmt', vars: { group: text('Documents'), target: path('Documents') } },
  { nodeId: 'srt1/exists', event: 'cond', readPaths: ['Documents'] },
  { nodeId: 'srt1/mkdir', event: 'fsOp', action: { op: 'MKDIR', from: 'Documents', destructive: false } },
  { nodeId: 'srt1/move', event: 'fsOp', action: { op: 'MOVE', from: 'report.pdf', to: 'Documents/report.pdf', destructive: false } },
  { nodeId: 'srt1/loop', event: 'cond', vars: { item: path('song.mp3') } },
  { nodeId: 'srt1/ext', event: 'stmt', vars: { ext: text('mp3') } },
  { nodeId: 'srt1/group', event: 'stmt', vars: { group: text('Audio'), target: path('Audio') } },
  { nodeId: 'srt1/exists', event: 'cond', readPaths: ['Audio'] },
  { nodeId: 'srt1/mkdir', event: 'fsOp', action: { op: 'MKDIR', from: 'Audio', destructive: false } },
  { nodeId: 'srt1/move', event: 'fsOp', action: { op: 'MOVE', from: 'song.mp3', to: 'Audio/song.mp3', destructive: false } },
  { nodeId: 'srt1/loop', event: 'cond', vars: { item: path('todo.txt') } },
  { nodeId: 'srt1/ext', event: 'stmt', vars: { ext: text('txt') } },
  { nodeId: 'srt1/group', event: 'stmt', vars: { group: text('Documents'), target: path('Documents') } },
  { nodeId: 'srt1/exists', event: 'cond', readPaths: ['Documents'] },
  { nodeId: 'srt1/move', event: 'fsOp', action: { op: 'MOVE', from: 'todo.txt', to: 'Documents/todo.txt', destructive: false } },
  { nodeId: 'srt1', event: 'done' },
]);

// ------------------------------------------------------------ 3. bisect

const LOGS = 8;
const FIRST_ERROR = 5; // log_6 is the first with ERROR
const logName = (i: number) => `log_2025-10-0${i + 1}.txt`;
const logsInitial = rootOf(
  Array.from({ length: LOGS }, (_, i) =>
    file(logName(i), T0 + i * DAY, i >= FIRST_ERROR ? 'status: ERROR\n' : 'status: OK\n'),
  ),
);
const items = list(Array.from({ length: LOGS }, (_, i) => path(logName(i))));
const idx = { indexInto: 'items' };

/** low=0, high=8 → mid=4 (OK) → low=5 → mid=6 (ERROR) → high=6 → mid=5 (ERROR) → high=5 → match log 5. */
export const bisectTimeline = build(logsInitial, [
  { nodeId: 'bis1/files', event: 'fsRead', readPaths: [''], vars: { items } },
  { nodeId: 'bis1/low', event: 'stmt', vars: { low: int(0) }, hints: { low: idx } },
  { nodeId: 'bis1/high', event: 'stmt', vars: { high: int(LOGS) }, hints: { high: idx } },
  ...[
    { mid: 4, err: false, low: 5, high: 8 },
    { mid: 6, err: true, low: 5, high: 6 },
    { mid: 5, err: true, low: 5, high: 5 },
  ].flatMap((r): Step[] => [
    { nodeId: 'bis1/while', event: 'cond', count: { comparisons: 1 } },
    { nodeId: 'bis1/mid', event: 'stmt', vars: { mid: int(r.mid) }, hints: { mid: idx } },
    { nodeId: 'bis1/candidate', event: 'stmt', vars: { log: path(logName(r.mid)) } },
    { nodeId: 'bis1/check', event: 'cond', readPaths: [logName(r.mid)] },
    r.err
      ? { nodeId: 'bis1/high-mid', event: 'stmt', vars: { high: int(r.high) } }
      : { nodeId: 'bis1/low-mid', event: 'stmt', vars: { low: int(r.low) } },
  ]),
  { nodeId: 'bis1/while', event: 'cond', count: { comparisons: 1 } },
  { nodeId: 'bis1/found?', event: 'cond', count: { comparisons: 1 } },
  { nodeId: 'bis1/match', event: 'stmt', vars: { match: path(logName(FIRST_ERROR)) } },
  { nodeId: 'p1', event: 'stmt', print: `first broken log: ${logName(FIRST_ERROR)}` },
  { nodeId: 'bis1', event: 'done' },
]);

// ------------------------------------------------------------- 4. error run

const errorInitial = rootOf([file('x.txt', T0, 'x'), file('y.txt', T0, 'y')]);

export const errorTimeline = build(errorInitial, [
  { nodeId: 's', event: 'stmt', print: 'start' },
  {
    nodeId: 'rn',
    event: 'error',
    error: {
      code: 'ALREADY_EXISTS',
      nodeId: 'rn',
      message: 'Can\u2019t rename "x.txt" to "Y.TXT": "y.txt" already exists (names ignore upper/lower case).',
    },
  },
]);

export const MOCK_TIMELINES = {
  rename: renameTimeline,
  sort: sortTimeline,
  bisect: bisectTimeline,
  error: errorTimeline,
} as const;
