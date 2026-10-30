// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { COMPOSITE_NAMES } from '../ir/composites.ts';
import { OP_NAMES } from '../ir/ops.ts';
import { B, compositeBlockType, opBlockType, registerBlocks } from './blocks/index.ts';
import { variableTypeKey } from './blocks/variables.ts';
import { buildBlocklyTheme, readThemeVars, rebuildTheme, THEME_VARS } from './theme.ts';
import {
  CATEGORY_NAMES,
  CREATE_VAR_TYPES,
  buildToolbox,
  functionsFlyout,
  variablesFlyout,
} from './toolbox.ts';

beforeAll(() => registerBlocks());

type Info = Blockly.utils.toolbox.FlyoutItemInfo & {
  contents?: Info[];
  name?: string;
  type?: string;
};

const blocksOf = (items: readonly Info[]): Blockly.utils.toolbox.BlockInfo[] =>
  items.filter((i): i is Blockly.utils.toolbox.BlockInfo => i.kind === 'block');

describe('toolbox', () => {
  const toolbox = buildToolbox().contents as Info[];

  test('categories in the design order', () => {
    expect(toolbox.map((c) => c.name)).toEqual([...CATEGORY_NAMES]);
    expect(CATEGORY_NAMES).toEqual([
      'Tasks',
      'Files',
      'Logic',
      'Loops',
      'Variables',
      'Lists',
      'Text',
      'Math',
      'Functions',
    ]);
  });

  test('every op and composite is in the palette; Tasks holds the composites', () => {
    const types = new Set(
      toolbox
        .flatMap((c) => blocksOf(c.contents ?? []))
        .flatMap((x) => {
          const nested = JSON.stringify(x).match(/"type":"[^"]+"/g) ?? [];
          return nested.map((s) => s.slice(8, -1));
        }),
    );
    for (const op of OP_NAMES) expect(types.has(opBlockType(op)), op).toBe(true);
    const tasks = blocksOf(toolbox[0]!.contents ?? []).map((x) => x.type);
    expect(tasks).toEqual(COMPOSITE_NAMES.map(compositeBlockType));
  });

  test('every palette entry can be created in a workspace', () => {
    const ws = new Blockly.Workspace();
    for (const cat of toolbox) {
      for (const info of blocksOf(cat.contents ?? [])) {
        const state = { ...info, kind: undefined } as unknown as Blockly.serialization.blocks.State;
        const blk = Blockly.serialization.blocks.append(state, ws);
        expect(blk.type).toBe(info.type);
      }
    }
  });

  test('variables are created with a type and listed in the Variables flyout', () => {
    const ws = new Blockly.Workspace();
    const v = ws.getVariableMap().createVariable('photos', 'list:path');
    expect(variableTypeKey(v)).toBe('list:path');
    const items = variablesFlyout(ws) as Info[];
    expect(items.filter((i) => i.kind === 'button').length).toBe(CREATE_VAR_TYPES.length);
    expect(blocksOf(items).map((x) => x.type)).toEqual([B.assign, B.var]);
    expect(JSON.stringify(items)).toContain('photos (list of files/folders)');
  });

  test('the Functions flyout offers calls for defined functions', () => {
    const ws = new Blockly.Workspace();
    const def = ws.newBlock(B.function);
    def.setFieldValue('greet', 'NAME');
    const calls = blocksOf(functionsFlyout(ws) as Info[]).filter((x) => x.type === B.callStmt);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.extraState).toMatchObject({ fn: 'greet', returns: 'none' });
  });
});

describe('theme', () => {
  test('derived from CSS custom properties with fallbacks, and rebuildable', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(readThemeVars(div)['--bp-bg']).toBe(THEME_VARS['--bp-bg']);
    div.style.setProperty('--bp-bg', '#101010');
    div.style.setProperty('--bp-font', 'Inter');
    const vars = readThemeVars(div);
    expect(vars['--bp-bg']).toBe('#101010');
    const theme = buildBlocklyTheme(vars);
    expect(theme.getComponentStyle('workspaceBackgroundColour')).toBe('#101010');
    expect(theme.fontStyle.family).toBe('Inter');

    const ws = Blockly.inject(div, { toolbox: buildToolbox(), theme });
    div.style.setProperty('--bp-bg', '#202020');
    rebuildTheme(ws, div);
    expect(ws.getTheme().getComponentStyle('workspaceBackgroundColour')).toBe('#202020');
    ws.dispose();
  });
});
