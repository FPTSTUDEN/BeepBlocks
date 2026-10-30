/**
 * Composite ("task") blocks, one per schema in `ir/composites.ts`.
 *
 * Fields → `F_<key>` (text box, number box, checkbox, dropdown, date box; an empty optional
 * field means null), inputs → value inputs `I_<key>`, bodies → statement inputs `S_<key>`,
 * binds → editable name fields `B_<key>`. The schema `help` is the tooltip.
 */
import * as Blockly from 'blockly/core';
import {
  COMPOSITE_NAMES,
  COMPOSITE_SCHEMAS,
  type CompositeName,
  type FieldSchema,
  type FieldValue,
} from '../../ir/composites.ts';
import { compositeBlockType } from './blockTypes.ts';
import { STYLE, defineBlock } from './common.ts';
import { inputCheck } from './typeKeys.ts';

/** Dropdown value for an optional enum field left unset. */
export const ENUM_UNSET = '__unset__';

const BIND_LABELS: Record<string, string> = {
  candidate: 'call the file being checked',
  match: 'call the file found',
};

export const bindLabel = (key: string) => BIND_LABELS[key] ?? `name for ${key}`;

const NUMBER_RE = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

function makeField(f: FieldSchema): Blockly.Field {
  switch (f.kind) {
    case 'bool':
      return new Blockly.FieldCheckbox(f.default === true ? 'TRUE' : 'FALSE');
    case 'enum': {
      const opts: [string, string][] = (f.options ?? []).map((o) => [o, o]);
      if (f.optional) opts.unshift(['(not set)', ENUM_UNSET]);
      const field = new Blockly.FieldDropdown(opts);
      field.setValue(typeof f.default === 'string' ? f.default : ENUM_UNSET);
      return field;
    }
    case 'number':
      return new Blockly.FieldTextInput(f.default === null ? '' : String(f.default), (text) => {
        const t = text.trim();
        return t === '' || NUMBER_RE.test(t) ? t : null;
      });
    case 'text':
    case 'date':
      return new Blockly.FieldTextInput(typeof f.default === 'string' ? f.default : '');
  }
}

/** IR field value → Blockly field value. */
export function fieldToBlockly(f: FieldSchema, v: FieldValue): string {
  switch (f.kind) {
    case 'bool':
      return v === true ? 'TRUE' : 'FALSE';
    case 'enum':
      return v === null ? ENUM_UNSET : String(v);
    default:
      return v === null ? '' : String(v);
  }
}

/** Blockly field value → IR field value (empty optional → null). */
export function fieldFromBlockly(f: FieldSchema, raw: unknown): FieldValue {
  const s = typeof raw === 'string' ? raw : String(raw ?? '');
  switch (f.kind) {
    case 'bool':
      return s === 'TRUE';
    case 'enum':
      return s === ENUM_UNSET ? null : s;
    case 'number':
      return s.trim() === '' ? null : Number(s);
    case 'text':
    case 'date':
      return s === '' && f.optional ? null : s;
  }
}

function defineComposite(name: CompositeName): void {
  const schema = COMPOSITE_SCHEMAS[name];
  defineBlock(compositeBlockType(name), {
    init(b) {
      b.appendDummyInput('HEAD').appendField(schema.label);
      const placed = new Set<string>();
      const bindsBefore = (slot: string) => {
        for (const bind of schema.binds) {
          if (placed.has(bind.key) || bind.visibleIn[0] !== slot) continue;
          placed.add(bind.key);
          b.appendDummyInput(`BIND_${bind.key}`)
            .appendField(bindLabel(bind.key))
            .appendField(new Blockly.FieldTextInput(bind.defaultName), `B_${bind.key}`);
        }
      };
      for (const inp of schema.inputs) {
        bindsBefore(inp.key);
        b.appendValueInput(`I_${inp.key}`)
          .setCheck(inputCheck(inp.type))
          .setAlign(Blockly.inputs.Align.RIGHT)
          .appendField(inp.optional ? `${inp.label} (optional)` : inp.label);
      }
      for (const f of schema.fields) {
        b.appendDummyInput(`FIELD_${f.key}`)
          .setAlign(Blockly.inputs.Align.RIGHT)
          .appendField(f.optional ? `${f.label} (optional)` : f.label)
          .appendField(makeField(f), `F_${f.key}`);
      }
      for (const body of schema.bodies) {
        bindsBefore(body.key);
        b.appendStatementInput(`S_${body.key}`).appendField(body.label);
      }
      for (const bind of schema.binds) bindsBefore(bind.visibleIn[0] ?? '');
      b.setPreviousStatement(true);
      b.setNextStatement(true);
      b.setStyle(STYLE.tasks);
      b.setTooltip(schema.help);
    },
  });
}

export function defineCompositeBlocks(): void {
  for (const name of COMPOSITE_NAMES) defineComposite(name);
}
