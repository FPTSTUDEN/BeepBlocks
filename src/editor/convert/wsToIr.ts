/**
 * Workspace → IR (design.md §9). A custom traversal, not a Blockly code generator.
 *
 * - The stack under the "when run" hat is `program.body`; each "define function" hat is a
 *   `FunctionDef` (in workspace creation order). Any other top-level stack is ignored with a
 *   warning.
 * - Block ids are node ids. Nodes without a block of their own (literal op arguments, the op
 *   inside a statement-style op block) use ids stored in the block; see `aliases`.
 * - An empty value socket becomes a `null` hole in the IR and an editor issue
 *   (`MISSING_INPUT`) on the parent block id. `validateProgram` also reports holes as
 *   `STRUCTURE` errors on the same parent id.
 */
import * as Blockly from 'blockly/core';
import type {
  BinOp,
  CallExpr,
  Expr,
  FunctionDef,
  Lit,
  NodeId,
  OpExpr,
  Program,
  Stmt,
  Type,
} from '../../ir/types.ts';
import type { ValidationError } from '../../ir/errors.ts';
import { OPS, type OpName } from '../../ir/ops.ts';
import {
  schemaFor,
  COMPOSITE_EXPR_SCHEMAS,
  type CompositeStmt,
  type CompositeExpr,
  type CompositeExprName,
  type FieldValue,
} from '../../ir/composites.ts';
import type { Layout } from '../layout.ts';
import {
  B,
  compositeOfBlockType,
  compositeExprOfBlockType,
  opOfBlockType,
} from '../blocks/blockTypes.ts';
import { RUN_BLOCK_ID, nodeIdFor } from '../blocks/common.ts';
import { fieldFromBlockly } from '../blocks/composites.ts';
import { getFloatFlag, listItemCount, parseNumber } from '../blocks/expressions.ts';
import { NO_RETURN, getCallSpec, getDefParams } from '../blocks/functions.ts';
import { isStatementOp } from '../blocks/ops.ts';
import { getAssignHint } from '../blocks/statements.ts';
import { getIfArmIds } from '../blocks/statements.ts';
import {
  allOfCount,
  allOfIds,
  propertyIds,
  readyIds,
  sizeBytes,
  textListIds,
  textListItems,
} from '../blocks/views.ts';
import { parseTypeKey } from '../blocks/typeKeys.ts';
import { variableNameOf } from '../blocks/variables.ts';

export interface WsWarning {
  /** Top block of the ignored stack (or the block concerned). */
  blockId: string;
  message: string;
}

export interface WsToIrResult {
  program: Program;
  layout: Layout;
  warnings: WsWarning[];
  /** Editor-detected errors (empty sockets), reported on the parent block id. */
  issues: ValidationError[];
  /** Node id → id of the block that shows it, for nodes without their own block. */
  aliases: Map<NodeId, string>;
}

/** Placeholder for an empty socket. The IR types cannot express it; see module doc. */
const HOLE = null as unknown as Expr;

export const DETACHED_MESSAGE =
  'These blocks are not attached to "when run" or a function, so they will not run.';

const NUMBER: Type = { t: 'number' };

class Reader {
  readonly warnings: WsWarning[] = [];
  readonly issues: ValidationError[] = [];
  readonly aliases = new Map<NodeId, string>();

  missing(parentId: NodeId, what: string): Expr {
    this.issues.push({
      nodeId: parentId,
      code: 'MISSING_INPUT',
      message: `Fill in the empty slot for ${what}.`,
      severity: 'error',
    });
    return HOLE;
  }

  alias(nodeId: NodeId, block: Blockly.Block): NodeId {
    this.aliases.set(nodeId, block.id);
    return nodeId;
  }

  // ------------------------------------------------------------ statements

  chain(first: Blockly.Block | null): Stmt[] {
    const out: Stmt[] = [];
    for (let b = first; b; b = b.getNextBlock()) {
      if (b.isInsertionMarker()) continue;
      if (!b.isEnabled()) {
        this.warnings.push({ blockId: b.id, message: 'This block is turned off and is skipped.' });
        continue;
      }
      const s = this.stmt(b);
      if (s) out.push(s);
    }
    return out;
  }

  body(b: Blockly.Block, input: string): Stmt[] {
    return this.chain(b.getInputTargetBlock(input));
  }

