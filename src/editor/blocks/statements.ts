/** Statement blocks and the "when run" hat. */
import * as Blockly from 'blockly/core';
import { B } from './blockTypes.ts';
import { STYLE, defineBlock, isRecord, menuItem, mutate } from './common.ts';
import { variableField } from './variables.ts';
import type { VarHint } from '../../ir/types.ts';

function statement(block: Blockly.Block, style: string, tooltip: string): void {
  block.setPreviousStatement(true);
  block.setNextStatement(true);
  block.setStyle(style);
  block.setTooltip(tooltip);
}

/** Assign hint (visualization only) kept in extra state. */
const hints = new WeakMap<Blockly.Block, VarHint>();
export const getAssignHint = (b: Blockly.Block): VarHint | undefined => hints.get(b);
export function setAssignHint(b: Blockly.Block, hint: VarHint | undefined): void {
  if (hint) hints.set(b, { indexInto: hint.indexInto });
  else hints.delete(b);
}

const hasElse = new WeakMap<Blockly.Block, boolean>();
export function setIfElse(block: Blockly.Block, on: boolean): void {
  hasElse.set(block, on);
  const present = block.getInput('ELSE') !== null;
  if (on && !present) block.appendStatementInput('ELSE').appendField('else');
  if (!on && present) block.removeInput('ELSE');
}

export function defineStatementBlocks(): void {
  defineBlock(B.run, {
    init(b) {
      b.appendDummyInput().appendField('when run \u25B6');
      b.setNextStatement(true);
      b.setStyle(STYLE.program);
      b.setDeletable(false);
      b.setTooltip('The program starts here. Blocks attached below run from top to bottom.');
    },
  });

  defineBlock(B.assign, {
    init(b) {
      b.appendValueInput('VALUE')
        .appendField('set')
        .appendField(variableField('item'), 'VAR')
        .appendField('to');
      statement(
        b,
        STYLE.variables,
        'Gives the variable a value. It keeps the kind of value it first got.',
      );
    },
    save(b) {
      const hint = hints.get(b);
      return hint ? { hint: { indexInto: hint.indexInto } } : null;
    },
    load(b, s) {
      const h = s.hint;
      setAssignHint(
        b,
        isRecord(h) && typeof h.indexInto === 'string' ? { indexInto: h.indexInto } : undefined,
      );
    },
  });

  defineBlock(B.if, {
    init(b) {
      b.appendValueInput('COND').setCheck(['bool']).appendField('if');
      b.appendStatementInput('THEN').appendField('then');
      hasElse.set(b, false);
      statement(
        b,
        STYLE.logic,
        'Runs the "then" blocks only when the condition is yes, otherwise the "else" blocks.',
      );
    },
    save(b) {
      return hasElse.get(b) ? { else: true } : null;
    },
    load(b, s) {
      setIfElse(b, s.else === true);
    },
    menu(b, options) {
      const on = hasElse.get(b) === true;
      const elseEmpty = !b.getInputTargetBlock('ELSE');
      menuItem(options, on ? 'Remove "else"' : 'Add "else"', !on || elseEmpty, () =>
        mutate(b, () => setIfElse(b, !on)),
      );
    },
  });

  defineBlock(B.while, {
    init(b) {
      b.appendValueInput('COND').setCheck(['bool']).appendField('repeat while');
      b.appendStatementInput('BODY');
      statement(b, STYLE.loops, 'Keeps running the blocks inside as long as the condition is yes.');
    },
  });

  defineBlock(B.forEach, {
    init(b) {
      b.appendValueInput('LIST')
        .setCheck(['list'])
        .appendField('for each')
        .appendField(variableField('item'), 'VAR')
        .appendField('in');
      b.appendStatementInput('BODY');
      statement(
        b,
        STYLE.loops,
        'Runs the blocks inside once for every item of the list, in order.',
      );
    },
  });

  defineBlock(B.return, {
    init(b) {
      b.appendValueInput('VALUE').appendField('return');
      // A next connection is kept so that any IR (even with blocks after a return) loads.
      b.setPreviousStatement(true);
      b.setNextStatement(true);
      b.setStyle(STYLE.functions);
      b.setTooltip(
        'Stops the function and gives back this value (leave it empty if the function gives back nothing).',
      );
    },
  });

  defineBlock(B.do, {
    init(b) {
      b.appendValueInput('EXPR').appendField('do');
      statement(
        b,
        STYLE.functions,
        'Runs an action or function and ignores the value it gives back.',
      );
    },
  });

  defineBlock(B.print, {
    init(b) {
      b.appendValueInput('VALUE').setCheck(['text']).appendField('show');
      statement(b, STYLE.text, 'Shows a line of text in the output panel.');
    },
  });
}
