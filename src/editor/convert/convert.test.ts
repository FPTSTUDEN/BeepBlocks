// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { b } from '../../ir/build.ts';
import { COMPOSITE_NAMES } from '../../ir/composites.ts';
import { OPS, OP_NAMES } from '../../ir/ops.ts';
import type { Expr, Program, Stmt } from '../../ir/types.ts';
import { T } from '../../ir/types.ts';
import { validateProgram } from '../../ir/validate.ts';
import { registerBlocks } from '../blocks/index.ts';
import { B, RUN_BLOCK_ID, compositeBlockType, opBlockType } from '../blocks/index.ts';
import { kitchenSink } from '../__testing__/samples.ts';
import { irToWs } from './irToWs.ts';
import { DETACHED_MESSAGE, wsToIr } from './wsToIr.ts';

beforeAll(() => registerBlocks());

function roundTrip(p: Program) {
  const ws = new Blockly.Workspace();
  const { warnings } = irToWs(p, {}, ws);
  const out = wsToIr(ws);
  return { ws, warnings, out };
}

/** Every node id in a program. */
function allIds(p: Program): string[] {
  const out: string[] = [];
  const expr = (e: Expr): void => {
    out.push(e.id);
    if (e.kind === 'list') e.items.forEach(expr);
    if (e.kind === 'binary') [e.left, e.right].forEach(expr);
    if (e.kind === 'unary') expr(e.arg);
    if (e.kind === 'op' || e.kind === 'call') e.args.forEach(expr);
  };
  const stmt = (s: Stmt): void => {
    out.push(s.id);
    switch (s.kind) {
      case 'assign':
        return expr(s.value);
      case 'if':
        expr(s.cond);
        s.then.forEach(stmt);
        return s.else.forEach(stmt);
      case 'while':
        expr(s.cond);
        return s.body.forEach(stmt);
      case 'forEach':
        expr(s.list);
        return s.body.forEach(stmt);
      case 'return':
        return s.value ? expr(s.value) : undefined;
      case 'do':
        return expr(s.expr);
      case 'print':
        return expr(s.value);
      case 'composite':
        Object.values(s.inputs).forEach(expr);
        return Object.values(s.bodies).forEach((x) => x.forEach(stmt));
    }
  };
  for (const f of p.functions) {
    out.push(f.id);
    f.body.forEach(stmt);
  }
  p.body.forEach(stmt);
  return out;
}

describe('round trip wsToIr(irToWs(p)) == p', () => {
  test('kitchen sink: every statement/expression kind, all ops, all composites, functions', () => {
    const p = kitchenSink();
    const { warnings, out } = roundTrip(p);
    expect(warnings).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.issues).toEqual([]);
    expect(out.program).toEqual(p);
  });

  test('the sample covers every op and composite', () => {
    const json = JSON.stringify(kitchenSink());
    for (const op of OP_NAMES) expect(json).toContain(`"op":"${op}"`);
    for (const name of COMPOSITE_NAMES) expect(json).toContain(`"name":"${name}"`);
  });

  test('block ids equal node ids; nodes without blocks are aliased', () => {
    const p = kitchenSink();
    const { ws, out } = roundTrip(p);
    for (const id of allIds(p)) {
      const blockId = ws.getBlockById(id) ? id : out.aliases.get(id);
      expect(blockId, id).toBeDefined();
      expect(ws.getBlockById(blockId!), id).not.toBeNull();
    }
    expect(ws.getBlockById('c-x/assign')).not.toBeNull();
    expect(ws.getBlockById(RUN_BLOCK_ID)?.type).toBe(B.run);
  });

  test('float literals: integral floats keep their decimal point', () => {
    const p = b.program([
      b.assign('a', b.float(3, 'a1'), 's1'),
      b.assign('b', b.float(0.1, 'a2'), 's2'),
      b.assign('c', b.lit(0.1, 'a3'), 's3'),
      b.assign('d', b.lit(-0.5, 'a4'), 's4'),
    ]);
    const { ws, out } = roundTrip(p);
    expect(ws.getBlockById('a1')?.getFieldValue('NUM')).toBe('3.0');
    expect(out.program).toEqual(p);
  });

  test('typing a decimal point makes a float', () => {
    const p = b.program([b.assign('a', b.lit(3, 'lit'), 's')]);
    const { ws } = roundTrip(p);
    ws.getBlockById('lit')!.setFieldValue('3.0', 'NUM');
    expect(wsToIr(ws).program.body[0]).toEqual(b.assign('a', b.float(3, 'lit'), 's'));
    ws.getBlockById('lit')!.setFieldValue('3', 'NUM');
    expect(wsToIr(ws).program.body[0]).toEqual(b.assign('a', b.lit(3, 'lit'), 's'));
  });

  test('assign hint survives in extra state (and through serialization)', () => {
    const p = b.program([
      b.assign('xs', b.list(T.number, [], 'l'), 'a0'),
      b.assign('i', b.lit(0, 'z'), 'a1', { indexInto: 'xs' }),
    ]);
    const { ws } = roundTrip(p);
    const state = Blockly.serialization.workspaces.save(ws);
    const ws2 = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(state, ws2);
    expect(wsToIr(ws2).program).toEqual(p);
  });

  test('layout positions round-trip', () => {
    const p = kitchenSink();
    const ws = new Blockly.Workspace();
    const layout = { [RUN_BLOCK_ID]: { x: 10, y: 20 }, 'fn-describe': { x: 600, y: 40 } };
    irToWs(p, layout, ws);
    const out = wsToIr(ws);
    expect(out.layout[RUN_BLOCK_ID]).toEqual({ x: 10, y: 20 });
    expect(out.layout['fn-describe']).toEqual({ x: 600, y: 40 });
    expect(out.layout['fn-log']).toBeDefined();
  });

  test('every op has a block type; statement-only ops are statement blocks', () => {
    const ws = new Blockly.Workspace();
    for (const op of OP_NAMES) {
      const blk = ws.newBlock(opBlockType(op));
      expect(blk.outputConnection === null, op).toBe(OPS[op].returns === null);
      expect(blk.previousConnection !== null, op).toBe(OPS[op].returns === null);
    }
    for (const name of COMPOSITE_NAMES)
      expect(ws.newBlock(compositeBlockType(name)).type).toBeTruthy();
  });

  test('list.get uses the plain-language label and accepts any list', () => {
    const ws = new Blockly.Workspace();
    const blk = ws.newBlock(opBlockType('list.get'));
    const text = blk.inputList.flatMap((i) => i.fieldRow.map((f) => f.getText())).join(' ');
    expect(text).toContain('item at position (from 0)');
    expect(blk.getInput('A0')?.connection?.getCheck()).toEqual(['list']);
    expect(blk.outputConnection?.getCheck()).toBeNull();
  });
});

