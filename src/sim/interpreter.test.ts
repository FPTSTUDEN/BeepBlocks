import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import { T, type Expr, type FunctionDef, type Stmt } from '../ir/types.ts';
import type { Snapshot, Timeline } from '../ir/timeline.ts';
import { RECURSION_LIMIT } from '../ir/timeline.ts';
import type { FsNode, SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { getNode } from '../domains/fileExplorer/fsTypes.ts';
import { getScenario } from '../domains/fileExplorer/scenarios/index.ts';
import { simulateSync } from './index.ts';

const EMPTY: SandboxFS = { root: { type: 'folder', name: '', modified: 1000, children: [] } };

function tree(): SandboxFS {
  const f = (name: string, content: string, modified = 1000): FsNode => ({
    type: 'file',
    name,
    modified,
    content,
  });
  return {
    root: {
      type: 'folder',
      name: '',
      modified: 1000,
      children: [
        f('a.txt', 'alpha', 1500),
        { type: 'folder', name: 'Docs', modified: 900, children: [f('b.txt', 'beta')] },
        { type: 'file', name: 'photo.JPG', modified: 2000, binarySize: 10 },
      ],
    },
  };
}

function run(
  body: Stmt[],
  opts: { fns?: FunctionDef[]; fs?: SandboxFS; stepLimit?: number } = {},
): Timeline<SandboxFS> {
  const r = simulateSync(b.program(body, opts.fns ?? []), opts.fs ?? EMPTY, {
    ...(opts.stepLimit !== undefined ? { stepLimit: opts.stepLimit } : {}),
  });
  if (!r.ok) throw new Error(`invalid: ${JSON.stringify(r.errors)}`);
  return r.timeline;
}

const lines = (t: Timeline) => t.output.map((l) => l.text);
const last = <S>(t: Timeline<S>): Snapshot<S> => t.snapshots[t.snapshots.length - 1]!;
const err = (t: Timeline) => {
  const e = last(t).error;
  return e ? { code: e.code, nodeId: e.nodeId } : null;
};
const show = (e: Expr, id?: string) => b.print(b.str(e), id);
const join = (name: string, folder: Expr = b.root()) => b.op('fs.join', [folder, b.lit(name)]);

describe('validation gate', () => {
  it('rejects composites (expects desugared IR)', () => {
    const p = b.program([b.composite('sortByType', { inputs: { folder: b.root() } }, 'c1')]);
    const r = simulateSync(p, EMPTY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.nodeId === 'c1' && e.code === 'STRUCTURE')).toBe(true);
  });
  it('rejects type errors', () => {
    const r = simulateSync(b.program([b.print(b.lit(1))]), EMPTY);
    expect(r.ok).toBe(false);
  });
});

describe('basics', () => {
  it('prints, splitting on \\n, and ends with a done snapshot', () => {
    const t = run([b.print(b.lit('a\nb')), b.print(b.lit('')), b.print(b.lit('c\n'))]);
    expect(lines(t)).toEqual(['a', 'b', '', 'c', '']);
    expect(t.outcome).toBe('done');
    expect(last(t).event).toBe('done');
    expect(last(t).output).toBe(5);
  });

  it('empty program has exactly one (done) snapshot', () => {
    const t = run([]);
    expect(t.snapshots).toHaveLength(1);
    expect(t.snapshots[0]!.event).toBe('done');
    expect(t.snapshots[0]!.state).toBe(EMPTY);
  });

  it('evaluates Python arithmetic, comparison and logic', () => {
    const t = run([
      show(b.bin('//', b.float(7.5), b.lit(2))),
      show(b.bin('%', b.neg(b.lit(7)), b.lit(3))),
      show(b.neg(b.lit(0))),
      show(b.neg(b.float(0))),
      show(b.bin('<', b.lit('B'), b.lit('a'))),
      show(b.bin('and', b.lit(false), b.bin('==', b.lit(1), b.float(1)))),
      show(b.bin('or', b.lit(false), b.bin('==', b.lit(1), b.float(1)))),
      show(b.not(b.lit(true))),
      show(b.date('2026-01-01')),
      show(b.bin('+', b.lit(0.1), b.lit(0.2))),
    ]);
    expect(lines(t)).toEqual([
      '3.0',
      '2',
      '0',
      '-0.0',
      'True',
      'False',
      'True',
      'False',
      '1767225600',
      '0.30000000000000004',
    ]);
    // `and` short-circuits: its right-hand comparison is never evaluated.
    expect(last(t).counters.comparisons).toBe(2);
  });

  it('reports the innermost failing node and keeps prior state', () => {
    const t = run([
      b.print(b.lit('before'), 's1'),
      b.assign('x', b.bin('+', b.lit(1), b.bin('//', b.lit(1), b.lit(0), 'div'), 'plus'), 'as'),
      b.print(b.lit('after')),
    ]);
    expect(lines(t)).toEqual(['before']);
    expect(err(t)).toEqual({ code: 'DIVISION_BY_ZERO', nodeId: 'div' });
    expect(t.outcome).toBe('error');
    expect(last(t).event).toBe('error');
    expect(last(t).nodeId).toBe('div');
  });

  it('INT_OVERFLOW at the binary node', () => {
    const t = run([b.assign('x', b.bin('*', b.lit(2 ** 40), b.lit(2 ** 40), 'mul'))]);
    expect(err(t)).toEqual({ code: 'INT_OVERFLOW', nodeId: 'mul' });
  });
});

