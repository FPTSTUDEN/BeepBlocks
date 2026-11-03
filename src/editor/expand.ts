/**
 * Expand (design.md §9, Req 4): replace a composite block in place with the primitive blocks
 * of its desugaring, keeping the desugared node ids, as one undoable event group.
 */
import * as Blockly from 'blockly/core';
import { schemaFor, type DesugarFully, type DesugarOne } from '../ir/composites.ts';
import type { NodeId, Program, Stmt } from '../ir/types.ts';
import { B, compositeOfBlockType, compositeExprOfBlockType } from './blocks/blockTypes.ts';
import { grouped } from './blocks/common.ts';
import { BlockBuilder } from './convert/irToWs.ts';
import { wsToIr } from './convert/wsToIr.ts';
import { expandExpressionFully, expandExpressionOne } from '../composites/index.ts';

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
  return compositeOfBlockType(block.type) !== null || compositeExprOfBlockType(block.type) !== null;
}

function findStmt(stmts: readonly Stmt[], id: NodeId): Stmt | null {
  for (const s of stmts) {
    if (s.id === id) return s;
    const bodies =
      s.kind === 'if' ? [s.then, s.else] :
      s.kind === 'while' || s.kind === 'forEach' ? [s.body] :
      s.kind === 'composite' ? Object.values(s.bodies) : [];
    for (const body of bodies) {
      const found = findStmt(body, id);
      if (found) return found;
    }
  }
  return null;
}

