import * as Blockly from 'blockly/core';
import { B } from './blockTypes.ts';
import { STYLE, defineBlock, iconButton, intIn, mutate } from './common.ts';
import { variableField } from './variables.ts';

const viewState = new WeakMap<Blockly.Block, Record<string, unknown>>();
function state(b: Blockly.Block): Record<string, unknown> {
  let s = viewState.get(b);
  if (!s) {
    s = {};
    viewState.set(b, s);
  }
  return s;
}
function setState(b: Blockly.Block, value: Record<string, unknown>): void {
  viewState.set(b, value);
}
function escapedItems(items: string[]): string {
  return items.map((x) => x.replace(/,/g, '\\,')).join(',');
}
function setRows(b: Blockly.Block, n: number): void {
  const count = Math.max(2, Math.min(20, n));
  const s = state(b);
  s.count = count;
  for (let i = 0; i < count; i++) {
    if (!b.getInput(`C${i}`)) b.appendValueInput(`C${i}`).setCheck(['bool']);
  }
  for (let i = count; b.getInput(`C${i}`); i++) b.removeInput(`C${i}`);
}

export function setTextListItems(
  b: Blockly.Block,
  items: readonly string[],
  ids: readonly string[],
) {
  b.setFieldValue(escapedItems([...items]), 'ITEMS');
  setState(b, { ids: [...ids] });
}
export function textListItems(b: Blockly.Block): string[] {
  const raw = String(b.getFieldValue('ITEMS') ?? '');
  if (!raw) return [];
  const out: string[] = [];
  let item = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && raw[i + 1] === ',') {
      item += ',';
      i++;
    } else if (c === ',') {
      out.push(item);
      item = '';
    } else item += c;
  }
  out.push(item);
  return out.length === 1 && out[0] === '' ? [] : out;
}
export function textListIds(b: Blockly.Block): string[] {
  const ids = state(b).ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}

export function defineViewBlocks(): void {
  defineBlock(B.textList, {
    init(b) {
      b.appendDummyInput()
        .appendField('list of text')
        .appendField(new Blockly.FieldTextInput(''), 'ITEMS');
      b.setOutput(true, ['list', 'list:text']);
      b.setStyle(STYLE.lists);
      b.setTooltip('A compact list of text. Escape a comma inside an item as \\,.');
    },
    save(b) {
      const s = state(b);
      return { ids: s.ids ?? [] };
    },
    load(b, s) {
      setState(b, { ids: Array.isArray(s.ids) ? s.ids : [] });
    },
  });

  defineBlock(B.size, {
    init(b) {
      b.appendDummyInput()
        .appendField(new Blockly.FieldTextInput('0'), 'NUM')
        .appendField(
          new Blockly.FieldDropdown([
            ['bytes', '1'],
            ['KB', '1000'],
            ['MB', '1000000'],
            ['GB', '1000000000'],
          ]),
          'UNIT',
        );
      b.setOutput(true, ['number']);
      b.setStyle(STYLE.math);
      b.setTooltip('A size. It is stored as a whole number of bytes.');
    },
  });

  defineBlock(B.property, {
    init(b) {
      b.appendDummyInput()
        .appendField(
          new Blockly.FieldDropdown([
            ['its name', 'name'],
            ['its name without extension', 'stem'],
            ['its extension', 'ext'],
            ['its size', 'size'],
            ['when it was last changed', 'modified'],
            ['its text', 'readText'],
            ["it's a folder", 'isFolder'],
          ]),
          'PROPERTY',
        )
        .appendField(variableField('file'), 'VAR');
      b.setOutput(true);
      b.setStyle(STYLE.files);
      b.setTooltip('A property of the current file.');
    },
  });

  defineBlock(B.readyCondition, {
    init(b) {
      b.appendDummyInput()
        .appendField(
          new Blockly.FieldDropdown([
            ['its name matches', 'nameMatches'],
            ['its extension is', 'extensionIs'],
            ["it's bigger than", 'sizeGt'],
            ["it's at least", 'sizeGe'],
            ["it's smaller than", 'sizeLt'],
            ["it's at most", 'sizeLe'],
            ['it was changed after', 'modifiedGt'],
            ['it was changed on or after', 'modifiedGe'],
            ['it was changed before', 'modifiedLt'],
            ['it was changed on or before', 'modifiedLe'],
            ['its text contains', 'textContains'],
          ]),
          'TEST',
        )
        .appendField(variableField('file'), 'VAR')
        .appendField(new Blockly.FieldTextInput(''), 'VALUE')
        .appendField(
          new Blockly.FieldDropdown([
            ['bytes', '1'],
            ['KB', '1000'],
            ['MB', '1000000'],
            ['GB', '1000000000'],
          ]),
          'UNIT',
        );
      b.setOutput(true, ['bool']);
      b.setStyle(STYLE.logic);
      b.setTooltip('A ready-made condition about the current file.');
    },
  });

  for (const [type, label] of [
    [B.allOf, 'all of these are true'],
    [B.anyOf, 'any of these are true'],
  ] as const) {
    defineBlock(type, {
      init(b) {
        b.appendDummyInput('HEAD')
          .appendField(label)
          .appendField(
            iconButton('plus', 'add a condition', (blk) =>
              mutate(blk, () => setRows(blk, Number(state(blk).count ?? 2) + 1)),
            ),
          )
          .appendField(
            iconButton('minus', 'remove a condition', (blk) =>
              mutate(blk, () => setRows(blk, Number(state(blk).count ?? 2) - 1)),
            ),
          );
        setRows(b, 2);
        b.setOutput(true, ['bool']);
        b.setStyle(STYLE.logic);
        b.setTooltip('Conditions are checked from top to bottom and keep short-circuit behavior.');
      },
      save(b) {
        return { count: state(b).count ?? 2, ids: state(b).ids ?? [] };
      },
      load(b, s) {
        setRows(b, intIn(s.count, 2, 20, 2));
        setState(b, {
          count: intIn(s.count, 2, 20, 2),
          ids: Array.isArray(s.ids) ? s.ids : [],
        });
      },
      menu(b, options) {
        const n = Number(state(b).count ?? 2);
        options.push({
          text: 'Add a condition',
          enabled: n < 20,
          callback: () => mutate(b, () => setRows(b, n + 1)),
        });
        options.push({
          text: 'Remove a condition',
          enabled: n > 2,
          callback: () => mutate(b, () => setRows(b, n - 1)),
        });
      },
    });
  }
}

