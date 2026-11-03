/**
 * IR → workspace (design.md §9): used for loading projects and for Expand.
 *
 * Every block gets its node's id. Nodes that have no block of their own store their ids in the
 * block that shows them (see blocks/common.ts). Children whose type check rejects the socket
 * (only possible for ill-typed IR) are left as loose blocks, with a warning.
 */
import * as Blockly from 'blockly/core';
import type {
  Expr,
  FunctionDef,
  Lit,
  NodeId,
  OpExpr,
  Program,
  Stmt,
  Type,
} from '../../ir/types.ts';
import { OPS } from '../../ir/ops.ts';
import {
  schemaFor,
  getBind,
  COMPOSITE_EXPR_SCHEMAS,
  type CompositeStmt,
  type CompositeExpr,
} from '../../ir/composites.ts';
import { typecheck } from '../../ir/validate.ts';
import type { Layout } from '../layout.ts';
import {
  B,
  compositeBlockType,
  compositeExprBlockType,
  opBlockType,
} from '../blocks/blockTypes.ts';
import { RUN_BLOCK_ID, setNodeIdFor } from '../blocks/common.ts';
import { fieldToBlockly } from '../blocks/composites.ts';
import { formatNumber, setFloatFlag } from '../blocks/expressions.ts';
import { NO_RETURN, setCallSpec, setDefParams, type CallSpec } from '../blocks/functions.ts';
import { setAssignHint, setIfArms, setIfElse } from '../blocks/statements.ts';
import { setPropertyIds, setReadyIds, setSizeBytes, setTextListItems } from '../blocks/views.ts';
import { typeKey } from '../blocks/typeKeys.ts';
import { setVariableField } from '../blocks/variables.ts';

export interface IrToWsResult {
  warnings: string[];
}

type Scope = string | null;

/** Builds blocks for IR nodes into a workspace. Events should be disabled by the caller. */
export class BlockBuilder {
  readonly warnings: string[] = [];
  readonly created: Blockly.Block[] = [];
  /** Loose blocks that could not be connected. */
  readonly loose: Blockly.Block[] = [];
  private readonly fns: Map<string, FunctionDef>;
  private readonly varTypes: Map<string | null, Map<string, Type>>;

  constructor(
    private readonly ws: Blockly.Workspace,
    program: Program,
  ) {
    this.fns = new Map(program.functions.map((f) => [f.name, f]));
    this.varTypes = typecheck(program).varTypes;
  }

  make(type: string, id: NodeId): Blockly.Block {
    if (this.ws.getBlockById(id)) this.warnings.push(`Two blocks share the id "${id}".`);
    const b = this.ws.newBlock(type, id);
    this.created.push(b);
    return b;
  }

  private varKey(scope: Scope, name: string): string {
    const t = this.varTypes.get(scope)?.get(name);
    return t ? typeKey(t) : '';
  }

  private setVar(b: Blockly.Block, field: string, name: string, scope: Scope): void {
    if (name) setVariableField(b, field, name, this.varKey(scope, name));
  }

  private attachValue(parent: Blockly.Block, input: string, child: Blockly.Block | null): void {
    if (!child) return;
    const conn = parent.getInput(input)?.connection ?? null;
    const out = child.outputConnection;
    if (conn && out && this.ws.connectionChecker.canConnect(out, conn, false)) {
      conn.connect(out);
    } else {
      this.warnings.push(
        `Block "${child.id}" does not fit into "${parent.id}" and was left loose.`,
      );
      this.loose.push(child);
    }
  }

  attachStmts(conn: Blockly.Connection | null, first: Blockly.Block | null): void {
    if (!first) return;
    const prev = first.previousConnection;
    if (conn && prev && this.ws.connectionChecker.canConnect(prev, conn, false)) conn.connect(prev);
    else this.loose.push(first);
  }

  /** Builds a statement list; returns the first and last block (null if empty). */
  chain(
    stmts: readonly Stmt[],
    scope: Scope,
  ): { first: Blockly.Block | null; last: Blockly.Block | null } {
    let first: Blockly.Block | null = null;
    let last: Blockly.Block | null = null;
    for (const s of stmts) {
      const b = this.stmt(s, scope);
      if (!b) continue;
      if (last) this.attachStmts(last.nextConnection, b);
      else first = b;
      last = b;
    }
    return { first, last };
  }

  private body(b: Blockly.Block, input: string, stmts: readonly Stmt[] | undefined, scope: Scope) {
    if (!stmts || stmts.length === 0) return;
    this.attachStmts(b.getInput(input)?.connection ?? null, this.chain(stmts, scope).first);
  }