function replaceBlockWithStmts(
  ws: Blockly.Workspace,
  block: Blockly.Block,
  after: Program,
  stmts: readonly Stmt[],
): void {
  const root = block.getRootBlock();
  const scope = root.type === B.function ? String(root.getFieldValue('NAME') ?? '') : null;
  grouped(() => {
    const prevConn = block.previousConnection?.targetConnection ?? null;
    const next = block.getNextBlock();
    const xy = block.getRelativeToSurfaceXY();
    if (next) next.unplug(false);
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
}

function expandExpressionResult(
  ws: Blockly.Workspace,
  blockId: NodeId,
  fully = false,
): ExpandResult {
  const { program } = wsToIr(ws);
  const expansion = fully
    ? expandExpressionFully(program, blockId)
    : expandExpressionOne(program, blockId);
  const anchor = findStmt(expansion.program.body, expansion.result.anchor) ??
    expansion.program.functions.map((f) => findStmt(f.body, expansion.result.anchor)).find((s): s is Stmt => s !== null);
  if (!anchor) throw new Error(`Expression expansion anchor "${expansion.result.anchor}" is missing.`);
  const block = ws.getBlockById(expansion.result.anchor);
  if (!block) throw new Error(`Expression expansion anchor "${expansion.result.anchor}" is not attached.`);
  replaceBlockWithStmts(ws, block, expansion.program, expansion.replacement);
  return { ok: true, stmts: expansion.replacement };
}

export function expandComposite(
  ws: Blockly.Workspace,
  blockId: NodeId,
  desugarOne: DesugarOne,
): ExpandResult {
  const block = ws.getBlockById(blockId);
  if (!block || !isExpandable(block))
    return { ok: false, error: 'Only composite blocks can be expanded.' };
  const { program } = wsToIr(ws);
  if (compositeExprOfBlockType(block.type) !== null) {
    try {
      return expandExpressionResult(ws, blockId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
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
  replaceBlockWithStmts(ws, block, replaceStmt(program, blockId, stmts), stmts);
  return { ok: true, stmts };
}

// ------------------------------------------------------------ context menu

const EXPAND_ITEM = 'bp_expand_composite';
const EXPAND_ACTIONS_ITEM = 'bp_expand_actions';
const EXPAND_ONE_ITEM = 'bp_expand_one_level';
const handlers = new WeakMap<Blockly.Workspace, (blockId: NodeId) => void>();
const oneDesugarHandlers = new WeakMap<Blockly.Workspace, DesugarOne>();
const fullHandlers = new WeakMap<Blockly.Workspace, DesugarFully>();

/** Enables the "Expand into basic blocks" context menu item for `ws`. */
export function setExpandHandler(ws: Blockly.Workspace, handler: ((id: NodeId) => void) | null) {
  if (handler) handlers.set(ws, handler);
  else handlers.delete(ws);
  registerExpandMenuItem();
}

export function setOneDesugarHandler(ws: Blockly.Workspace, handler: DesugarOne | null): void {
  if (handler) oneDesugarHandlers.set(ws, handler);
  else oneDesugarHandlers.delete(ws);
  registerExpandMenuItem();
}

export function setFullExpandHandler(ws: Blockly.Workspace, handler: DesugarFully | null): void {
  if (handler) fullHandlers.set(ws, handler);
  else fullHandlers.delete(ws);
  registerExpandMenuItem();
}

export function registerExpandMenuItem(): void {
  const registry = Blockly.ContextMenuRegistry.registry;
  const commonPrecondition = (scope: Blockly.ContextMenuRegistry.Scope): 'hidden' | 'enabled' => {
    const b = scope.block;
    if (!b || !isExpandable(b) || b.isInFlyout || b.workspace.isReadOnly()) return 'hidden';
    return 'enabled';
  };
  if (!registry.getItem(EXPAND_ITEM)) registry.register({
    id: EXPAND_ITEM,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    weight: -1,
    displayText: 'Expand into basic blocks',
    preconditionFn: (scope) => {
      const b = scope.block;
      return commonPrecondition(scope) === 'enabled' && b &&
        (fullHandlers.has(b.workspace) || handlers.has(b.workspace)) ? 'enabled' : 'hidden';
    },
    callback: (scope) => {
      const b = scope.block;
      if (!b) return;
      const full = fullHandlers.get(b.workspace);
      if (full) {
        try {
          const result = full(wsToIr(b.workspace).program, b.id);
          const expanded = result.kind === 'stmt'
            ? expandComposite(b.workspace, b.id, () => result.stmts)
            : expandExpressionResult(b.workspace, b.id, true);
          if (!expanded.ok) Blockly.dialog.alert(expanded.error);
          return;
        } catch (err) {
          Blockly.dialog.alert(err instanceof Error ? err.message : String(err));
          return;
        }
      }
      handlers.get(b.workspace)?.(b.id);
    },
  });
  if (!registry.getItem(EXPAND_ACTIONS_ITEM)) registry.register({
    id: EXPAND_ACTIONS_ITEM,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    weight: -2,
    displayText: 'Expand into actions',
    preconditionFn: (scope) => {
      const b = scope.block;
      const name = b ? compositeOfBlockType(b.type) : null;
      if (commonPrecondition(scope) !== 'enabled' || !name || schemaFor(name).level !== 'task')
        return 'hidden';
      return oneDesugarHandlers.has(b!.workspace) ? 'enabled' : 'hidden';
    },
    callback: (scope) => {
      const b = scope.block;
      const one = b && oneDesugarHandlers.get(b.workspace);
      if (!b || !one) return;
      const expanded = expandComposite(b.workspace, b.id, one);
      if (!expanded.ok) Blockly.dialog.alert(expanded.error);
    },
  });
  if (!registry.getItem(EXPAND_ONE_ITEM)) registry.register({
    id: EXPAND_ONE_ITEM,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    weight: -3,
    displayText: 'Expand one level',
    preconditionFn: (scope) => {
      const b = scope.block;
      const name = b ? compositeOfBlockType(b.type) : null;
      const one = b && oneDesugarHandlers.get(b.workspace);
      if (commonPrecondition(scope) !== 'enabled' || !name || schemaFor(name).level !== 'action' || !one)
        return 'hidden';
      try {
        const result = one(wsToIr(b.workspace).program, b.id);
        const hasNested = result.some((s) => JSON.stringify(s).includes('"kind":"composite"') || JSON.stringify(s).includes('"kind":"compositeExpr"'));
        return hasNested ? 'enabled' : 'hidden';
      } catch {
        return 'hidden';
      }
    },
    callback: (scope) => {
      const b = scope.block;
      const one = b && oneDesugarHandlers.get(b.workspace);
      if (!b || !one) return;
      const expanded = expandComposite(b.workspace, b.id, one);
      if (!expanded.ok) Blockly.dialog.alert(expanded.error);
    },
  });
}
