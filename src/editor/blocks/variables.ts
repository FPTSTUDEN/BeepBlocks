/**
 * Typed Blockly variables.
 *
 * A Blockly variable's `type` is the type key of the IR type it holds (`number`,
 * `list:path`, …) or `''` when unknown. Blockly matches names case-insensitively within one
 * type, but IR names are case-sensitive, so a second name that differs only in case gets the
 * type `key~2` (`~3`, …). `variableTypeKey` strips that suffix.
 */
import * as Blockly from 'blockly/core';

export type VariableModel = Blockly.IVariableModel<Blockly.IVariableState>;

export function variableTypeKey(variable: VariableModel): string {
  const t = variable.getType();
  const cut = t.indexOf('~');
  return cut >= 0 ? t.slice(0, cut) : t;
}

/** Returns the variable named exactly `name`, preferring type `key`; creates it if missing. */
export function ensureVariable(ws: Blockly.Workspace, name: string, key: string): VariableModel {
  const map = ws.getVariableMap();
  const all = map.getAllVariables();
  const exact = all.filter((v) => v.getName() === name);
  const sameType = exact.find((v) => variableTypeKey(v) === key);
  if (sameType) return sameType;
  if (exact.length > 0 && key === '') return exact[0]!;
  let type = key;
  for (let n = 2; ; n++) {
    const clash = map.getVariable(name, type);
    if (!clash) break;
    if (clash.getName() === name) return clash;
    type = `${key}~${n}`;
  }
  return map.createVariable(name, type);
}

/** A variable dropdown field accepting variables of every type. */
export function variableField(defaultName: string): Blockly.FieldVariable {
  return new Blockly.FieldVariable(defaultName, undefined, null, '');
}

export function variableNameOf(block: Blockly.Block, field: string): string {
  const f = block.getField(field);
  if (f instanceof Blockly.FieldVariable) return f.getVariable()?.getName() ?? '';
  return '';
}

export function setVariableField(
  block: Blockly.Block,
  field: string,
  name: string,
  key: string,
): void {
  const v = ensureVariable(block.workspace, name, key);
  block.setFieldValue(v.getId(), field);
}