  stmt(s: Stmt, scope: Scope): Blockly.Block | null {
    switch (s.kind) {
      case 'assign': {
        const b = this.make(B.assign, s.id);
        setAssignHint(b, s.hint);
        this.setVar(b, 'VAR', s.name, scope);
        this.attachValue(b, 'VALUE', this.expr(s.value, scope));
        return b;
      }
      case 'if': {
        const b = this.make(B.if, s.id);
        const arms: (typeof s)[] = [];
        let finalElse: Stmt[] = s.else;
        let next = finalElse.length === 1 && finalElse[0]?.kind === 'if' ? finalElse[0] : null;
        while (next) {
          arms.push(next);
          finalElse = next.else;
          next = finalElse.length === 1 && finalElse[0]?.kind === 'if' ? finalElse[0] : null;
        }
        if (arms.length)
          setIfArms(
            b,
            arms.map((x) => x.id),
          );
        else setIfElse(b, (s.else ?? []).length > 0);
        this.attachValue(b, 'COND', this.expr(s.cond, scope));
        this.body(b, 'THEN', s.then, scope);
        arms.forEach((arm, i) => {
          this.attachValue(b, `ELSE_IF_COND${i + 1}`, this.expr(arm.cond, scope));
          this.body(b, `ELSE_IF_THEN${i + 1}`, arm.then, scope);
        });
        this.body(b, 'ELSE', arms.length ? finalElse : s.else, scope);
        return b;
      }
      case 'while': {
        const b = this.make(B.while, s.id);
        this.attachValue(b, 'COND', this.expr(s.cond, scope));
        this.body(b, 'BODY', s.body, scope);
        return b;
      }
      case 'forEach': {
        const b = this.make(B.forEach, s.id);
        this.setVar(b, 'VAR', s.name, scope);
        this.attachValue(b, 'LIST', this.expr(s.list, scope));
        this.body(b, 'BODY', s.body, scope);
        return b;
      }
      case 'return': {
        const b = this.make(B.return, s.id);
        if (s.value) this.attachValue(b, 'VALUE', this.expr(s.value, scope));
        return b;
      }
      case 'print': {
        const b = this.make(B.print, s.id);
        this.attachValue(b, 'VALUE', this.expr(s.value, scope));
        return b;
      }
      case 'do':
        return this.doStmt(s.id, s.expr, scope);
      case 'composite':
        return this.composite(s, scope);
    }
  }

  private doStmt(id: NodeId, e: Expr | null, scope: Scope): Blockly.Block {
    if (e && e.kind === 'op' && OPS[e.op]?.returns === null) {
      const b = this.op(e, scope, id);
      setNodeIdFor(b, 'expr', e.id);
      return b;
    }
    if (e && e.kind === 'call' && this.fns.get(e.fn)?.returns === null) {
      const b = this.call(e.fn, e.args, scope, B.callStmt, id);
      setNodeIdFor(b, 'expr', e.id);
      return b;
    }
    const b = this.make(B.do, id);
    if (e) this.attachValue(b, 'EXPR', this.expr(e, scope));
    return b;
  }

  private composite(s: CompositeStmt, scope: Scope): Blockly.Block {
    const schema = schemaFor(s.name);
    const b = this.make(compositeBlockType(s.name), s.id);
    for (const f of schema.fields) {
      const v = f.key in s.fields ? (s.fields[f.key] ?? null) : f.default;
      b.setFieldValue(fieldToBlockly(f, v), `F_${f.key}`);
    }
    for (const inp of schema.inputs) {
      const e = s.inputs[inp.key];
      if (e) this.attachValue(b, `I_${inp.key}`, this.expr(e, scope));
    }
    for (const body of schema.bodies) this.body(b, `S_${body.key}`, s.bodies[body.key], scope);
    for (const bind of schema.binds) b.setFieldValue(getBind(s, bind.key), `B_${bind.key}`);
    const known = new Set([
      ...schema.fields.map((f) => f.key),
      ...schema.inputs.map((i) => i.key),
      ...schema.bodies.map((x) => x.key),
      ...schema.binds.map((x) => x.key),
    ]);
    for (const key of [
      ...Object.keys(s.fields),
      ...Object.keys(s.inputs),
      ...Object.keys(s.bodies),
      ...Object.keys(s.binds),
    ]) {
      if (!known.has(key))
        this.warnings.push(`Task block "${s.id}": unknown part "${key}" dropped.`);
    }
    return b;
  }

  // ----------------------------------------------------------- expressions