  stmt(b: Blockly.Block): Stmt | null {
    const id = b.id;
    switch (b.type) {
      case B.assign: {
        const hint = getAssignHint(b);
        const value = this.expr(b, 'VALUE', 'the new value');
        const name = variableNameOf(b, 'VAR');
        return hint
          ? { id, kind: 'assign', name, value, hint: { indexInto: hint.indexInto } }
          : { id, kind: 'assign', name, value };
      }
      case B.if:
        return {
          id,
          kind: 'if',
          cond: this.expr(b, 'COND', 'the condition'),
          then: this.body(b, 'THEN'),
          else: this.ifElse(b),
        };
      case B.while:
        return {
          id,
          kind: 'while',
          cond: this.expr(b, 'COND', 'the condition'),
          body: this.body(b, 'BODY'),
        };
      case B.forEach:
        return {
          id,
          kind: 'forEach',
          name: variableNameOf(b, 'VAR'),
          list: this.expr(b, 'LIST', 'the list'),
          body: this.body(b, 'BODY'),
        };
      case B.return: {
        const target = this.target(b, 'VALUE');
        return { id, kind: 'return', value: target ? this.exprOf(target) : null };
      }
      case B.do: {
        const e = this.expr(b, 'EXPR', 'the step');
        return { id, kind: 'do', expr: e as OpExpr | CallExpr };
      }
      case B.print:
        return { id, kind: 'print', value: this.expr(b, 'VALUE', 'the text to show') };
      case B.callStmt:
        return { id, kind: 'do', expr: this.call(b, this.alias(nodeIdFor(b, 'expr'), b)) };
    }
    const op = opOfBlockType(b.type);
    if (op && isStatementOp(op)) {
      return { id, kind: 'do', expr: this.op(b, op, this.alias(nodeIdFor(b, 'expr'), b)) };
    }
    const composite = compositeOfBlockType(b.type);
    if (composite) return this.composite(b, composite);
    this.warnings.push({ blockId: id, message: `Unknown block "${b.type}" was skipped.` });
    return null;
  }

  ifElse(b: Blockly.Block): Stmt[] {
    const arms = getIfArmIds(b);
    if (!arms.length) return this.body(b, 'ELSE');
    let tail: Stmt[] = this.body(b, 'ELSE');
    for (let i = arms.length - 1; i >= 0; i--) {
      const cond = this.expr(b, `ELSE_IF_COND${i + 1}`, 'the condition');
      const then = this.body(b, `ELSE_IF_THEN${i + 1}`);
      tail = [{ id: arms[i]!, kind: 'if', cond, then, else: tail }];
    }
    return tail;
  }

  composite(b: Blockly.Block, name: CompositeStmt['name']): CompositeStmt {
    const schema = schemaFor(name);
    const fields: Record<string, FieldValue> = {};
    for (const f of schema.fields)
      fields[f.key] = fieldFromBlockly(f, b.getFieldValue(`F_${f.key}`));
    const inputs: Record<string, Expr> = {};
    for (const inp of schema.inputs) {
      const target = this.target(b, `I_${inp.key}`);
      // A missing required input is reported by the validator (MISSING_INPUT on this block).
      if (target) inputs[inp.key] = this.exprOf(target);
    }
    const bodies: Record<string, Stmt[]> = {};
    for (const body of schema.bodies) bodies[body.key] = this.body(b, `S_${body.key}`);
    const binds: Record<string, string> = {};
    for (const bind of schema.binds)
      binds[bind.key] = String(b.getFieldValue(`B_${bind.key}`) ?? '');
    return { id: b.id, kind: 'composite', name, fields, inputs, bodies, binds };
  }

  // ----------------------------------------------------------- expressions

  target(b: Blockly.Block, input: string): Blockly.Block | null {
    const t = b.getInputTargetBlock(input);
    return t && !t.isInsertionMarker() ? t : null;
  }

  expr(parent: Blockly.Block, input: string, what: string): Expr {
    const t = this.target(parent, input);
    return t ? this.exprOf(t) : this.missing(parent.id, what);
  }

