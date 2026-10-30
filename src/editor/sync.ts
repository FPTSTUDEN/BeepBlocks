/** Keeps derived workspace state consistent after user edits (call blocks, bound variables). */
import * as Blockly from 'blockly/core';
import { COMPOSITE_NAMES, COMPOSITE_SCHEMAS } from '../ir/composites.ts';
import { B, compositeBlockType } from './blocks/blockTypes.ts';
import { getDefParams, syncCallBlocks } from './blocks/functions.ts';
import { typeKey } from './blocks/typeKeys.ts';
import { ensureVariable } from './blocks/variables.ts';

/** Makes sure every bind name and function input name exists as a (typed) variable. */
export function ensureBoundVariables(ws: Blockly.Workspace): void {
  for (const name of COMPOSITE_NAMES) {
    const schema = COMPOSITE_SCHEMAS[name];
    for (const blk of ws.getBlocksByType(compositeBlockType(name), false)) {
      for (const bind of schema.binds) {
        const v = String(blk.getFieldValue(`B_${bind.key}`) ?? '');
        if (v) ensureVariable(ws, v, typeKey(bind.type));
      }
    }
  }
  for (const def of ws.getBlocksByType(B.function, false)) {
    for (const p of getDefParams(def)) if (p.name) ensureVariable(ws, p.name, p.type ?? '');
  }
}

/** Installs a change listener that syncs call blocks and bound variables. Returns a remover. */
export function attachSync(ws: Blockly.Workspace): () => void {
  const listener = (e: Blockly.Events.Abstract) => {
    // Skip UI events and events replayed by undo/redo (they must not add new undo entries).
    if (e.isUiEvent || !e.recordUndo) return;
    if (e.type === Blockly.Events.BLOCK_FIELD_INTERMEDIATE_CHANGE) return;
    const outer = Blockly.Events.getGroup();
    Blockly.Events.setGroup(e.group || false);
    try {
      syncCallBlocks(ws);
      ensureBoundVariables(ws);
    } finally {
      Blockly.Events.setGroup(outer || false);
    }
  };
  ws.addChangeListener(listener);
  return () => ws.removeChangeListener(listener);
}
