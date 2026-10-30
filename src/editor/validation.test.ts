// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { b } from '../ir/build.ts';
import type { ValidationError } from '../ir/errors.ts';
import { RUN_BLOCK_ID, registerBlocks } from './blocks/index.ts';
import { irToWs } from './convert/irToWs.ts';
import { wsToIr } from './convert/wsToIr.ts';
import {
  LiveValidator,
  collectIssues,
  issuesByBlock,
  type ValidationResult,
} from './validation.ts';

beforeAll(() => registerBlocks());

const issue = (nodeId: string, message = 'm'): ValidationError => ({
  nodeId,
  code: 'TYPE_MISMATCH',
  message,
  severity: 'error',
});

function workspace() {
  const ws = new Blockly.Workspace();
  irToWs(
    b.program([
      b.composite(
        'sortByType',
        { fields: { grouping: 'category' }, inputs: { folder: b.root('r') } },
        'c',
      ),
      b.do(b.op('fs.delete', [b.root('r2')], 'del-op'), 'del'),
      b.print(b.lit('hi', 'hi'), 'p'),
    ]),
    {},
    ws,
  );
  return ws;
}

describe('issuesByBlock', () => {
  test('maps derived, aliased, program-level and unknown ids', () => {
    const ws = workspace();
    const { aliases } = wsToIr(ws);
    const map = issuesByBlock(
      [issue('c/loop/2'), issue(''), issue('del-op'), issue('p'), issue('nowhere')],
      ws,
      aliases,
    );
    expect(map.get('c')?.length).toBe(1);
    expect(map.get('del')?.length).toBe(1);
    expect(map.get('p')?.length).toBe(1);
    expect(map.get(RUN_BLOCK_ID)?.length).toBe(2);
  });

  test('empty sockets produce one friendly message on the parent (no duplicate STRUCTURE error)', () => {
    const ws = workspace();
    ws.getBlockById('hi')!.dispose(false);
    const issues = collectIssues(wsToIr(ws)).filter((i) => i.nodeId === 'p');
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'MISSING_INPUT',
        message: 'Fill in the empty slot for the text to show.',
      }),
    ]);
  });

  test('detached stacks become warnings', () => {
    const ws = workspace();
    const loose = ws.newBlock('bp_print');
    const issues = collectIssues(wsToIr(ws));
    expect(issues).toContainEqual(
      expect.objectContaining({ nodeId: loose.id, severity: 'warning' }),
    );
  });
});

describe('LiveValidator', () => {
  test('debounces bursts of edits into one validation 300 ms after the last change', async () => {
    const ws = workspace();
    const results: ValidationResult[] = [];
    const onResult = vi.fn((r: ValidationResult) => results.push(r));
    const v = new LiveValidator(ws, onResult);
    const field = ws.getBlockById('hi')!;
    const start = Date.now();
    field.setFieldValue('a', 'TEXT');
    await new Promise((r) => setTimeout(r, 150));
    field.setFieldValue('ab', 'TEXT');
    await new Promise((r) => setTimeout(r, 150));
    field.setFieldValue('abc', 'TEXT');
    await new Promise((r) => setTimeout(r, 150));
    expect(onResult).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(600);
    expect(JSON.stringify(results[0]!.program)).toContain('"abc"');
    v.dispose();
  });

  test('ignores UI-only events', async () => {
    const ws = workspace();
    const onResult = vi.fn();
    const v = new LiveValidator(ws, onResult);
    Blockly.Events.fire(
      new Blockly.Events.Click(ws.getBlockById('p')!, ws.id, Blockly.Events.ClickTarget.BLOCK),
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(onResult).not.toHaveBeenCalled();
    v.dispose();
  });
});
