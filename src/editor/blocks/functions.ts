/**
 * Typed function blocks: a "define function" hat (its stack is the body) and call blocks.
 * Blockly's built-in untyped procedures are not used.
 */
import * as Blockly from 'blockly/core';
import { B } from './blockTypes.ts';
import {
  STYLE,
  defineBlock,
  iconButton,
  isRecord,
  menuItem,
  mutate,
  type ExtraState,
} from './common.ts';
import { inputCheck, outputCheck, parseTypeKey, typeDropdownOptions } from './typeKeys.ts';

export interface ParamSpec {
  name: string;
  /** Type key; null = unknown (call to a function that doesn't exist). */
  type: string | null;
}

export const MAX_PARAMS = 10;
export const NO_RETURN = 'none';

// ------------------------------------------------------------ definition

function readParams(b: Blockly.Block): ParamSpec[] {
  const out: ParamSpec[] = [];
  for (let i = 0; b.getInput(`P${i}`); i++) {
    out.push({
      name: String(b.getFieldValue(`PNAME${i}`) ?? ''),
      type: String(b.getFieldValue(`PTYPE${i}`) ?? 'number'),
    });
  }
  return out;
}

export function getDefParams(b: Blockly.Block): ParamSpec[] {
  return readParams(b);
}

export function setDefParams(b: Blockly.Block, params: readonly ParamSpec[]): void {
  for (let i = 0; b.getInput(`P${i}`); i++) b.removeInput(`P${i}`);
  params.slice(0, MAX_PARAMS).forEach((p, i) => {
    const typeField = new Blockly.FieldDropdown(typeDropdownOptions());
    b.appendDummyInput(`P${i}`)
      .appendField('input')
      .appendField(new Blockly.FieldTextInput(p.name), `PNAME${i}`)
      .appendField(':')
      .appendField(typeField, `PTYPE${i}`);
    if (p.type) typeField.setValue(p.type);
    b.moveInputBefore(`P${i}`, 'ADD');
  });
}

function nextParamName(params: readonly ParamSpec[]): string {
  const names = new Set(params.map((p) => p.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'value' : `value${n}`;
    if (!names.has(name)) return name;
  }
}

function addParam(b: Blockly.Block): void {
  const params = readParams(b);
  if (params.length >= MAX_PARAMS) return;
  mutate(b, () => setDefParams(b, [...params, { name: nextParamName(params), type: 'number' }]));
}

function removeParam(b: Blockly.Block): void {
  const params = readParams(b);
  if (params.length === 0) return;
  mutate(b, () => setDefParams(b, params.slice(0, -1)));
}

function parseParams(v: unknown): ParamSpec[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRecord).map((p) => ({
    name: typeof p.name === 'string' ? p.name : '',
    type: typeof p.type === 'string' ? p.type : null,
  }));
}

// ------------------------------------------------------------------ calls

export interface CallSpec {
  fn: string;
  /** Id of the definition block this call was last matched to (survives renames). */
  fnId?: string;
  params: ParamSpec[];
  /** Type key, NO_RETURN, or null when unknown. */
  returns: string | null;
}

const callSpecs = new WeakMap<Blockly.Block, CallSpec>();

export function getCallSpec(b: Blockly.Block): CallSpec {
  return callSpecs.get(b) ?? { fn: '', params: [], returns: null };
}