describe('lists', () => {
  it('have reference semantics; snapshots hold deep copies', () => {
    const t = run([
      b.assign('a', b.list(T.number, [b.lit(1)]), 'a1'),
      b.assign('c', b.v('a'), 'c1'),
      b.do(b.op('list.append', [b.v('c'), b.lit(2)]), 'ap'),
      show(b.op('list.length', [b.v('a')])),
    ]);
    expect(lines(t)).toEqual(['2']);
    const afterAssign = t.snapshots.find((s) => s.nodeId === 'c1')!;
    expect(afterAssign.frames[0]!.vars.a).toEqual({ t: 'list', v: [{ t: 'int', v: 1 }] });
    const afterAppend = t.snapshots.find((s) => s.nodeId === 'ap')!;
    expect(afterAppend.frames[0]!.vars.c).toEqual({
      t: 'list',
      v: [
        { t: 'int', v: 1 },
        { t: 'int', v: 2 },
      ],
    });
  });

  it('forEach iterates a copy; the loop variable stays in the enclosing scope', () => {
    const t = run([
      b.assign('xs', b.list(T.number, [b.lit(1), b.lit(2)])),
      b.assign('x', b.lit(0)),
      b.forEach('x', b.v('xs'), [b.do(b.op('list.append', [b.v('xs'), b.v('x')]))], 'loop'),
      show(b.op('list.length', [b.v('xs')])),
      show(b.v('x')),
    ]);
    expect(lines(t)).toEqual(['4', '2']);
    // One cond per iteration plus a final one.
    expect(t.snapshots.filter((s) => s.nodeId === 'loop' && s.event === 'cond')).toHaveLength(3);
  });

  it('list.get errors at the op node', () => {
    const xs = () => b.list(T.number, [b.lit(1)]);
    expect(err(run([show(b.op('list.get', [xs(), b.lit(1)], 'g'))]))).toEqual({
      code: 'INDEX_OUT_OF_RANGE',
      nodeId: 'g',
    });
    expect(err(run([show(b.op('list.get', [xs(), b.float(0)], 'g'))]))).toEqual({
      code: 'INVALID_NUMBER',
      nodeId: 'g',
    });
  });
});

describe('functions', () => {
  const fact = b.fn(
    'fact',
    [{ name: 'n', type: T.number }],
    T.number,
    [
      b.if(b.bin('<=', b.v('n'), b.lit(1)), [b.ret(b.lit(1), 'r1')]),
      b.ret(b.bin('*', b.v('n'), b.call('fact', [b.bin('-', b.v('n'), b.lit(1))], 'rec')), 'r2'),
    ],
    'fdef',
  );

  it('recurses with separate frames', () => {
    const t = run([show(b.call('fact', [b.lit(5)], 'top'))], { fns: [fact] });
    expect(lines(t)).toEqual(['120']);
    const calls = t.snapshots.filter((s) => s.event === 'call');
    expect(calls).toHaveLength(5);
    const deepest = calls[calls.length - 1]!;
    expect(deepest.frames.map((f) => f.fn)).toEqual([null, 'fact', 'fact', 'fact', 'fact', 'fact']);
    expect(deepest.frames[5]!.vars).toEqual({ n: { t: 'int', v: 1 } });
    expect(t.snapshots.filter((s) => s.event === 'return')).toHaveLength(5);
  });

  it('functions do not see program variables; procedures return at body end', () => {
    const say = b.fn(
      'say',
      [{ name: 'msg', type: T.text }],
      null,
      [b.assign('x', b.lit(1)), b.print(b.v('msg'))],
      'sayDef',
    );
    const t = run(
      [b.assign('x', b.lit('top')), b.do(b.call('say', [b.lit('hi')], 'c')), b.print(b.v('x'))],
      {
        fns: [say],
      },
    );
    expect(lines(t)).toEqual(['hi', 'top']);
    const ret = t.snapshots.find((s) => s.event === 'return')!;
    expect(ret.nodeId).toBe('sayDef');
    expect(ret.frames[1]!.vars).toEqual({ msg: { t: 'text', v: 'hi' }, x: { t: 'int', v: 1 } });
  });

  it(`stops at ${RECURSION_LIMIT} user frames with RECURSION_LIMIT at the call`, () => {
    const loop = b.fn('down', [{ name: 'n', type: T.number }], T.number, [
      b.ret(b.call('down', [b.bin('+', b.v('n'), b.lit(1))], 'inner')),
    ]);
    const t = run([show(b.call('down', [b.lit(0)], 'outer'))], { fns: [loop] });
    expect(err(t)).toEqual({ code: 'RECURSION_LIMIT', nodeId: 'inner' });
    expect(last(t).frames).toHaveLength(RECURSION_LIMIT + 1);
  });
});

