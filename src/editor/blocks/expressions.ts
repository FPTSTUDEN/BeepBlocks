/** Expression blocks: literals, variables, operators. */
import * as Blockly from 'blockly/core';
import { B } from './blockTypes.ts';
import { STYLE, defineBlock, iconButton, intIn, menuItem, mutate } from './common.ts';
import {
  ARITH_INPUT,
  PLUS_OUTPUT,
  inputCheck,
  outputCheck,
  parseTypeKey,
  typeDropdownOptions,
} from './typeKeys.ts';
import { variableField } from './variables.ts';
import type { ArithOp, CompareOp } from '../../ir/types.ts';

function expression(block: Blockly.Block, style: string, tooltip: string, check: string[] | null) {
  block.setOutput(true, check);
  block.setInputsInline(true);
  block.setStyle(style);
  block.setTooltip(tooltip);
}

// --------------------------------------------------------------- numbers

const NUMBER_RE = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/** Text shown for a number literal; integral floats keep a decimal point (`3.0`). */
export function formatNumber(value: number, float: boolean): string {
  const s = String(value);
  if (float && Number.isInteger(value) && !/[eE]/.test(s)) return `${s}.0`;
  return s;
}

/**
 * Parses number-literal text. An integral value is a float exactly when the text has a decimal
 * point or exponent (`3.0`). Non-integral values are always floats; whether their IR node
 * carried an explicit `float: true` is remembered in `keepFlag` so it round-trips.
 */
export function parseNumber(text: string, keepFlag: boolean): { value: number; float: boolean } {
  const value = Number(text);
  if (Number.isInteger(value)) return { value, float: /[.eE]/.test(text) };
  return { value, float: keepFlag };
}

const floatFlags = new WeakMap<Blockly.Block, boolean>();
export const getFloatFlag = (b: Blockly.Block) => floatFlags.get(b) === true;
export function setFloatFlag(b: Blockly.Block, on: boolean) {
  if (on) floatFlags.set(b, true);
  else floatFlags.delete(b);
}

function numberValidator(text: string): string | null {
  const t = text.trim();
  return NUMBER_RE.test(t) && Number.isFinite(Number(t)) ? t : null;
}

// ----------------------------------------------------------------- lists

const listCounts = new WeakMap<Blockly.Block, number>();
export const MAX_LIST_ITEMS = 50;

export function listItemCount(b: Blockly.Block): number {
  return listCounts.get(b) ?? 0;
}

function listItemCheck(b: Blockly.Block, key?: string): string[] | null {
  const k = key ?? (b.getFieldValue('TYPE') as string | null) ?? 'number';
  return inputCheck(parseTypeKey(k));
}

export function setListItemCount(b: Blockly.Block, n: number): void {
  const count = Math.max(0, Math.min(MAX_LIST_ITEMS, n));
  listCounts.set(b, count);
  const check = listItemCheck(b);
  for (let i = 0; i < count; i++) {
    if (!b.getInput(`ITEM${i}`)) b.appendValueInput(`ITEM${i}`).setCheck(check);
  }
  for (let i = count; b.getInput(`ITEM${i}`); i++) b.removeInput(`ITEM${i}`);
  const empty = b.getInput('EMPTY');
  if (count === 0 && !empty) b.appendDummyInput('EMPTY').appendField('(empty)');
  if (count > 0 && empty) b.removeInput('EMPTY');
}

// ------------------------------------------------------------- operators

export const ARITH_OPTIONS: [string, ArithOp][] = [
  ['+', '+'],
  ['\u2212', '-'],
  ['\u00D7', '*'],
  ['\u00F7', '/'],
  ['\u00F7 (whole number)', '//'],
  ['remainder after \u00F7', '%'],
];

export const COMPARE_OPTIONS: [string, CompareOp][] = [
  ['=', '=='],
  ['\u2260', '!='],
  ['<', '<'],
  ['\u2264', '<='],
  ['>', '>'],
  ['\u2265', '>='],
];

function updateArithChecks(b: Blockly.Block, op: string): void {
  const plus = op === '+';
  b.getInput('A')?.setCheck(plus ? [...ARITH_INPUT] : ['number']);
  b.getInput('B')?.setCheck(plus ? [...ARITH_INPUT] : ['number']);
  b.setOutput(true, plus ? [...PLUS_OUTPUT] : ['number']);
}

function updateCompareChecks(b: Blockly.Block, op: string): void {
  const ordering = op !== '==' && op !== '!=';
  b.getInput('A')?.setCheck(ordering ? ['number', 'text'] : null);
  b.getInput('B')?.setCheck(ordering ? ['number', 'text'] : null);
}