  exprOf(b: Blockly.Block): Expr {
    const id = b.id;
    switch (b.type) {
      case B.number: {
        const { value, float } = parseNumber(
          String(b.getFieldValue('NUM') ?? '0'),
          getFloatFlag(b),
        );
        return float ? { id, kind: 'lit', value, float: true } : { id, kind: 'lit', value };
      }
      case B.text:
        return { id, kind: 'lit', value: String(b.getFieldValue('TEXT') ?? '') };
      case B.bool:
        return { id, kind: 'lit', value: b.getFieldValue('BOOL') === 'TRUE' };
      case B.date:
        return { id, kind: 'date', iso: String(b.getFieldValue('ISO') ?? '') };
      case B.list: {
        const items: Expr[] = [];
        for (let i = 0; i < listItemCount(b); i++)
          items.push(this.expr(b, `ITEM${i}`, `item ${i + 1}`));
        const itemType = parseTypeKey(String(b.getFieldValue('TYPE') ?? '')) ?? NUMBER;
        return { id, kind: 'list', itemType, items };
      }
      case B.textList: {
        const values = textListItems(b);
        const ids = textListIds(b);
        ids.forEach((nodeId) => this.alias(nodeId, b));
        return {
          id,
          kind: 'list',
          itemType: { t: 'text' },
          items: values.map((value, i) => ({ id: ids[i] ?? `${id}/item${i}`, kind: 'lit', value })),
        };
      }
      case B.size:
        return { id, kind: 'lit', value: sizeBytes(b) };
      case B.property: {
        const op = String(b.getFieldValue('PROPERTY') ?? 'name');
        this.alias(propertyIds(b).variable, b);
        return {
          id,
          kind: 'op',
          op: `fs.${op}` as OpName,
          args: [{ id: propertyIds(b).variable, kind: 'var', name: variableNameOf(b, 'VAR') }],
        };
      }
      case B.readyCondition: {
        const test = String(b.getFieldValue('TEST') ?? 'nameMatches');
        const ids = readyIds(b);
        this.alias(ids.property, b);
        this.alias(ids.variable, b);
        this.alias(ids.value, b);
        if (ids.wrapper) this.alias(ids.wrapper, b);
        const variable = { id: ids.variable, kind: 'var' as const, name: variableNameOf(b, 'VAR') };
        const value = String(b.getFieldValue('VALUE') ?? '');
        const lit = ['sizeGt', 'sizeGe', 'sizeLt', 'sizeLe'].includes(test)
          ? { id: ids.value, kind: 'lit' as const, value: sizeBytes(b) }
          : test.startsWith('modified')
            ? { id: ids.value, kind: 'date' as const, iso: value }
            : { id: ids.value, kind: 'lit' as const, value };
        const propName =
          test === 'nameMatches'
            ? 'name'
            : test === 'extensionIs'
              ? 'ext'
              : test.startsWith('size')
                ? 'size'
                : test.startsWith('modified')
                  ? 'modified'
                  : 'readText';
        const prop = {
          id: ids.property,
          kind: 'op' as const,
          op: `fs.${propName}` as OpName,
          args: [variable],
        };
        if (test === 'nameMatches')
          return { id, kind: 'op', op: 'text.wildcard', args: [prop, lit] };
        if (test === 'textContains')
          return { id, kind: 'op', op: 'text.contains', args: [prop, lit] };
        if (test === 'extensionIs')
          return {
            id,
            kind: 'binary',
            op: '==',
            left: { id: ids.wrapper ?? `${id}/lower`, kind: 'op', op: 'text.lower', args: [prop] },
            right: lit,
          };
        const cmp = test.endsWith('Gt')
          ? '>'
          : test.endsWith('Ge')
            ? '>='
            : test.endsWith('Lt')
              ? '<'
              : '<=';
        return { id, kind: 'binary', op: cmp, left: prop, right: lit };
      }
      case B.allOf:
      case B.anyOf: {
        const count = allOfCount(b);
        const ids = allOfIds(b);
        const op = b.type === B.allOf ? 'and' : 'or';
        let out = this.expr(b, 'C0', 'the first condition');
        for (let i = 1; i < count; i++) {
          const right = this.expr(b, `C${i}`, `condition ${i + 1}`);
          out = { id: ids[i - 1] ?? `${id}/${op}${i}`, kind: 'binary', op, left: out, right };
          this.alias(out.id, b);
        }
        return out;
      }
      case B.var:
        return { id, kind: 'var', name: variableNameOf(b, 'VAR') };
      case B.arith:
      case B.compare:
      case B.logic:
        return {
          id,
          kind: 'binary',
          op: String(b.getFieldValue('OP')) as BinOp,
          left: this.expr(b, 'A', 'the left side'),
          right: this.expr(b, 'B', 'the right side'),
        };
      case B.not:
        return { id, kind: 'unary', op: 'not', arg: this.expr(b, 'X', 'the yes/no value') };
      case B.neg:
        return { id, kind: 'unary', op: 'neg', arg: this.expr(b, 'X', 'the number') };
      case B.call:
        return this.call(b, id);
    }
    const compositeExpr = compositeExprOfBlockType(b.type);
    if (compositeExpr) return this.compositeExpr(b, compositeExpr, id);
    const op = opOfBlockType(b.type);
    if (op) return this.op(b, op, id);
    this.warnings.push({ blockId: id, message: `Unknown block "${b.type}" was skipped.` });
    return HOLE;
  }