describe('wsToIr', () => {
  test('ignores disconnected stacks with a warning', () => {
    const ws = new Blockly.Workspace();
    irToWs(b.program([b.print(b.lit('a', 'l1'), 'p1')]), {}, ws);
    const loose = ws.newBlock(B.print, 'loose');
    const out = wsToIr(ws);
    expect(out.program.body.map((s) => s.id)).toEqual(['p1']);
    expect(out.warnings).toEqual([{ blockId: loose.id, message: DETACHED_MESSAGE }]);
  });

  test('an empty socket is an error on the parent block', () => {
    const ws = new Blockly.Workspace();
    irToWs(b.program([b.print(b.lit('a', 'l1'), 'p1')]), {}, ws);
    ws.getBlockById('l1')!.dispose(false);
    const out = wsToIr(ws);
    expect(out.issues).toMatchObject([{ nodeId: 'p1', code: 'MISSING_INPUT', severity: 'error' }]);
    const issues = validateProgram(out.program);
    expect(issues.some((i) => i.nodeId === 'p1' && i.severity === 'error')).toBe(true);
  });

  test('empty composite input → validator MISSING_INPUT on the composite', () => {
    const ws = new Blockly.Workspace();
    irToWs(
      b.program([b.composite('sortByType', { fields: { grouping: 'category' } }, 'c1')]),
      {},
      ws,
    );
    const out = wsToIr(ws);
    expect(out.program.body[0]).toMatchObject({ kind: 'composite', inputs: {} });
    expect(validateProgram(out.program)).toContainEqual(
      expect.objectContaining({ nodeId: 'c1', code: 'MISSING_INPUT' }),
    );
  });

  test('a copied statement op block gets fresh derived ids for its hidden nodes', () => {
    const ws = new Blockly.Workspace();
    const p = b.program([b.do(b.op('fs.delete', [b.root('r')], 'opid'), 'doid')]);
    irToWs(p, {}, ws);
    const state = Blockly.serialization.blocks.save(ws.getBlockById('doid')!)!;
    delete state.id;
    const copy = Blockly.serialization.blocks.append(state, ws);
    ws.getBlockById('doid')!.nextConnection!.connect(copy.previousConnection!);
    const out = wsToIr(ws);
    expect(out.aliases.get('opid')).toBe('doid');
    expect(out.aliases.get(`${copy.id}/expr`)).toBe(copy.id);
    expect(validateProgram(out.program).filter((i) => i.code === 'DUPLICATE_ID')).toEqual([]);
  });

  test('a call to an unknown function and an ill-typed child still load', () => {
    const p = b.program([
      b.assign('r', b.call('nowhere', [b.lit(1, 'a')], 'c'), 's1'),
      b.print(b.lit(5, 'five'), 's2'),
    ]);
    const { warnings, out } = roundTrip(p);
    expect(out.program.body[0]).toEqual(p.body[0]);
    expect(warnings.some((w) => w.includes('five'))).toBe(true);
  });
});