  expr(e: Expr | null, scope: Scope): Blockly.Block | null {
    if (!e) return null;
    if (
      e.kind === 'op' &&
      ['name', 'stem', 'ext', 'size', 'modified', 'readText', 'isFolder'].some(
        (x) => e.op === `fs.${x}`,
      )
    ) {
      const arg = e.args[0];
      if (arg?.kind === 'var') {
        const b = this.make(B.property, e.id);
        b.setFieldValue(e.op.slice(3), 'PROPERTY');
        this.setVar(b, 'VAR', arg.name, scope);
        setPropertyIds(b, { variable: arg.id });
        return b;
      }
    }
    if (
      e.kind === 'op' &&
      e.op === 'text.wildcard' &&
      e.args[0]?.kind === 'op' &&
      e.args[1]?.kind === 'lit' &&
      typeof e.args[1].value === 'string'
    ) {
      const p = e.args[0];
      if (p.op === 'fs.name' && p.args[0]?.kind === 'var') {
        const b = this.make(B.readyCondition, e.id);
        b.setFieldValue('nameMatches', 'TEST');
        this.setVar(b, 'VAR', p.args[0].name, scope);
        b.setFieldValue(e.args[1].value, 'VALUE');
        setReadyIds(b, { property: p.id, variable: p.args[0].id, value: e.args[1].id });
        return b;
      }
    }
    if (
      e.kind === 'op' &&
      e.op === 'text.contains' &&
      e.args[0]?.kind === 'op' &&
      e.args[0].op === 'fs.readText' &&
      e.args[0].args[0]?.kind === 'var' &&
      e.args[1]?.kind === 'lit' &&
      typeof e.args[1].value === 'string'
    ) {
      const b = this.make(B.readyCondition, e.id);
      b.setFieldValue('textContains', 'TEST');
      this.setVar(b, 'VAR', e.args[0].args[0].name, scope);
      b.setFieldValue(e.args[1].value, 'VALUE');
      setReadyIds(b, {
        property: e.args[0].id,
        variable: e.args[0].args[0].id,
        value: e.args[1].id,
      });
      return b;
    }
    if (
      e.kind === 'binary' &&
      e.op === '==' &&
      e.left.kind === 'op' &&
      e.left.op === 'text.lower' &&
      e.left.args[0]?.kind === 'op' &&
      e.left.args[0].op === 'fs.ext' &&
      e.left.args[0].args[0]?.kind === 'var' &&
      e.right.kind === 'lit' &&
      typeof e.right.value === 'string'
    ) {
      const b = this.make(B.readyCondition, e.id);
      b.setFieldValue('extensionIs', 'TEST');
      this.setVar(b, 'VAR', e.left.args[0].args[0].name, scope);
      b.setFieldValue(e.right.value, 'VALUE');
      setReadyIds(b, {
        property: e.left.args[0].id,
        wrapper: e.left.id,
        variable: e.left.args[0].args[0].id,
        value: e.right.id,
      });
      return b;
    }
    if (
      e.kind === 'binary' &&
      ['>', '>=', '<', '<='].includes(e.op) &&
      e.left.kind === 'op' &&
      e.left.op === 'fs.modified' &&
      e.left.args[0]?.kind === 'var' &&
      e.right.kind === 'date'
    ) {
      const b = this.make(B.readyCondition, e.id);
      b.setFieldValue(
        e.op === '>'
          ? 'modifiedGt'
          : e.op === '>='
            ? 'modifiedGe'
            : e.op === '<'
              ? 'modifiedLt'
              : 'modifiedLe',
        'TEST',
      );
      this.setVar(b, 'VAR', e.left.args[0].name, scope);
      b.setFieldValue(e.right.iso, 'VALUE');
      setReadyIds(b, { property: e.left.id, variable: e.left.args[0].id, value: e.right.id });
      return b;
    }
    switch (e.kind) {
      case 'lit': {
        if (typeof e.value === 'number') {
          const b = this.make(B.number, e.id);
          const float = e.float === true;
          setFloatFlag(b, float && !Number.isInteger(e.value));
          b.setFieldValue(formatNumber(e.value, float), 'NUM');
          return b;
        }
        if (typeof e.value === 'string') {
          const b = this.make(B.text, e.id);
          b.setFieldValue(e.value, 'TEXT');
          return b;
        }
        const b = this.make(B.bool, e.id);
        b.setFieldValue(e.value ? 'TRUE' : 'FALSE', 'BOOL');
        return b;
      }
      case 'date': {
        const b = this.make(B.date, e.id);
        b.setFieldValue(e.iso, 'ISO');
        return b;
      }
      case 'list': {
        const textItems = e.items.filter(
          (x): x is Lit => x.kind === 'lit' && typeof x.value === 'string',
        );
        if (e.itemType.t === 'text' && textItems.length === e.items.length) {
          const b = this.make(B.textList, e.id);
          setTextListItems(
            b,
            textItems.map((x) => String(x.value)),
            textItems.map((x) => x.id),
          );
          return b;
        }
        const b = this.make(B.list, e.id);
        b.loadExtraState?.({ items: e.items.length });
        const key = typeKey(e.itemType);
        b.setFieldValue(key, 'TYPE');
        if (b.getFieldValue('TYPE') !== key) {
          this.warnings.push(`List "${e.id}": item type "${key}" cannot be shown.`);
        }
        e.items.forEach((item, i) => this.attachValue(b, `ITEM${i}`, this.expr(item, scope)));
        return b;
      }
      case 'var': {
        const b = this.make(B.var, e.id);
        this.setVar(b, 'VAR', e.name, scope);
        return b;
      }
      case 'binary': {
        if (e.op === 'and' || e.op === 'or') {
          const parts: Expr[] = [];
          const ids: string[] = [];
          const collect = (x: Expr): void => {
            if (x.kind === 'binary' && x.op === e.op) {
              collect(x.left);
              parts.push(x.right);
              ids.push(x.id);
            } else if (parts.length === 0) parts.push(x);
          };
          collect(e);
          if (parts.length >= 2) {
            const b = this.make(e.op === 'and' ? B.allOf : B.anyOf, e.id);
            b.loadExtraState?.({ count: parts.length, ids });
            parts.forEach((x, i) => this.attachValue(b, `C${i}`, this.expr(x, scope)));
            return b;
          }
        }
        if (
          ['>', '>=', '<', '<='].includes(e.op) &&
          e.left.kind === 'op' &&
          e.left.op === 'fs.size' &&
          e.left.args[0]?.kind === 'var' &&
          e.right.kind === 'lit' &&
          typeof e.right.value === 'number'
        ) {
          const b = this.make(B.readyCondition, e.id);
          const test =
            e.op === '>' ? 'sizeGt' : e.op === '>=' ? 'sizeGe' : e.op === '<' ? 'sizeLt' : 'sizeLe';
          b.setFieldValue(test, 'TEST');
          this.setVar(b, 'VAR', e.left.args[0].name, scope);
          setSizeBytes(b, e.right.value);
          setReadyIds(b, { property: e.left.id, variable: e.left.args[0].id, value: e.right.id });
          return b;
        }
        const type =
          e.op === 'and' || e.op === 'or'
            ? B.logic
            : ['==', '!=', '<', '<=', '>', '>='].includes(e.op)
              ? B.compare
              : B.arith;
        const b = this.make(type, e.id);
        b.setFieldValue(e.op, 'OP');
        this.attachValue(b, 'A', this.expr(e.left, scope));
        this.attachValue(b, 'B', this.expr(e.right, scope));
        return b;
      }
      case 'unary': {
        const b = this.make(e.op === 'not' ? B.not : B.neg, e.id);
        this.attachValue(b, 'X', this.expr(e.arg, scope));
        return b;
      }
      case 'op':
        if (OPS[e.op]?.returns === null) {
          this.warnings.push(`"${e.op}" is a step and cannot be used as a value; it was dropped.`);
          return null;
        }
        return this.op(e, scope, e.id);
      case 'call':
        return this.call(e.fn, e.args, scope, B.call, e.id);
      case 'compositeExpr':
        return this.compositeExpr(e, scope);
    }
  }