  op(b: Blockly.Block, op: OpName, id: NodeId): OpExpr {
    const args: Expr[] = OPS[op].args.map((arg, i) => {
      if (!arg.literal) return this.expr(b, `A${i}`, `"${arg.name}"`);
      const litId = this.alias(nodeIdFor(b, `arg${i}`), b);
      const raw = b.getFieldValue(`L${i}`);
      const value: Lit['value'] =
        arg.type.t === 'bool'
          ? raw === 'TRUE'
          : arg.type.t === 'number'
            ? Number(raw)
            : String(raw ?? '');
      return { id: litId, kind: 'lit', value };
    });
    return { id, kind: 'op', op, args };
  }

  call(b: Blockly.Block, id: NodeId): CallExpr {
    const spec = getCallSpec(b);
    const args = spec.params.map((p, i) => this.expr(b, `ARG${i}`, `"${p.name}"`));
    return { id, kind: 'call', fn: spec.fn, args };
  }

  compositeExpr(b: Blockly.Block, name: CompositeExprName, id: NodeId): CompositeExpr {
    const schema = COMPOSITE_EXPR_SCHEMAS[name];
    const fields: Record<string, FieldValue> = {};
    for (const f of schema.fields)
      fields[f.key] = fieldFromBlockly(f, b.getFieldValue(`F_${f.key}`));
    const inputs: Record<string, Expr> = {};
    for (const inp of schema.inputs) {
      const target = this.target(b, `I_${inp.key}`);
      if (target) inputs[inp.key] = this.exprOf(target);
    }
    const binds: Record<string, string> = {};
    for (const bind of schema.binds)
      binds[bind.key] = String(b.getFieldValue(`B_${bind.key}`) ?? '');
    return { id, kind: 'compositeExpr', name, fields, inputs, binds };
  }

  // ------------------------------------------------------------- functions

  fn(b: Blockly.Block): FunctionDef {
    const ret = String(b.getFieldValue('RETURNS') ?? NO_RETURN);
    return {
      id: b.id,
      kind: 'function',
      name: String(b.getFieldValue('NAME') ?? ''),
      params: getDefParams(b).map((p) => ({
        name: p.name,
        type: parseTypeKey(p.type ?? '') ?? NUMBER,
      })),
      returns: ret === NO_RETURN ? null : (parseTypeKey(ret) ?? NUMBER),
      body: this.chain(b.getNextBlock()),
    };
  }
}

function position(b: Blockly.Block): { x: number; y: number } {
  const xy = b.getRelativeToSurfaceXY();
  return { x: Math.round(xy.x), y: Math.round(xy.y) };
}

export function wsToIr(ws: Blockly.Workspace): WsToIrResult {
  const r = new Reader();
  const layout: Layout = {};
  const functions: FunctionDef[] = [];
  let body: Stmt[] = [];
  let haveRun = false;
  for (const top of ws.getTopBlocks(false)) {
    if (top.isInsertionMarker()) continue;
    if (top.type === B.run && !haveRun) {
      haveRun = true;
      layout[RUN_BLOCK_ID] = position(top);
      body = r.chain(top.getNextBlock());
    } else if (top.type === B.function) {
      layout[top.id] = position(top);
      functions.push(r.fn(top));
    } else {
      r.warnings.push({ blockId: top.id, message: DETACHED_MESSAGE });
    }
  }
  return {
    program: { format: 'beepblocks-ir', version: 2, functions, body },
    layout,
    warnings: r.warnings,
    issues: r.issues,
    aliases: r.aliases,
  };
}
