/* eslint-disable no-restricted-imports */
/**
 * Semantic check (C.7): runs each composite's desugaring through the real simulator
 * (`src/sim`) on small sandbox trees and asserts the exact final tree and output.
 * Test-only: production code in composites/ never imports sim/.
 */
import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import type { CompositeName, CompositeStmt, FieldValue } from '../ir/composites.ts';
import type { Expr, Program, Stmt } from '../ir/types.ts';
import type { OutputLine, Timeline } from '../ir/timeline.ts';
import type { FsFolder, FsNode, SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { sortTree } from '../domains/fileExplorer/fs.ts';
import { getScenario } from '../domains/fileExplorer/scenarios/index.ts';
import { simulateSync } from '../sim/index.ts';
import { desugarProgram } from './index.ts';

// ================================================================== helpers

interface Entry {
  path: string;
  folder?: boolean;
  size?: number;
  modified?: number;
}

const T0 = 1_700_000_000;

/** Builds a sandbox tree; parent folders are created implicitly. Files are opaque. */
function tree(entries: readonly Entry[]): SandboxFS {
  const root: FsFolder = { type: 'folder', name: 'root', modified: T0, children: [] };
  const folderAt = (segs: readonly string[]): FsFolder => {
    let cur = root;
    for (const seg of segs) {
      let next = cur.children.find((c) => c.name === seg);
      if (!next) {
        next = { type: 'folder', name: seg, modified: T0, children: [] };
        cur.children = [...cur.children, next];
      }
      if (next.type !== 'folder') throw new Error(`${seg} is a file`);
      cur = next;
    }
    return cur;
  };
  for (const e of entries) {
    const segs = e.path.split('/');
    const name = segs.pop()!;
    if (e.folder) {
      folderAt([...segs, name]);
    } else {
      const parent = folderAt(segs);
      const file: FsNode = {
        type: 'file',
        name,
        modified: e.modified ?? T0,
        binarySize: e.size ?? 1,
      };
      parent.children = [...parent.children, file];
    }
  }
  return sortTree({ root });
}

/** Flattens a tree depth-first in stored order; folders end with '/'. */
function flatten(fs: SandboxFS): string[] {
  const out: string[] = [];
  const visit = (folder: FsFolder, at: string) => {
    for (const c of folder.children) {
      const p = at === '' ? c.name : `${at}/${c.name}`;
      if (c.type === 'folder') {
        out.push(`${p}/`);
        visit(c, p);
      } else {
        out.push(p);
      }
    }
  };
  visit(fs.root, '');
  return out;
}

interface RunResult {
  tree: string[];
  actions: string[];
  prints: string[];
  timeline: Timeline<SandboxFS>;
}

function run(stmts: Stmt[], fs: SandboxFS): RunResult {
  const desugared: Program = desugarProgram(b.program(stmts));
  const r = simulateSync(desugared, fs);
  if (!r.ok) throw new Error(`invalid program: ${JSON.stringify(r.errors)}`);
  const { timeline } = r;
  const last = timeline.snapshots[timeline.snapshots.length - 1]!;
  if (timeline.outcome !== 'done') {
    throw new Error(`run failed: ${JSON.stringify(last.error)}`);
  }
  const of = (kind: OutputLine['kind']) =>
    timeline.output.filter((l) => l.kind === kind).map((l) => l.text);
  return { tree: flatten(last.state), actions: of('action'), prints: of('print'), timeline };
}

type Parts = {
  fields?: Record<string, FieldValue>;
  inputs?: Record<string, Expr>;
  bodies?: Record<string, Stmt[]>;
  binds?: Record<string, string>;
};
const comp = (name: CompositeName, parts: Parts, id = 'c'): CompositeStmt =>
  b.composite(name, parts, id);
const rootFolder = () => b.root('in.folder');
const sub = (name: string, id: string) =>
  b.op('fs.join', [b.root(`${id}.r`), b.lit(name, `${id}.n`)], id);

// ========================================================== renameByPattern

describe('renameByPattern (simulated)', () => {
  const fs = tree([
    { path: 'b.JPG' },
    { path: 'a.jpg' },
    { path: 'README' },
    { path: '.bashrc' },
    { path: 'notes.txt' },
    { path: 'pics.jpg', folder: true },
  ]);

  it('photo_{n:3}{ext} on *.jpg: counter, padding, dot handling, folders skipped', () => {
    const r = run(
      [
        comp('renameByPattern', {
          fields: { match: '*.jpg', template: 'photo_{n:3}{ext}' },
          inputs: { folder: rootFolder() },
        }),
      ],
      fs,
    );
    expect(r.actions).toEqual(['RENAME a.jpg -> photo_001.jpg', 'RENAME b.JPG -> photo_002.JPG']);
    expect(r.tree).toEqual([
      '.bashrc',
      'notes.txt',
      'photo_001.jpg',
      'photo_002.JPG',
      'pics.jpg/',
      'README',
    ]);
  });

  it('{n}{ext} on every file: files without an extension get no dot', () => {
    const r = run(
      [
        comp('renameByPattern', {
          fields: { match: '*', template: 'f{n}{ext}' },
          inputs: { folder: rootFolder() },
        }),
      ],
      fs,
    );
    // fs.list order: .bashrc, a.jpg, b.JPG, notes.txt, pics.jpg (folder), README
    expect(r.actions).toEqual([
      'RENAME .bashrc -> f1',
      'RENAME a.jpg -> f2.jpg',
      'RENAME b.JPG -> f3.JPG',
      'RENAME notes.txt -> f4.txt',
      'RENAME README -> f5',
    ]);
    expect(r.tree).toEqual(['f1', 'f2.jpg', 'f3.JPG', 'f4.txt', 'f5', 'pics.jpg/']);
  });

  it('{name}{ext} leaves every name unchanged and does nothing', () => {
    const r = run(
      [
        comp('renameByPattern', {
          fields: { match: '*', template: '{name}{ext}' },
          inputs: { folder: rootFolder() },
        }),
      ],
      fs,
    );
    expect(r.actions).toEqual([]);
    expect(r.tree).toEqual(flatten(fs));
  });
});

// =============================================================== sortByType

describe('sortByType (simulated)', () => {
  it('category: existing target folder reused, no-extension file goes to Other', () => {
    const fs = tree([
      { path: 'a.JPG' },
      { path: 'b.pdf' },
      { path: 'README' },
      { path: 'song.mp3' },
      { path: 'weird.xyz' },
      { path: 'Images/old.png' },
      { path: 'notes', folder: true },
    ]);
    const r = run(
      [comp('sortByType', { fields: { grouping: 'category' }, inputs: { folder: rootFolder() } })],
      fs,
    );
    expect(r.actions).toEqual([
      'MOVE   a.JPG -> Images/',
      'MKDIR  Documents/',
      'MOVE   b.pdf -> Documents/',
      'MKDIR  Other/',
      'MOVE   README -> Other/',
      'MKDIR  Audio/',
      'MOVE   song.mp3 -> Audio/',
      'MOVE   weird.xyz -> Other/',
    ]);
    expect(r.tree).toEqual([
      'Audio/',
      'Audio/song.mp3',
      'Documents/',
      'Documents/b.pdf',
      'Images/',
      'Images/a.JPG',
      'Images/old.png',
      'notes/',
      'Other/',
      'Other/README',
      'Other/weird.xyz',
    ]);
  });

  it('extension: lowercase folder names, existing folder reused, "No extension"', () => {
    const fs = tree([
      { path: 'a.JPG' },
      { path: 'b.pdf' },
      { path: 'c.Pdf' },
      { path: 'README' },
      { path: 'jpg/x.jpg' },
    ]);
    const r = run(
      [
        comp('sortByType', {
          fields: { grouping: 'extension' },
          inputs: { folder: rootFolder() },
        }),
      ],
      fs,
    );
    expect(r.actions).toEqual([
      'MOVE   a.JPG -> jpg/',
      'MKDIR  pdf/',
      'MOVE   b.pdf -> pdf/',
      'MOVE   c.Pdf -> pdf/',
      'MKDIR  No extension/',
      'MOVE   README -> No extension/',
    ]);
    expect(r.tree).toEqual([
      'jpg/',
      'jpg/a.JPG',
      'jpg/x.jpg',
      'No extension/',
      'No extension/README',
      'pdf/',
      'pdf/b.pdf',
      'pdf/c.Pdf',
    ]);
  });

  it('works on a subfolder (folder input evaluated once, reused for targets)', () => {
    const fs = tree([{ path: 'inbox/a.png' }, { path: 'top.png' }]);
    const r = run(
      [
        comp('sortByType', {
          fields: { grouping: 'category' },
          inputs: { folder: sub('inbox', 'in.inbox') },
        }),
      ],
      fs,
    );
    expect(r.actions).toEqual(['MKDIR  inbox/Images/', 'MOVE   inbox/a.png -> inbox/Images/']);
    expect(r.tree).toEqual(['inbox/', 'inbox/Images/', 'inbox/Images/a.png', 'top.png']);
  });
});

// =============================================================== findAndAct

describe('findAndAct (simulated)', () => {
  const find = (fields: Record<string, FieldValue>, destination?: Expr) =>
    comp('findAndAct', {
      fields,
      inputs: destination ? { folder: rootFolder(), destination } : { folder: rootFolder() },
    });

  const tmpTree = tree([
    { path: 'a.tmp' },
    { path: 'keep.txt' },
    { path: 'sub/b.TMP' },
    { path: 'sub/deep/c.tmp' },
    { path: 'sub/d.txt' },
  ]);

  it('recursive delete of .tmp files (extension case-insensitive, dot stripped)', () => {
    const r = run([find({ recursive: true, extension: '.tmp', action: 'delete' })], tmpTree);
    expect(r.actions).toEqual(['DELETE a.tmp', 'DELETE sub/b.TMP', 'DELETE sub/deep/c.tmp']);
    expect(r.tree).toEqual(['keep.txt', 'sub/', 'sub/d.txt', 'sub/deep/']);
  });

  it('non-recursive delete only touches files directly in the folder', () => {
    const r = run([find({ recursive: false, extension: 'TMP', action: 'delete' })], tmpTree);
    expect(r.actions).toEqual(['DELETE a.tmp']);
    expect(r.tree).toEqual([
      'keep.txt',
      'sub/',
      'sub/b.TMP',
      'sub/d.txt',
      'sub/deep/',
      'sub/deep/c.tmp',
    ]);
  });

  const moveTree = tree([
    { path: 'a.jpg' },
    { path: 'archive/old.jpg' },
    { path: 'c.png' },
    { path: 'sub/b.jpg' },
  ]);

  it('recursive move skips files already in the destination (guard)', () => {
    // Without the guard, moving archive/old.jpg into archive/ would raise ALREADY_EXISTS.
    const r = run(
      [find({ recursive: true, extension: 'jpg', action: 'move' }, sub('archive', 'in.dest'))],
      moveTree,
    );
    expect(r.actions).toEqual(['MOVE   a.jpg -> archive/', 'MOVE   sub/b.jpg -> archive/']);
    expect(r.tree).toEqual([
      'archive/',
      'archive/a.jpg',
      'archive/b.jpg',
      'archive/old.jpg',
      'c.png',
      'sub/',
    ]);
  });

  it('recursive copy is guarded too', () => {
    const r = run(
      [find({ recursive: true, extension: 'jpg', action: 'copy' }, sub('archive', 'in.dest'))],
      moveTree,
    );
    expect(r.actions).toEqual(['COPY   a.jpg -> archive/', 'COPY   sub/b.jpg -> archive/']);
    expect(r.tree).toEqual([
      'a.jpg',
      'archive/',
      'archive/a.jpg',
      'archive/b.jpg',
      'archive/old.jpg',
      'c.png',
      'sub/',
      'sub/b.jpg',
    ]);
  });

  it('rename counts matched files and skips unchanged names', () => {
    const r = run(
      [
        find({
          recursive: true,
          namePattern: '*.jpg',
          action: 'rename',
          renameTemplate: '{n:2}_{name}{ext}',
        }),
      ],
      moveTree,
    );
    expect(r.actions).toEqual([
      'RENAME a.jpg -> 01_a.jpg',
      'RENAME archive/old.jpg -> 02_old.jpg',
      'RENAME sub/b.jpg -> 03_b.jpg',
    ]);
    const same = run(
      [find({ recursive: true, action: 'rename', renameTemplate: '{name}{ext}' })],
      moveTree,
    );
    expect(same.actions).toEqual([]);
  });

  // ---- criterion boundaries: delete what matches, check what remains
  const MIDNIGHT = Date.UTC(2024, 2, 1) / 1000; // 2024-03-01T00:00:00Z
  const boundaryTree = tree([
    { path: 'a.txt', size: 10, modified: MIDNIGHT - 1 },
    { path: 'b.txt', size: 11, modified: MIDNIGHT },
    { path: 'c.txt', size: 12, modified: MIDNIGHT + 1 },
  ]);
  const remaining = (fields: Record<string, FieldValue>, fs = boundaryTree) =>
    run([find({ recursive: false, action: 'delete', ...fields })], fs).tree;

  it('minSize is inclusive', () => {
    expect(remaining({ minSize: 11 })).toEqual(['a.txt']);
  });

  it('maxSize is inclusive', () => {
    expect(remaining({ maxSize: 11 })).toEqual(['c.txt']);
  });

  it('minSize and maxSize together', () => {
    expect(remaining({ minSize: 11, maxSize: 11 })).toEqual(['a.txt', 'c.txt']);
  });

  it('modifiedAfter is >= midnight UTC (inclusive)', () => {
    expect(remaining({ modifiedAfter: '2024-03-01' })).toEqual(['a.txt']);
  });

  it('modifiedBefore is < midnight UTC (exclusive)', () => {
    expect(remaining({ modifiedBefore: '2024-03-01' })).toEqual(['b.txt', 'c.txt']);
  });

  it('extension: case-insensitive, with or without a leading dot', () => {
    const fs = tree([{ path: 'x.TXT' }, { path: 'y.txt' }, { path: 'z.md' }, { path: 'txt' }]);
    expect(remaining({ extension: '.txt' }, fs)).toEqual(['txt', 'z.md']);
    expect(remaining({ extension: 'TXT' }, fs)).toEqual(['txt', 'z.md']);
  });

  it('namePattern: whole-name wildcard, case-insensitive, ? is exactly one character', () => {
    const fs = tree([
      { path: 'a.txt' },
      { path: 'AB.txt' },
      { path: 'abc.txt' },
      { path: 'xab.txt' },
    ]);
    expect(remaining({ namePattern: 'a?.txt' }, fs)).toEqual(['a.txt', 'abc.txt', 'xab.txt']);
  });
});

// ================================================================ findFirst

describe('findFirst (simulated)', () => {
  const scenario = getScenario('nightly-logs');

  const first = (needle: string) =>
    comp(
      'findFirst',
      {
        fields: { sortBy: 'name' },
        inputs: {
          folder: rootFolder(),
          condition: b.op(
            'text.contains',
            [b.op('fs.readText', [b.v('log', 'in.c.v')], 'in.c.read'), b.lit(needle, 'in.c.s')],
            'in.cond',
          ),
        },
        bodies: {
          found: [b.print(b.op('fs.name', [b.v('hit', 'in.f.v')], 'in.f.name'), 'in.found')],
          notFound: [b.print(b.lit('none', 'in.nf.v'), 'in.notFound')],
        },
        binds: { candidate: 'log', match: 'hit' },
      },
      'ff',
    );
  /** Number of times the condition ran: one fs.readText read per probe. */
  const probes = (t: Timeline<SandboxFS>) =>
    t.snapshots.filter((s) => s.event === 'fsRead' && s.nodeId === 'in.c.read').length;

  it('the scenario has 64 logs', () => {
    expect(scenario).toBeDefined();
    expect(flatten(scenario!.tree)).toHaveLength(64);
  });

  it('finds the first ERROR log in ~log2(64) condition evaluations', () => {
    const r = run([first('status: ERROR')], scenario!.tree);
    expect(r.prints).toEqual(['nightly-2026-02-10.log']);
    expect(r.actions).toEqual([]);
    // Probes at mid = 32, 48, 40, 36, 38, 39 (first ERROR is index 40).
    expect(probes(r.timeline)).toBe(6);
    expect(probes(r.timeline)).toBeLessThanOrEqual(Math.ceil(Math.log2(64 + 1)));
    // The state is untouched.
    expect(r.tree).toEqual(flatten(scenario!.tree));
  });

  it('takes the notFound path when the condition never holds', () => {
    const r = run([first('status: NEVER')], scenario!.tree);
    expect(r.prints).toEqual(['none']);
    // Range sizes 64 → 31 → 15 → 7 → 3 → 1 → 0.
    expect(probes(r.timeline)).toBe(6);
  });

  it('notFound on an empty folder without evaluating the condition', () => {
    const r = run([first('status: ERROR')], tree([{ path: 'logs', folder: true }]));
    expect(r.prints).toEqual(['none']);
    expect(probes(r.timeline)).toBe(0);
  });

  it('low/high/mid carry the indexInto hint for the items list', () => {
    const r = run([first('status: ERROR')], scenario!.tree);
    const withMid = r.timeline.snapshots.find((s) => 'mid' in s.hints);
    expect(withMid?.hints).toMatchObject({
      low: { indexInto: 'items' },
      high: { indexInto: 'items' },
      mid: { indexInto: 'items' },
    });
  });
});
