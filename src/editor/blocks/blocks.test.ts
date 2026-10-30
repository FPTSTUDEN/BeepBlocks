// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { COMPOSITE_NAMES, COMPOSITE_SCHEMAS } from '../../ir/composites.ts';
import { OPS, OP_NAMES } from '../../ir/ops.ts';
import { b } from '../../ir/build.ts';
import { irToWs } from '../convert/irToWs.ts';
import { wsToIr } from '../convert/wsToIr.ts';
import { compositeBlockType, opBlockType } from './blockTypes.ts';
import { B, registerBlocks } from './index.ts';
import { ENUM_UNSET } from './composites.ts';
import { opLabelTokens } from './ops.ts';
import { syncCallBlocks } from './functions.ts';
import {
  inputCheck,
  outputCheck,
  parseTypeKey,
  sigInputCheck,
  sigOutputCheck,
  typeKey,
} from './typeKeys.ts';
import { T } from '../../ir/types.ts';

beforeAll(() => registerBlocks());

const labelText = (blk: Blockly.Block) =>
  blk.inputList
    .flatMap((i) => i.fieldRow.map((f) => f.getText()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Would an output with check `out` plug into an input with check `inp` (Blockly's rule)? */
const fits = (out: string[] | null, inp: string[] | null) =>
  out === null || inp === null || out.some((c) => inp.includes(c));

describe('type keys', () => {
  test('round-trip and checks', () => {
    for (const t of [T.number, T.text, T.bool, T.path, T.list(T.path), T.list(T.list(T.number))]) {
      expect(parseTypeKey(typeKey(t))).toEqual(t);
    }
    expect(typeKey(T.list(T.path))).toBe('list:path');
    expect(outputCheck(T.list(T.path))).toEqual(['list', 'list:path']);
    expect(inputCheck(T.list(T.path))).toEqual(['list:path']);
  });

  test('generic op signatures accept every matching concrete type', () => {
    const listGet = OPS['list.get'];
    expect(sigInputCheck(listGet.args[0]!.type)).toEqual(['list']);
    for (const t of [T.list(T.number), T.list(T.path), T.list(T.list(T.text))]) {
      expect(fits(outputCheck(t), sigInputCheck(listGet.args[0]!.type))).toBe(true);
    }
    expect(fits(outputCheck(T.number), sigInputCheck(listGet.args[0]!.type))).toBe(false);
    const sort = OPS['list.sort'];
    expect(fits(outputCheck(T.list(T.number)), sigInputCheck(sort.args[0]!.type))).toBe(true);
    expect(fits(outputCheck(T.list(T.path)), sigInputCheck(sort.args[0]!.type))).toBe(false);
    // list.sort's result can feed a list-of-numbers input.
    expect(fits(sigOutputCheck(sort.returns!), inputCheck(T.list(T.number)))).toBe(true);
    const textFrom = OPS['text.from'];
    expect(fits(outputCheck(T.path), sigInputCheck(textFrom.args[0]!.type))).toBe(true);
    expect(fits(outputCheck(T.list(T.text)), sigInputCheck(textFrom.args[0]!.type))).toBe(false);
  });
});

describe('op blocks', () => {
  test('labels come from the signature; every argument appears once', () => {
    const ws = new Blockly.Workspace();
    for (const op of OP_NAMES) {
      const toks = opLabelTokens(op).filter((t) => 'arg' in t);
      expect(toks.length, op).toBe(OPS[op].args.length);
      const blk = ws.newBlock(opBlockType(op));
      OPS[op].args.forEach((a, i) => {
        if (a.literal) expect(blk.getField(`L${i}`), `${op} L${i}`).not.toBeNull();
        else expect(blk.getInput(`A${i}`), `${op} A${i}`).not.toBeNull();
      });
    }
    expect(labelText(ws.newBlock(opBlockType('fs.rename')))).toBe('rename to');
    expect(labelText(ws.newBlock(opBlockType('list.get')))).toBe('item at position (from 0) of');
  });

  test('oneOf literals are dropdowns and bool literals are checkboxes', () => {
    const ws = new Blockly.Workspace();
    const blk = ws.newBlock(opBlockType('list.sortBy'));
    expect(blk.getField('L1')).toBeInstanceOf(Blockly.FieldDropdown);
    expect(blk.getField('L2')).toBeInstanceOf(Blockly.FieldCheckbox);
  });
});

describe('composite blocks', () => {
  test('fields, inputs, bodies, binds and help tooltip follow the schema', () => {
    const ws = new Blockly.Workspace();
    for (const name of COMPOSITE_NAMES) {
      const schema = COMPOSITE_SCHEMAS[name];
      const blk = ws.newBlock(compositeBlockType(name));
      expect(blk.getTooltip()).toBe(schema.help);
      for (const f of schema.fields) expect(blk.getField(`F_${f.key}`), f.key).not.toBeNull();
      for (const i of schema.inputs)
        expect(blk.getInput(`I_${i.key}`)?.type).toBe(Blockly.inputs.inputTypes.VALUE);
      for (const s of schema.bodies)
        expect(blk.getInput(`S_${s.key}`)?.type).toBe(Blockly.inputs.inputTypes.STATEMENT);
      for (const bind of schema.binds) {
        expect(blk.getField(`B_${bind.key}`)).toBeInstanceOf(Blockly.FieldTextInput);
      }
    }
  });

  test('optional fields left empty are null', () => {
    const ws = new Blockly.Workspace();
    irToWs(b.program([b.composite('findAndAct', { fields: {} }, 'c')]), {}, ws);
    const c = ws.getBlockById('c')!;
    c.setFieldValue('', 'F_namePattern');
    c.setFieldValue('', 'F_minSize');
    c.setFieldValue('5', 'F_maxSize');
    c.setFieldValue('2026-02-01', 'F_modifiedBefore');
    const node = wsToIr(ws).program.body[0]!;
    expect(node).toMatchObject({
      kind: 'composite',
      fields: {
        namePattern: null,
        minSize: null,
        maxSize: 5,
        modifiedBefore: '2026-02-01',
        recursive: true,
      },
    });
    expect(ENUM_UNSET).toBeTruthy();
  });

  test('bind names are editable', () => {
    const ws = new Blockly.Workspace();
    irToWs(b.program([b.composite('findFirst', { fields: {} }, 'c')]), {}, ws);
    ws.getBlockById('c')!.setFieldValue('photo', 'B_candidate');
    expect(wsToIr(ws).program.body[0]).toMatchObject({
      binds: { candidate: 'photo', match: 'match' },
    });
  });
});

describe('functions', () => {
  test('call blocks follow their definition (rename, inputs, result type)', () => {
    const ws = new Blockly.Workspace();
    irToWs(
      b.program(
        [b.assign('r', b.call('twice', [b.lit(2, 'two')], 'call'), 'a')],
        [
          b.fn(
            'twice',
            [{ name: 'n', type: T.number }],
            T.number,
            [b.ret(b.v('n', 'nv'), 'ret')],
            'fn',
          ),
        ],
      ),
      {},
      ws,
    );
    const def = ws.getBlockById('fn')!;
    def.setFieldValue('double', 'NAME');
    def.setFieldValue('text', 'PTYPE0');
    syncCallBlocks(ws);
    const call = ws.getBlockById('call')!;
    expect(wsToIr(ws).program.body[0]).toMatchObject({ value: { kind: 'call', fn: 'double' } });
    expect(call.getInput('ARG0')?.connection?.getCheck()).toEqual(['text']);
  });

  test('the define block has typed inputs and a "gives back" type', () => {
    const ws = new Blockly.Workspace();
    const def = ws.newBlock(B.function);
    expect(labelText(def)).toContain('define function');
    expect(labelText(def)).toContain('gives back');
    def.loadExtraState?.({ params: [{ name: 'a', type: 'list:path' }] });
    expect(def.getFieldValue('PTYPE0')).toBe('list:path');
  });
});