  private compositeExpr(e: CompositeExpr, scope: Scope): Blockly.Block {
    const schema = COMPOSITE_EXPR_SCHEMAS[e.name];
    const b = this.make(compositeExprBlockType(e.name), e.id);
    for (const f of schema.fields) {
      const v = f.key in e.fields ? (e.fields[f.key] ?? null) : f.default;
      b.setFieldValue(fieldToBlockly(f, v), `F_${f.key}`);
    }
    for (const inp of schema.inputs) {
      const child = e.inputs[inp.key];
      if (child) this.attachValue(b, `I_${inp.key}`, this.expr(child, scope));
    }
    for (const bind of schema.binds) b.setFieldValue(getBind(e, bind.key), `B_${bind.key}`);
    return b;
  }

  private op(e: OpExpr, scope: Scope, blockId: NodeId): Blockly.Block {
    const sig = OPS[e.op];
    const b = this.make(opBlockType(e.op), blockId);
    if (e.args.length !== sig.args.length) {
      this.warnings.push(
        `"${e.op}" (${e.id}) has ${e.args.length} inputs; expected ${sig.args.length}.`,
      );
    }
    sig.args.forEach((arg, i) => {
      const x = e.args[i];
      if (!x) return;
      if (!arg.literal) {
        this.attachValue(b, `A${i}`, this.expr(x, scope));
        return;
      }
      if (x.kind !== 'lit') {
        this.warnings.push(
          `"${arg.name}" of "${e.op}" (${e.id}) must be typed in; it was dropped.`,
        );
        return;
      }
      setNodeIdFor(b, `arg${i}`, x.id);
      b.setFieldValue(
        typeof x.value === 'boolean' ? (x.value ? 'TRUE' : 'FALSE') : String(x.value),
        `L${i}`,
      );
    });
    return b;
  }

