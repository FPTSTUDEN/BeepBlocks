// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { b } from '../ir/build.ts';
import type { CompositeStmt, DesugarOne } from '../ir/composites.ts';
import type { Program, Stmt } from '../ir/types.ts';
import { registerBlocks } from './blocks/index.ts';
import { irToWs } from './convert/irToWs.ts';
import { wsToIr } from './convert/wsToIr.ts';
import { expandComposite, replaceStmt } from './expand.ts';

beforeAll(() => registerBlocks());

/** Blockly fires queued events on the next animation frame. */
const tick = () => new Promise((r) => setTimeout(r, 60));

function findComposite(p: Program, id: string): CompositeStmt {
  const walk = (stmts: Stmt[]): CompositeStmt | null => {
    for (const s of stmts) {
      if (s.id === id && s.kind === 'composite') return s;
      const inner =
        s.kind === 'if'
          ? [...s.then, ...s.else]
          : s.kind === 'while' || s.kind === 'forEach'
            ? s.body
            : s.kind === 'composite'
              ? Object.values(s.bodies).flat()
              : [];
      const hit = walk(inner);
      if (hit) return hit;
    }
    return null;
  };
  const hit = walk([...p.body, ...p.functions.flatMap((f) => f.body)]);
  if (!hit) throw new Error(`no composite ${id}`);
  return hit;
}

/** Fake desugaring: reuses the composite's input and body subtrees, derives other ids. */
const fakeDesugarOne: DesugarOne = (program, id) => {
  const node = findComposite(program, id);
  return [
    b.assign('folder', node.inputs.folder!, `${id}/folder`),
    b.forEach(
      node.binds.candidate ?? 'candidate',
      b.op('fs.list', [b.v('folder', `${id}/folderRef`)], `${id}/list`),
      [
        b.if(
          node.inputs.condition!,
          node.bodies.found ?? [],
          node.bodies.notFound ?? [],
          `${id}/if`,
        ),
      ],
      `${id}/loop`,
    ),
  ];
};

function program(): Program {
  return b.program(
    [
      b.assign('n', b.lit(1, 'l0'), 's0'),
      b.composite(
        'findFirst',
        {
          fields: { sortBy: 'name' },
          inputs: {
            folder: b.root('r1'),
            condition: b.op('fs.exists', [b.v('candidate', 'v1')], 'e1'),
          },
          bodies: { found: [b.print(b.lit('yes', 'l1'), 'p1')], notFound: [] },
          binds: { candidate: 'candidate', match: 'match' },
        },
        'cf',
      ),
      b.print(b.lit('after', 'l2'), 'p2'),
    ],
    [
      b.fn(
        'helper',
        [],
        null,
        [
          b.composite(
            'sortByType',
            { fields: { grouping: 'category' }, inputs: { folder: b.root('r2') } },
            'cs',
          ),
        ],
        'f1',
      ),
    ],
  );
}

describe('expandComposite', () => {
  test('replaces the composite in place, keeping ids; IR equals the desugared program', () => {
    const ws = new Blockly.Workspace();
    const p = program();
    irToWs(p, {}, ws);
    const res = expandComposite(ws, 'cf', fakeDesugarOne);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(ws.getBlockById('cf')).toBeNull();
    for (const id of ['cf/folder', 'cf/loop', 'cf/list', 'cf/if', 'r1', 'e1', 'p1']) {
      expect(ws.getBlockById(id), id).not.toBeNull();
    }
    const expected = replaceStmt(p, 'cf', fakeDesugarOne(p, 'cf'));
    expect(wsToIr(ws).program).toEqual(expected);
    expect(wsToIr(ws).warnings).toEqual([]);
  });

  test('one undo restores the composite; redo re-applies the expansion', async () => {
    const ws = new Blockly.Workspace();
    const p = program();
    irToWs(p, {}, ws);
    const expected = replaceStmt(p, 'cf', fakeDesugarOne(p, 'cf'));
    expandComposite(ws, 'cf', fakeDesugarOne);
    await tick();
    ws.undo(false);
    await tick();
    expect(wsToIr(ws).program).toEqual(p);
    expect(ws.getBlockById('cf')?.type).toBe('bp_task_findFirst');
    ws.undo(true);
    await tick();
    expect(wsToIr(ws).program).toEqual(expected);
  });

  test('works inside a function body and with an empty desugaring', () => {
    const ws = new Blockly.Workspace();
    const p = program();
    irToWs(p, {}, ws);
    const res = expandComposite(ws, 'cs', () => [b.print(b.lit('x', 'cs/msg'), 'cs/print')]);
    expect(res.ok).toBe(true);
    expect(wsToIr(ws).program.functions[0]!.body).toEqual([
      b.print(b.lit('x', 'cs/msg'), 'cs/print'),
    ]);
    expandComposite(ws, 'cf', () => []);
    expect(wsToIr(ws).program.body.map((s) => s.id)).toEqual(['s0', 'p2']);
  });

  test('refuses non-composites, detached composites, and reports desugar errors', () => {
    const ws = new Blockly.Workspace();
    irToWs(program(), {}, ws);
    expect(expandComposite(ws, 's0', fakeDesugarOne).ok).toBe(false);
    expect(
      expandComposite(ws, 'cf', () => {
        throw new Error('boom');
      }),
    ).toEqual({ ok: false, error: 'boom' });
    expect(ws.getBlockById('cf')).not.toBeNull();
    ws.getBlockById('cf')!.unplug(true);
    expect(expandComposite(ws, 'cf', fakeDesugarOne).ok).toBe(false);
  });
});
