/**
 * Op blocks, generated from the `ir/ops.ts` signatures and labels.
 *
 * - Non-literal arguments are value inputs `A<i>` with type checks (typeKeys.ts).
 * - Literal arguments are fields `L<i>`: a dropdown for `oneOf`, a checkbox for bool, a text
 *   box otherwise. Their IR node ids are stored in the block (`arg<i>`).
 * - Ops with `returns: null` are statement blocks standing for `Do { expr: op }`: the block id
 *   is the `Do` id and the op's own id is stored under `expr`.
 */
import * as Blockly from 'blockly/core';
import { OPS, OP_NAMES, type OpArg, type OpName, type OpSignature } from '../../ir/ops.ts';
import { opBlockType } from './blockTypes.ts';
import { STYLE, defineBlock, type StyleName } from './common.ts';
import { sigInputCheck, sigOutputCheck } from './typeKeys.ts';

/** Plain-language label overrides (`{i}` = argument i). Unmentioned arguments are appended. */
export const OP_LABELS: Partial<Record<OpName, string>> = {
  'list.get': 'item at position (from 0) {1} of {0}',
  'list.sort': '{0} sorted, reversed {1}',
  'list.sortBy': '{0} sorted by {1}, reversed {2}',
};

const SORT_KEY_LABELS: Record<string, string> = {
  name: 'name',
  size: 'size',
  modified: 'last modified time',
  ext: 'extension',
};

export function opStyle(op: OpName): StyleName {
  if (op.startsWith('fs.')) return STYLE.files;
  if (op.startsWith('list.')) return STYLE.lists;
  if (op.startsWith('math.')) return STYLE.math;
  return STYLE.text;
}

export function isStatementOp(op: OpName): boolean {
  return OPS[op].returns === null;
}

type Token = { text: string } | { arg: number };

/** Splits a label template into text and argument tokens; appends unmentioned args. */
export function opLabelTokens(op: OpName): Token[] {
  const sig = OPS[op];
  const template = OP_LABELS[op] ?? sig.label;
  const tokens: Token[] = [];
  const used = new Set<number>();
  const re = /\{(\d+)\}/g;
  let last = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > last) tokens.push({ text: template.slice(last, m.index) });
    const i = Number(m[1]);
    tokens.push({ arg: i });
    used.add(i);
    last = m.index + m[0].length;
  }
  if (last < template.length) tokens.push({ text: template.slice(last) });
  sig.args.forEach((a, i) => {
    if (!used.has(i)) tokens.push({ text: ` ${a.name}` }, { arg: i });
  });
  return tokens;
}

function literalField(arg: OpArg): Blockly.Field {
  if (arg.oneOf) {
    return new Blockly.FieldDropdown(arg.oneOf.map((v) => [SORT_KEY_LABELS[v] ?? v, v]));
  }
  if (arg.type.t === 'bool') return new Blockly.FieldCheckbox('FALSE');
  if (arg.type.t === 'number') return new Blockly.FieldTextInput('0');
  return new Blockly.FieldTextInput('');
}

function tooltip(sig: OpSignature): string {
  const text = sig.label.replace(/\{(\d+)\}/g, (_m, i: string) => sig.args[Number(i)]?.name ?? '…');
  const parts = [text.charAt(0).toUpperCase() + text.slice(1) + '.'];
  if (sig.returns === null) parts.push('This is a step; it gives back nothing.');
  if (sig.destructive) parts.push('Careful: this permanently changes or removes data.');
  return parts.join(' ');
}

function defineOp(op: OpName): void {
  const sig = OPS[op];
  defineBlock(opBlockType(op), {
    init(b) {
      let pending = '';
      for (const tok of opLabelTokens(op)) {
        if ('text' in tok) {
          pending += tok.text;
          continue;
        }
        const arg = sig.args[tok.arg];
        if (!arg) continue;
        const label = pending.trim();
        pending = '';
        if (arg.literal) {
          const input = b.appendDummyInput(`D${tok.arg}`);
          if (label) input.appendField(label);
          input.appendField(literalField(arg), `L${tok.arg}`);
        } else {
          const input = b.appendValueInput(`A${tok.arg}`).setCheck(sigInputCheck(arg.type));
          if (label) input.appendField(label);
        }
      }
      if (pending.trim()) b.appendDummyInput('TAIL').appendField(pending.trim());
      if (sig.returns === null) {
        b.setPreviousStatement(true);
        b.setNextStatement(true);
      } else {
        b.setOutput(true, sigOutputCheck(sig.returns));
      }
      b.setInputsInline(true);
      b.setStyle(opStyle(op));
      b.setTooltip(tooltip(sig));
    },
  });
}

export function defineOpBlocks(): void {
  for (const op of OP_NAMES) defineOp(op);
}
