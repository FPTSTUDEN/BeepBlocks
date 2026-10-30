/** Shared helpers for block definitions: registration, stored node ids, mutations. */
import * as Blockly from 'blockly/core';
import type { NodeId } from '../../ir/types.ts';

/** Fixed id of the single "when run" hat block. Layout key for its position. */
export const RUN_BLOCK_ID = 'when-run';

/** Block style / toolbox category style names (see theme.ts). */
export const STYLE = {
  program: 'bp_program',
  tasks: 'bp_tasks',
  files: 'bp_files',
  logic: 'bp_logic',
  loops: 'bp_loops',
  variables: 'bp_variables',
  lists: 'bp_lists',
  text: 'bp_text',
  math: 'bp_math',
  functions: 'bp_functions',
} as const;
export type StyleName = (typeof STYLE)[keyof typeof STYLE];

export type ExtraState = Record<string, unknown>;
export type MenuOptions = Array<
  | Blockly.ContextMenuRegistry.ContextMenuOption
  | Blockly.ContextMenuRegistry.LegacyContextMenuOption
>;

export interface BlockSpec {
  init(block: Blockly.Block): void;
  /** Block-specific extra state (merged with stored ids). */
  save?(block: Blockly.Block): ExtraState | null;
  load?(block: Blockly.Block, state: ExtraState): void;
  /** Extra context menu options. */
  menu?(block: Blockly.Block, options: MenuOptions): void;
}

const specs = new Map<string, BlockSpec>();

/** Registers a block type. Idempotent (re-registering replaces the definition). */
export function defineBlock(type: string, spec: BlockSpec): void {
  specs.set(type, spec);
  Blockly.Blocks[type] = {
    init(this: Blockly.Block) {
      spec.init(this);
    },
    saveExtraState(this: Blockly.Block): ExtraState | null {
      const own = spec.save?.(this) ?? null;
      const ids = storedIds.get(this);
      if (ids && Object.keys(ids.ids).length > 0) {
        return { ...(own ?? {}), ids: { ...ids.ids }, owner: ids.owner };
      }
      return own;
    },
    loadExtraState(this: Blockly.Block, state: unknown) {
      const s = isRecord(state) ? state : {};
      if (isRecord(s.ids) && typeof s.owner === 'string') {
        const ids: Record<string, NodeId> = {};
        for (const [k, v] of Object.entries(s.ids)) if (typeof v === 'string') ids[k] = v;
        storedIds.set(this, { owner: s.owner, ids });
      }
      spec.load?.(this, s);
    },
    customContextMenu(this: Blockly.Block, options: MenuOptions) {
      spec.menu?.(this, options);
    },
  };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ------------------------------------------------------------ stored node ids

/**
 * Some IR nodes have no block of their own: the op inside a statement-style op block
 * (`Do.expr`) and literal arguments shown as fields. Their ids live in the block's extra
 * state together with the block id they were stored for (`owner`). A copied block gets a new
 * id, so its stale stored ids are ignored and derived ids `${blockId}/${key}` are used.
 */
const storedIds = new WeakMap<Blockly.Block, { owner: NodeId; ids: Record<string, NodeId> }>();

export function nodeIdFor(block: Blockly.Block, key: string): NodeId {
  const s = storedIds.get(block);
  if (s && s.owner === block.id) {
    const id = s.ids[key];
    if (id) return id;
  }
  return `${block.id}/${key}`;
}

export function setNodeIdFor(block: Blockly.Block, key: string, id: NodeId): void {
  let s = storedIds.get(block);
  if (!s || s.owner !== block.id) {
    s = { owner: block.id, ids: {} };
    storedIds.set(block, s);
  }
  if (id === `${block.id}/${key}`) delete s.ids[key];
  else s.ids[key] = id;
}

// ------------------------------------------------------------------ mutations

/** Applies a shape change and records it as an undoable mutation event. */
export function mutate(block: Blockly.Block, change: () => void): void {
  const save = () => JSON.stringify(block.saveExtraState?.() ?? null);
  const before = save();
  change();
  const after = save();
  if (before !== after && Blockly.Events.isEnabled()) {
    Blockly.Events.fire(new Blockly.Events.BlockChange(block, 'mutation', null, before, after));
  }
}

const svgIcon = (path: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
      `<circle cx="8" cy="8" r="7.5" fill="#ffffff" fill-opacity="0.9"/>` +
      `<path d="${path}" stroke="#1f2937" stroke-width="2" stroke-linecap="round"/></svg>`,
  );
const PLUS = svgIcon('M8 4v8M4 8h8');
const MINUS = svgIcon('M4 8h8');

/** Small clickable "+"/"−" image field. */
export function iconButton(
  kind: 'plus' | 'minus',
  alt: string,
  onClick: (block: Blockly.Block) => void,
) {
  return new Blockly.FieldImage(kind === 'plus' ? PLUS : MINUS, 16, 16, alt, (field) => {
    const block = field.getSourceBlock();
    if (!block || !block.isEditable() || block.isInFlyout) return;
    grouped(() => onClick(block));
  });
}

/** Runs `run` inside one event group (one undo step). */
export function grouped(run: () => void): void {
  const existing = Blockly.Events.getGroup();
  if (!existing) Blockly.Events.setGroup(true);
  try {
    run();
  } finally {
    if (!existing) Blockly.Events.setGroup(false);
  }
}

/** Adds a context-menu action. */
export function menuItem(
  options: MenuOptions,
  text: string,
  enabled: boolean,
  run: () => void,
): void {
  options.push({ text, enabled, callback: () => grouped(run) });
}

/** Default number of extra-state numeric entries, clamped. */
export function intIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
