/**
 * Extra hand-written timelines for the Playground UI tests (Workstream E). They cover what the
 * shared mocks don't: WRITE (overwrite and create), COPY, DELETE, a folder rename with items
 * inside, a function frame, and float/bool values. Not produced by the real simulator.
 */
import {
  formatAction,
  type Action,
  type Counters,
  type Frame,
  type OutputLine,
  type Snapshot,
  type Timeline,
} from '../../ir/timeline.ts';
import type { FsFile, FsFolder, FsNode, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { compareNames, getNode, splitPath } from '../../domains/fileExplorer/fsTypes.ts';

const T0 = 1_759_276_800; // 2025-10-01T00:00:00Z

const sortKids = (c: readonly FsNode[]) => [...c].sort((a, b) => compareNames(a.name, b.name));
const file = (name: string, content: string, modified = T0): FsFile => ({
  type: 'file',
  name,
  modified,
  content,
});
const folder = (name: string, children: FsNode[], modified = T0): FsFolder => ({
  type: 'folder',
  name,
  modified,
  children: sortKids(children),
});

function edit(fs: SandboxFS, parent: string, fn: (f: FsFolder) => FsNode[]): SandboxFS {
  const go = (f: FsFolder, segs: string[]): FsFolder => {
    if (segs.length === 0) return { ...f, children: sortKids(fn(f)) };
    const [head, ...rest] = segs;
    return {
      ...f,
      children: f.children.map((c) =>
        c.type === 'folder' && c.name.toLowerCase() === head!.toLowerCase() ? go(c, rest) : c,
      ),
    };
  };
  return { root: go(fs.root, splitPath(parent)) };
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const without = (name: string) => (f: FsFolder) =>
  f.children.filter((c) => c.name.toLowerCase() !== name.toLowerCase());

function apply(fs: SandboxFS, a: Action, clock: number, content: string): SandboxFS {
  switch (a.op) {
    case 'MKDIR':
      return edit(fs, parentOf(a.from), (f) => [...f.children, folder(baseOf(a.from), [], clock)]);
    case 'WRITE':
      return edit(fs, parentOf(a.from), (f) => [
        ...without(baseOf(a.from))(f),
        file(baseOf(a.from), content, clock),
      ]);
    case 'DELETE':
      return edit(fs, parentOf(a.from), without(baseOf(a.from)));
    case 'RENAME':
    case 'MOVE':
    case 'COPY': {
      const node = { ...getNode(fs, a.from)!, name: baseOf(a.to!) };
      const placed = a.op === 'COPY' ? { ...node, modified: clock } : node;
      const removed = a.op === 'COPY' ? fs : edit(fs, parentOf(a.from), without(baseOf(a.from)));
      return edit(removed, parentOf(a.to!), (f) => [...f.children, placed]);
    }
  }
}

interface Step {
  nodeId: string;
  event: Snapshot['event'];
  frames?: Frame[];
  action?: Action;
  /** WRITE content. */
  content?: string;
  readPaths?: string[];
  print?: string;
  error?: Snapshot['error'];
}

function build(initial: SandboxFS, steps: Step[]): Timeline<SandboxFS> {
  const snapshots: Snapshot<SandboxFS>[] = [];
  const output: OutputLine[] = [];
  let state = initial;
  let frames: Frame[] = [{ fn: null, vars: {} }];
  const counters: Counters = { steps: 0, reads: 0, fileOps: 0, comparisons: 0 };
  let clock = T0 + 60;
  steps.forEach((s, index) => {
    if (s.action) {
      state = apply(state, s.action, clock++, s.content ?? '');
      output.push({ kind: 'action', text: formatAction(s.action) });
      counters.fileOps += 1;
    }
    if (s.print !== undefined) output.push({ kind: 'print', text: s.print });
    if (s.readPaths) counters.reads += 1;
    counters.steps += 1;
    if (s.frames) frames = s.frames;
    const snap: Snapshot<SandboxFS> = {
      index,
      nodeId: s.nodeId,
      event: s.event,
      state,
      frames,
      hints: {},
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

const cleanupInitial: SandboxFS = {
  root: folder('', [
    folder('Old', [file('inner.txt', 'keep me')]),
    folder('backup', []),
    file('notes.txt', 'hello'),
    { type: 'file', name: 'old.tmp', modified: T0, binarySize: 10 },
  ]),
};

const program = (vars: Frame['vars']): Frame => ({ fn: null, vars });

/** Exercises every diff kind, a folder rename, a function frame, floats and bools. */
export const cleanupTimeline = build(cleanupInitial, [
  { nodeId: 'cl/start', event: 'stmt' },
  { nodeId: 'cl/readInner', event: 'fsRead', readPaths: ['Old/inner.txt'] },
  {
    nodeId: 'cl/rename',
    event: 'fsOp',
    action: { op: 'RENAME', from: 'Old', to: 'Archive', destructive: false },
  },
  {
    nodeId: 'cl/size',
    event: 'fsRead',
    readPaths: ['old.tmp'],
    frames: [program({ tmp: { t: 'path', v: 'old.tmp' }, big: { t: 'bool', v: false } })],
  },
  {
    nodeId: 'cl/delete',
    event: 'fsOp',
    action: { op: 'DELETE', from: 'old.tmp', destructive: true },
  },
  {
    nodeId: 'cl/write1',
    event: 'fsOp',
    action: { op: 'WRITE', from: 'notes.txt', destructive: true },
    content: 'hello again',
  },
  {
    nodeId: 'cl/write2',
    event: 'fsOp',
    action: { op: 'WRITE', from: 'summary.txt', destructive: true },
    content: 'summary',
  },
  {
    nodeId: 'cl/copy',
    event: 'fsOp',
    action: { op: 'COPY', from: 'notes.txt', to: 'backup/notes.txt', destructive: false },
  },
  {
    nodeId: 'cl/call',
    event: 'call',
    frames: [
      program({ tmp: { t: 'path', v: 'old.tmp' }, big: { t: 'bool', v: false } }),
      { fn: 'report', vars: { ratio: { t: 'float', v: 0.5 }, total: { t: 'float', v: 5 } } },
    ],
  },
  { nodeId: 'cl/print', event: 'stmt', print: 'cleaned up' },
  { nodeId: 'cl', event: 'done' },
]);

export const EXTRA_TIMELINES = { cleanup: cleanupTimeline } as const;