export function defineExpressionBlocks(): void {
  defineBlock(B.number, {
    init(b) {
      b.appendDummyInput().appendField(new Blockly.FieldTextInput('0', numberValidator), 'NUM');
      expression(b, STYLE.math, 'A number. Type a decimal point (like 3.0) for a decimal number.', [
        'number',
      ]);
    },
    save(b) {
      return getFloatFlag(b) ? { float: true } : null;
    },
    load(b, s) {
      setFloatFlag(b, s.float === true);
    },
  });

  defineBlock(B.text, {
    init(b) {
      b.appendDummyInput()
        .appendField('\u201C')
        .appendField(new Blockly.FieldTextInput(''), 'TEXT')
        .appendField('\u201D');
      expression(b, STYLE.text, 'A piece of text.', ['text']);
    },
  });

  defineBlock(B.bool, {
    init(b) {
      b.appendDummyInput().appendField(
        new Blockly.FieldDropdown([
          ['yes', 'TRUE'],
          ['no', 'FALSE'],
        ]),
        'BOOL',
      );
      expression(b, STYLE.logic, 'A yes/no value.', ['bool']);
    },
  });

  defineBlock(B.date, {
    init(b) {
      b.appendDummyInput()
        .appendField('date')
        .appendField(new Blockly.FieldTextInput('2026-01-01'), 'ISO');
      expression(
        b,
        STYLE.math,
        'A date written as YYYY-MM-DD. It counts as the time at midnight (UTC) of that day.',
        ['number'],
      );
    },
  });

  defineBlock(B.list, {
    init(b) {
      b.appendDummyInput('HEAD')
        .appendField('list of')
        .appendField(
          new Blockly.FieldDropdown(typeDropdownOptions(), (key: string) => {
            const check = listItemCheck(b, key);
            for (let i = 0; i < listItemCount(b); i++) b.getInput(`ITEM${i}`)?.setCheck(check);
            const t = parseTypeKey(key);
            b.setOutput(true, outputCheck(t ? { t: 'list', of: t } : null));
            return key;
          }),
          'TYPE',
        )
        .appendField(
          iconButton('plus', 'add an item', (blk) =>
            mutate(blk, () => setListItemCount(blk, listItemCount(blk) + 1)),
          ),
        )
        .appendField(
          iconButton('minus', 'remove the last item', (blk) =>
            mutate(blk, () => setListItemCount(blk, listItemCount(blk) - 1)),
          ),
        );
      expression(b, STYLE.lists, 'A list of values that all have the chosen kind.', [
        'list',
        'list:number',
      ]);
      setListItemCount(b, 0);
    },
    save(b) {
      return { items: listItemCount(b) };
    },
    load(b, s) {
      setListItemCount(b, intIn(s.items, 0, MAX_LIST_ITEMS, 0));
    },
    menu(b, options) {
      const n = listItemCount(b);
      menuItem(options, 'Add an item', n < MAX_LIST_ITEMS, () =>
        mutate(b, () => setListItemCount(b, n + 1)),
      );
      menuItem(options, 'Remove the last item', n > 0, () =>
        mutate(b, () => setListItemCount(b, n - 1)),
      );
    },
  });

  defineBlock(B.var, {
    init(b) {
      b.appendDummyInput().appendField(variableField('item'), 'VAR');
      expression(b, STYLE.variables, 'The current value of the variable.', null);
    },
  });

  defineBlock(B.arith, {
    init(b) {
      b.appendValueInput('A');
      b.appendValueInput('B').appendField(
        new Blockly.FieldDropdown(ARITH_OPTIONS, (op: string) => {
          updateArithChecks(b, op);
          return op;
        }),
        'OP',
      );
      expression(
        b,
        STYLE.math,
        'Arithmetic on two numbers. "+" also joins two texts or two lists.',
        [...PLUS_OUTPUT],
      );
      updateArithChecks(b, '+');
    },
  });

  defineBlock(B.compare, {
    init(b) {
      b.appendValueInput('A');
      b.appendValueInput('B').appendField(
        new Blockly.FieldDropdown(COMPARE_OPTIONS, (op: string) => {
          updateCompareChecks(b, op);
          return op;
        }),
        'OP',
      );
      expression(
        b,
        STYLE.logic,
        'Compares two values. "<" and ">" need two numbers or two texts.',
        ['bool'],
      );
      updateCompareChecks(b, '==');
    },
  });

  defineBlock(B.logic, {
    init(b) {
      b.appendValueInput('A').setCheck(['bool']);
      b.appendValueInput('B')
        .setCheck(['bool'])
        .appendField(
          new Blockly.FieldDropdown([
            ['and', 'and'],
            ['or', 'or'],
          ]),
          'OP',
        );
      expression(b, STYLE.logic, '"and" is yes when both are yes; "or" when at least one is.', [
        'bool',
      ]);
    },
  });

  defineBlock(B.not, {
    init(b) {
      b.appendValueInput('X').setCheck(['bool']).appendField('not');
      expression(b, STYLE.logic, 'Yes becomes no, and no becomes yes.', ['bool']);
    },
  });

  defineBlock(B.neg, {
    init(b) {
      b.appendValueInput('X').setCheck(['number']).appendField('\u2212');
      expression(b, STYLE.math, 'The number with its sign flipped.', ['number']);
    },
  });
}
