// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { b } from '../../ir/build.ts';
import type { CompositeExpr } from '../../ir/composites.ts';
import type { Program } from '../../ir/types.ts';
import { registerBlocks } from '../blocks/index.ts';
import { irToWs } from './irToWs.ts';
import { wsToIr } from './wsToIr.ts';

beforeAll(() => registerBlocks());

function roundTrip(p: Program): Program {
  const ws = new Blockly.Workspace();
  const { warnings } = irToWs(p, {}, ws);
  expect(warnings).toEqual([]);
  const out = wsToIr(ws);
  expect(out.warnings).toEqual([]);
  return out.program;
}

/** Finds the CompositeExpr assigned to `name` in a round-tripped program. */
function assignedExpr(p: Program, name: string): CompositeExpr {
  const s = p.body.find((x) => x.kind === 'assign' && x.name === name);
  if (!s || s.kind !== 'assign' || s.value.kind !== 'compositeExpr') {
    throw new Error(`no compositeExpr assigned to ${name}`);
  }
  return s.value;
}

describe('expression actions round-trip through the editor', () => {
  test('filesIn keeps its fields, folder input and bind', () => {
    const prog = b.program([
      b.assign(
        'files',
        b.compositeExpr(
          'filesIn',
          { fields: { includeSubfolders: true, order: 'name' }, inputs: { folder: b.root('r') }, binds: { file: 'f' } },
          'fx',
        ),
        'a',
      ),
    ]);
    const e = assignedExpr(roundTrip(prog), 'files');
    expect(e.name).toBe('filesIn');
    expect(e.id).toBe('fx');
    expect(e.fields).toMatchObject({ includeSubfolders: true, order: 'name' });
    expect(e.inputs.folder?.kind).toBe('op');
    expect(e.binds.file).toBe('f');
  });

  test('countFiles and typeOf round-trip', () => {
    const prog = b.program([
      b.assign('n', b.compositeExpr('countFiles', { fields: { includeSubfolders: false }, inputs: { folder: b.root() } }), 'a1'),
      b.assign('t', b.compositeExpr('typeOf', { fields: { by: 'extension' }, inputs: { file: b.root() } }), 'a2'),
    ]);
    const out = roundTrip(prog);
    expect(assignedExpr(out, 'n').name).toBe('countFiles');
    expect(assignedExpr(out, 't').fields).toMatchObject({ by: 'extension' });
  });

  test('a filesIn block carries a list output connection', () => {
    const ws = new Blockly.Workspace();
    irToWs(b.program([b.assign('files', b.compositeExpr('filesIn', { inputs: { folder: b.root() } }), 'a')]), {}, ws);
    const block = ws.getAllBlocks(false).find((x) => x.type === 'bp_expr_filesIn')!;
    expect(block).toBeTruthy();
    expect(block.outputConnection).toBeTruthy();
    // It fits into the assign's VALUE socket (no loose blocks).
    expect(block.getParent()?.type).toBe('bp_assign');
  });
});
