/** Registers every BeepBlocks block type (idempotent). */
import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import { defineCompositeBlocks } from './composites.ts';
import { defineExpressionBlocks } from './expressions.ts';
import { defineFunctionBlocks } from './functions.ts';
import { defineOpBlocks } from './ops.ts';
import { defineStatementBlocks } from './statements.ts';
import { defineViewBlocks } from './views.ts';

let registered = false;

export function registerBlocks(): void {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);
  defineStatementBlocks();
  defineExpressionBlocks();
  defineViewBlocks();
  defineOpBlocks();
  defineFunctionBlocks();
  defineCompositeBlocks();
}

export { B, compositeBlockType, opBlockType } from './blockTypes.ts';
export { RUN_BLOCK_ID, STYLE } from './common.ts';