describe('limits and snapshots', () => {
  it('raises STEP_LIMIT after stepLimit snapshots', () => {
    const t = run([b.while(b.lit(true), [b.assign('x', b.lit(1), 'body')], 'w')], {
      stepLimit: 50,
    });
    expect(err(t)?.code).toBe('STEP_LIMIT');
    expect(t.snapshots).toHaveLength(51);
    expect(last(t).counters.steps).toBe(51);
  });

  it('emits stmt/cond/fsRead/fsOp snapshots with counters', () => {
    const t = run(
      [
        b.if(
          b.op('fs.exists', [join('a.txt')], 'ex'),
          [b.do(b.op('fs.delete', [join('a.txt')], 'del'), 'd')],
          [],
          'if1',
        ),
        b.assign('n', b.op('list.length', [b.op('fs.list', [b.root()], 'ls')]), 'as'),
      ],
      { fs: tree() },
    );
    expect(t.snapshots.map((s) => `${s.event}:${s.nodeId}`)).toEqual([
      'fsRead:ex',
      'cond:if1',
      'fsOp:del',
      'stmt:d',
      'fsRead:ls',
      'stmt:as',
      'done:',
    ]);
    expect(t.snapshots.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(t.snapshots[0]!.readPaths).toEqual(['a.txt']);
    expect(t.snapshots[2]!.action).toEqual({ op: 'DELETE', from: 'a.txt', destructive: true });
    expect(last(t).counters).toEqual({ steps: 7, reads: 2, fileOps: 1, comparisons: 0 });
    expect(lines(t)).toEqual(['DELETE a.txt']);
    expect(last(t).frames[0]!.vars.n).toEqual({ t: 'int', v: 2 });
    // State before the delete is untouched (immutable FS).
    expect(getNode(t.snapshots[1]!.state, 'a.txt')).toBeDefined();
    expect(getNode(t.snapshots[2]!.state, 'a.txt')).toBeUndefined();
  });

  it('records hints for variables in the innermost frame', () => {
    const t = run([
      b.assign('items', b.list(T.number, [b.lit(5)])),
      b.assign('low', b.lit(0), 'lo', { indexInto: 'items' }),
      b.assign('low', b.lit(1), 'lo2'),
    ]);
    expect(t.snapshots.find((s) => s.nodeId === 'lo')!.hints).toEqual({
      low: { indexInto: 'items' },
    });
    expect(t.snapshots.find((s) => s.nodeId === 'lo2')!.hints).toEqual({
      low: { indexInto: 'items' },
    });
    expect(t.snapshots[0]!.hints).toEqual({});
  });

  it('is deterministic', () => {
    const body = () => [
      b.forEach('p', b.op('fs.walk', [b.root()]), [show(b.op('fs.size', [b.v('p')]))]),
      b.do(b.op('fs.writeText', [join('n.txt'), b.lit('x')])),
    ];
    const program = b.program(body());
    const one = simulateSync(program, tree());
    const two = simulateSync(program, tree());
    expect(one.ok).toBe(true);
    expect(one).toEqual(two);
  });
});

describe('file system ops in programs', () => {
  it('runs a hand-desugared bisect over the nightly-logs scenario', () => {
    const fs = getScenario('nightly-logs')!.tree;
    const n = (name: string) => b.v(name);
    const t = run(
      [
        b.assign(
          'items',
          b.op('list.sortBy', [b.op('fs.list', [b.root()]), b.lit('name'), b.lit(false)]),
        ),
        b.assign('low', b.lit(0), 'lo', { indexInto: 'items' }),
        b.assign('high', b.op('list.length', [n('items')]), 'hi', { indexInto: 'items' }),
        b.while(b.bin('<', n('low'), n('high')), [
          b.assign('mid', b.bin('//', b.bin('+', n('low'), n('high')), b.lit(2)), 'mid', {
            indexInto: 'items',
          }),
          b.assign('candidate', b.op('list.get', [n('items'), n('mid')])),
          b.if(
            b.op('text.contains', [b.op('fs.readText', [n('candidate')]), b.lit('status: ERROR')]),
            [b.assign('high', n('mid'))],
            [b.assign('low', b.bin('+', n('mid'), b.lit(1)))],
          ),
        ]),
        b.print(b.op('fs.name', [b.op('list.get', [n('items'), n('low')])])),
      ],
      { fs },
    );
    expect(lines(t)).toEqual(['nightly-2026-02-10.log']);
    expect(last(t).counters.reads).toBe(1 + 6); // one list + log2(64) probes
    const midSnap = t.snapshots.find((s) => s.nodeId === 'mid')!;
    expect(midSnap.hints).toEqual({
      low: { indexInto: 'items' },
      high: { indexInto: 'items' },
      mid: { indexInto: 'items' },
    });
  });

  it('logs actions with the new full path and returns stored names', () => {
    const t = run(
      [
        b.assign('r', b.op('fs.rename', [join('A.TXT'), b.lit('renamed.txt')])),
        show(b.v('r')),
        b.assign('m', b.op('fs.move', [b.v('r'), join('docs')])),
        show(b.v('m')),
        b.assign('c', b.op('fs.copy', [join('PHOTO.jpg'), join('docs')])),
        show(b.v('c')),
        b.do(b.op('fs.makeFolder', [join('New')])),
        b.do(b.op('fs.writeText', [join('n.txt', join('New')), b.lit('hi')])),
        show(b.op('fs.parent', [b.v('m')])),
        show(b.op('fs.root', [])),
      ],
      { fs: tree() },
    );
    expect(lines(t)).toEqual([
      'RENAME A.TXT -> renamed.txt',
      'renamed.txt',
      'MOVE   renamed.txt -> docs/',
      'docs/renamed.txt',
      'COPY   PHOTO.jpg -> docs/',
      'docs/photo.JPG',
      'MKDIR  New/',
      'WRITE  New/n.txt',
      'docs',
      '.',
    ]);
    const fs = last(t).state;
    // rename/move/copy preserve mtimes; mkdir/write use the clock (max 2000 + 60, +1 per op).
    expect(getNode(fs, 'Docs/renamed.txt')?.modified).toBe(1500);
    expect(getNode(fs, 'Docs/photo.JPG')?.modified).toBe(2000);
    expect(getNode(fs, 'New')?.modified).toBe(2063);
    expect(getNode(fs, 'New/n.txt')?.modified).toBe(2064);
    const moveSnap = t.snapshots.find((s) => s.action?.op === 'MOVE')!;
    expect(moveSnap.action).toEqual({
      op: 'MOVE',
      from: 'renamed.txt',
      to: 'docs/renamed.txt',
      destructive: false,
    });
  });

  it('failing FS op reports its node id and does not change state', () => {
    const t = run(
      [
        b.do(b.op('fs.makeFolder', [join('X')]), 'mk'),
        b.do(b.op('fs.delete', [join('Docs')], 'del'), 'd'),
      ],
      { fs: tree() },
    );
    expect(err(t)).toEqual({ code: 'NOT_EMPTY', nodeId: 'del' });
    expect(last(t).state).toBe(t.snapshots[t.snapshots.length - 2]!.state);
    expect(lines(t)).toEqual(['MKDIR  X/']);
    expect(last(t).counters.fileOps).toBe(1);
  });

  it('fs.join INVALID_NAME and fs.parent OUTSIDE_ROOT at the op node', () => {
    expect(err(run([show(b.op('fs.join', [b.root(), b.lit('a:b')], 'j'))]))).toEqual({
      code: 'INVALID_NAME',
      nodeId: 'j',
    });
    expect(err(run([show(b.op('fs.parent', [b.root()], 'p'))]))).toEqual({
      code: 'OUTSIDE_ROOT',
      nodeId: 'p',
    });
  });

  it('list.sortBy by size counts one read and checks items', () => {
    const t = run(
      [
        b.assign('files', b.op('fs.walk', [b.root()])),
        b.forEach('f', b.op('list.sortBy', [b.v('files'), b.lit('size'), b.lit(true)], 'sb'), [
          b.print(b.op('fs.name', [b.v('f')])),
        ]),
        b.assign('byName', b.op('list.sortBy', [b.v('files'), b.lit('name'), b.lit(false)], 'sn')),
      ],
      { fs: tree() },
    );
    expect(lines(t)).toEqual(['photo.JPG', 'a.txt', 'b.txt']);
    expect(t.snapshots.filter((s) => s.nodeId === 'sb')).toHaveLength(1);
    expect(t.snapshots.filter((s) => s.nodeId === 'sn')).toHaveLength(0);
    expect(last(t).counters.reads).toBe(2);

    const bad = run(
      [
        b.assign(
          'x',
          b.op('list.sortBy', [b.op('fs.list', [b.root()]), b.lit('size'), b.lit(false)], 'sb'),
        ),
      ],
      { fs: tree() },
    );
    expect(err(bad)).toEqual({ code: 'NOT_A_FILE', nodeId: 'sb' });
  });
});