function sameSpec(a: CallSpec, b: CallSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function setCallSpec(b: Blockly.Block, spec: CallSpec): void {
  callSpecs.set(b, {
    fn: spec.fn,
    ...(spec.fnId ? { fnId: spec.fnId } : {}),
    params: spec.params.map((p) => ({ ...p })),
    returns: spec.returns,
  });
  b.setFieldValue(spec.fn || '?', 'FN');
  const n = spec.params.length;
  spec.params.forEach((p, i) => {
    let input = b.getInput(`ARG${i}`);
    if (!input) {
      input = b.appendValueInput(`ARG${i}`);
      input.appendField('', `ARGL${i}`);
    }
    b.setFieldValue(`${i === 0 ? 'with' : ','} ${p.name}`, `ARGL${i}`);
    input.setCheck(inputCheck(p.type ? parseTypeKey(p.type) : null));
  });
  for (let i = n; b.getInput(`ARG${i}`); i++) b.removeInput(`ARG${i}`);
  if (b.outputConnection) {
    const rt = spec.returns && spec.returns !== NO_RETURN ? parseTypeKey(spec.returns) : null;
    b.setOutput(true, outputCheck(rt));
  }
}

function saveCall(b: Blockly.Block): ExtraState {
  const s = getCallSpec(b);
  return { ...s, params: s.params.map((p) => ({ ...p })) };
}

function loadCall(b: Blockly.Block, s: ExtraState): void {
  setCallSpec(b, {
    fn: typeof s.fn === 'string' ? s.fn : '',
    ...(typeof s.fnId === 'string' ? { fnId: s.fnId } : {}),
    params: parseParams(s.params),
    returns: typeof s.returns === 'string' ? s.returns : null,
  });
}

/** The call spec matching a definition block. */
export function callSpecForDef(def: Blockly.Block): CallSpec {
  return {
    fn: String(def.getFieldValue('NAME') ?? ''),
    fnId: def.id,
    params: readParams(def),
    returns: String(def.getFieldValue('RETURNS') ?? NO_RETURN),
  };
}

/**
 * Keeps call blocks in step with their definitions (name, inputs, result type). Matching is by
 * definition block id first, then by name.
 */
export function syncCallBlocks(ws: Blockly.Workspace): void {
  const defs = ws.getBlocksByType(B.function, false).filter((d) => !d.isDeadOrDying());
  const byId = new Map(defs.map((d) => [d.id, d]));
  const byName = new Map(defs.map((d) => [String(d.getFieldValue('NAME')), d]));
  for (const type of [B.call, B.callStmt]) {
    for (const call of ws.getBlocksByType(type, false)) {
      if (call.isDeadOrDying()) continue;
      const cur = getCallSpec(call);
      const def = (cur.fnId ? byId.get(cur.fnId) : undefined) ?? byName.get(cur.fn);
      if (!def) continue;
      const next = callSpecForDef(def);
      if (!sameSpec(cur, next)) mutate(call, () => setCallSpec(call, next));
    }
  }
}

// ------------------------------------------------------------ registration

export function defineFunctionBlocks(): void {
  defineBlock(B.function, {
    init(b) {
      b.appendDummyInput('HEAD')
        .appendField('define function')
        .appendField(new Blockly.FieldTextInput('doSomething'), 'NAME');
      b.appendDummyInput('ADD')
        .appendField(iconButton('plus', 'add an input', addParam))
        .appendField(iconButton('minus', 'remove the last input', removeParam))
        .appendField('inputs');
      b.appendDummyInput('RET')
        .appendField('gives back')
        .appendField(
          new Blockly.FieldDropdown([['nothing', NO_RETURN], ...typeDropdownOptions()]),
          'RETURNS',
        );
      b.setNextStatement(true);
      b.setStyle(STYLE.functions);
      b.setTooltip(
        'Defines a function. Its inputs are variables inside it; it can only use its own ' +
          'inputs and variables. Blocks attached below are its body.',
      );
    },
    save(b) {
      return { params: readParams(b) };
    },
    load(b, s) {
      setDefParams(b, parseParams(s.params));
    },
    menu(b, options) {
      const n = readParams(b).length;
      menuItem(options, 'Add an input', n < MAX_PARAMS, () => addParam(b));
      menuItem(options, 'Remove the last input', n > 0, () => removeParam(b));
    },
  });

  const callInit = (b: Blockly.Block) => {
    b.appendDummyInput('HEAD').appendField(new Blockly.FieldLabel('?'), 'FN');
    b.setInputsInline(true);
    b.setStyle(STYLE.functions);
    b.setTooltip('Runs the function with these inputs.');
    callSpecs.set(b, { fn: '', params: [], returns: null });
  };

  defineBlock(B.call, {
    init(b) {
      callInit(b);
      b.setOutput(true, null);
    },
    save: saveCall,
    load: loadCall,
  });

  defineBlock(B.callStmt, {
    init(b) {
      callInit(b);
      b.setPreviousStatement(true);
      b.setNextStatement(true);
    },
    save: saveCall,
    load: loadCall,
  });
}
