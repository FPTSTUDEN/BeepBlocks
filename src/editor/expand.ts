/**
 * Expand (design.md §9, Req 4): replace a composite block in place with the primitive blocks
 * of its desugaring, keeping the desugared node ids, as one undoable event group.
 */
import * as Blockly from 'blockly/core';
import type { DesugarOne } from '../ir/composites.ts';
import type { NodeId, Program, Stmt } from '../ir/types.ts';
import { B, compositeOfBlockType } from './blocks/blockTypes.ts';
import { grouped } from './blocks/common.ts';
import { BlockBuilder } from './convert/irToWs.ts';
import { wsToIr } from './convert/wsToIr.ts';

export type ExpandResult = { ok: true; stmts: Stmt[] } | { ok: false; error: string };

/** Replaces statement `id` (anywhere in the program) by `replacement`. */
export function replaceStmt(program: Program, id: NodeId, replacement: readonly Stmt[]): Program {
  const list = (stmts: readonly Stmt[]): Stmt[] =>
    stmts.flatMap((s): Stmt[] => (s.id === id ? [...replacement] : [inner(s)]));
  const inner = (s: Stmt): Stmt => {
    switch (s.kind) {
      case 'if':
        return { ...s, then: list(s.then), else: list(s.else) };
      case 'while':
      case 'forEach':
        return { ...s, body: list(s.body) };
      case 'composite':
        return {
          ...s,
          bodies: Object.fromEntries(Object.entries(s.bodies).map(([k, v]) => [k, list(v)])),
        };
      default:
        return s;
    }
  };
  return {
    ...program,
    functions: program.functions.map((f) => ({ ...f, body: list(f.body) })),
    body: list(program.body),
  };
}

export function containsStmt(program: Program, id: NodeId): boolean {
  const list = (stmts: readonly Stmt[]): boolean => stmts.some(one);
  const one = (s: Stmt): boolean => {
    if (s.id === id) return true;
    switch (s.kind) {
      case 'if':
        return list(s.then) || list(s.else);
      case 'while':
      case 'forEach':
        return list(s.body);
      case 'composite':
        return Object.values(s.bodies).some(list);
      default:
        return false;
    }
  };
  return program.functions.some((f) => list(f.body)) || list(program.body);
}

export function isExpandable(block: Blockly.Block): boolean {
  return compositeOfBlockType(block.type) !== null;
}

export function expandComposite(
  ws: Blockly.Workspace,
  blockId: NodeId,
  desugarOne: DesugarOne,
): ExpandResult {
  const block = ws.getBlockById(blockId);
  if (!block || !isExpandable(block))
    return { ok: false, error: 'Only task blocks can be expanded.' };
  const { program } = wsToIr(ws);
  if (!containsStmt(program, blockId)) {
    return {
      ok: false,
      error: 'Attach this block to "when run" or a function before expanding it.',
    };
  }
  let stmts: Stmt[];
  try {
    stmts = desugarOne(program, blockId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const after = replaceStmt(program, blockId, stmts);
  const root = block.getRootBlock();
  const scope = root.type === B.function ? String(root.getFieldValue('NAME') ?? '') : null;

  grouped(() => {
    const prevConn = block.previousConnection?.targetConnection ?? null;
    const next = block.getNextBlock();
    const xy = block.getRelativeToSurfaceXY();
    if (next) next.unplug(false);
    // Dispose first: the desugaring reuses the ids of the composite's input and body blocks.
    block.dispose(false);

    Blockly.Events.disable();
    let first: Blockly.Block | null;
    let last: Blockly.Block | null;
    let builder: BlockBuilder;
    try {
      builder = new BlockBuilder(ws, after);
      ({ first, last } = builder.chain(stmts, scope));
      builder.render();
    } finally {
      Blockly.Events.enable();
    }
    const roots = [first, ...builder.loose].filter((b): b is Blockly.Block => b !== null);
    for (const r of roots) {
      if (!r.getParent()) Blockly.Events.fire(new Blockly.Events.BlockCreate(r));
    }

    if (first) {
      if (prevConn && first.previousConnection) prevConn.connect(first.previousConnection);
      else first.moveBy(xy.x, xy.y);
    }
    if (next && next.previousConnection) {
      const tail = last ? last.nextConnection : prevConn;
      if (tail) tail.connect(next.previousConnection);
    }
  });
  return { ok: true, stmts };
}

// ------------------------------------------------------------ context menu

const EXPAND_ITEM = 'bp_expand_composite';
const handlers = new WeakMap<Blockly.Workspace, (blockId: NodeId) => void>();

/** Enables the "Expand into basic blocks" context menu item for `ws`. */
export function setExpandHandler(ws: Blockly.Workspace, handler: ((id: NodeId) => void) | null) {
  if (handler) handlers.set(ws, handler);
  else handlers.delete(ws);
  registerExpandMenuItem();
}

export function registerExpandMenuItem(): void {
  const registry = Blockly.ContextMenuRegistry.registry;
  if (registry.getItem(EXPAND_ITEM)) return;
  registry.register({
    id: EXPAND_ITEM,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    weight: -1,
    displayText: 'Expand into basic blocks',
    preconditionFn: (scope) => {
      const b = scope.block;
      if (!b || !isExpandable(b) || b.isInFlyout) return 'hidden';
      if (!handlers.has(b.workspace) || b.workspace.isReadOnly()) return 'hidden';
      return 'enabled';
    },
    callback: (scope) => {
      const b = scope.block;
      if (b) handlers.get(b.workspace)?.(b.id);
    },
  });
}