  private call(fn: string, args: readonly (Expr | null)[], scope: Scope, type: string, id: NodeId) {
    const def = this.fns.get(fn);
    const spec: CallSpec = def
      ? {
          fn,
          fnId: def.id,
          params: def.params.map((p) => ({ name: p.name, type: typeKey(p.type) })),
          returns: def.returns ? typeKey(def.returns) : NO_RETURN,
        }
      : { fn, params: args.map((_a, i) => ({ name: `input${i + 1}`, type: null })), returns: null };
    if (def && def.params.length !== args.length) {
      this.warnings.push(
        `Call "${id}" to "${fn}" has ${args.length} inputs; expected ${def.params.length}.`,
      );
    }
    const b = this.make(type, id);
    setCallSpec(b, spec);
    spec.params.forEach((_p, i) =>
      this.attachValue(b, `ARG${i}`, this.expr(args[i] ?? null, scope)),
    );
    return b;
  }

  // ------------------------------------------------------------- functions

  fn(f: FunctionDef): Blockly.Block {
    const b = this.make(B.function, f.id);
    b.setFieldValue(f.name, 'NAME');
    setDefParams(
      b,
      f.params.map((p) => ({ name: p.name, type: typeKey(p.type) })),
    );
    b.setFieldValue(f.returns ? typeKey(f.returns) : NO_RETURN, 'RETURNS');
    this.attachStmts(b.nextConnection, this.chain(f.body, f.name).first);
    return b;
  }

  /** Initializes and renders created blocks on a rendered workspace. */
  render(): void {
    if (!this.ws.rendered) return;
    for (const b of this.created) (b as Blockly.BlockSvg).initSvg();
    for (const b of this.created) {
      if (!b.getParent()) (b as Blockly.BlockSvg).render();
    }
  }
}

/**
 * Replaces the workspace contents with `program`. Runs with events disabled and clears the undo
 * stack, so loading is not an undoable edit.
 */
export function irToWs(program: Program, layout: Layout, ws: Blockly.Workspace): IrToWsResult {
  const wasEnabled = Blockly.Events.isEnabled();
  if (wasEnabled) Blockly.Events.disable();
  let builder: BlockBuilder;
  try {
    ws.clear();
    builder = new BlockBuilder(ws, program);
    const tops: { block: Blockly.Block; id: string }[] = [];
    const run = builder.make(B.run, RUN_BLOCK_ID);
    builder.attachStmts(run.nextConnection, builder.chain(program.body, null).first);
    tops.push({ block: run, id: RUN_BLOCK_ID });
    for (const f of program.functions) tops.push({ block: builder.fn(f), id: f.id });
    builder.render();
    placeTops(tops, layout, builder.loose);
  } finally {
    if (wasEnabled) Blockly.Events.enable();
  }
  ws.clearUndo();
  return { warnings: builder.warnings };
}

const GAP = 48;

function heightOf(b: Blockly.Block): number {
  if (b instanceof Blockly.BlockSvg) return b.getHeightWidth().height;
  return 160;
}

function placeTops(
  tops: { block: Blockly.Block; id: string }[],
  layout: Layout,
  loose: Blockly.Block[],
): void {
  let y = 24;
  for (const { block, id } of tops) {
    const pos = layout[id];
    if (pos) block.moveBy(pos.x, pos.y);
    else {
      block.moveBy(24, y);
      y += heightOf(block) + GAP;
    }
    if (pos) y = Math.max(y, pos.y + heightOf(block) + GAP);
  }
  let x = 480;
  for (const b of loose) {
    if (b.getParent()) continue;
    b.moveBy(x, 24);
    x += 40;
  }
}