export function allOfCount(b: Blockly.Block): number {
  return Number(state(b).count ?? 2);
}
export function setAllOfIds(b: Blockly.Block, ids: readonly string[]): void {
  state(b).ids = [...ids];
}
export function allOfIds(b: Blockly.Block): string[] {
  const ids = state(b).ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}

export function sizeBytes(b: Blockly.Block): number {
  const n = Number(String(b.getFieldValue(b.getField('NUM') ? 'NUM' : 'VALUE') ?? '0'));
  const unit = Number(String(b.getFieldValue('UNIT') ?? '1'));
  return Math.floor(Number.isFinite(n) ? Math.max(0, n * unit) : 0);
}
export function setSizeBytes(b: Blockly.Block, bytes: number): void {
  const units = [1000000000, 1000000, 1000, 1];
  const unit = units.find((u) => bytes >= u && Number.isInteger(bytes / u)) ?? 1;
  b.setFieldValue(String(bytes / unit), b.getField('NUM') ? 'NUM' : 'VALUE');
  b.setFieldValue(String(unit), 'UNIT');
}
export function propertyOp(name: string): string {
  return `fs.${name}`;
}
export function setPropertyIds(b: Blockly.Block, ids: { variable: string }): void {
  state(b).variable = ids.variable;
}
export function propertyIds(b: Blockly.Block): { variable: string } {
  const variable = state(b).variable;
  return { variable: typeof variable === 'string' ? variable : `${b.id}/variable` };
}
export function setReadyIds(
  b: Blockly.Block,
  ids: { property: string; variable: string; value: string; wrapper?: string },
): void {
  Object.assign(state(b), ids);
}
export function readyIds(b: Blockly.Block): {
  property: string;
  variable: string;
  value: string;
  wrapper?: string;
} {
  const s = state(b);
  return {
    property: typeof s.property === 'string' ? s.property : `${b.id}/property`,
    variable: typeof s.variable === 'string' ? s.variable : `${b.id}/variable`,
    value: typeof s.value === 'string' ? s.value : `${b.id}/value`,
    ...(typeof s.wrapper === 'string' ? { wrapper: s.wrapper } : {}),
  };
}
