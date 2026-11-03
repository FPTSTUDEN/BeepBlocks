import type { CompositeExprDef, CompositeExpr, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_EXPR_SCHEMAS, getField, getBind } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import { type Expr, type Stmt } from '../ir/types.ts';

function desugar(node: CompositeExpr, ctx: DesugarCtx): { pre: Stmt[]; value: Expr } {
  const id = ctx.id;
  const file = getBind(node, 'file');
  const count = ctx.freshName('count');
  const item = ctx.freshName('item');
  const include = getField(node, 'includeSubfolders') === true;
  const condition = node.inputs.condition;
  const criteria: Expr[] = [b.not(b.op('fs.isFolder', [b.v(item, id('file'))], id('isFolder')), id('notFolder'))];
  if (condition) criteria.push(condition);
  let cond = criteria[0]!;
  for (let i = 1; i < criteria.length; i++) cond = b.bin('and', cond, criteria[i]!, id(`condition.${i}`));
  return {
    pre: [
      b.assign(count, b.lit(0, id('init.value')), id('init')),
      b.forEach(
        item,
        b.op(include ? 'fs.walk' : 'fs.list', [requiredInput(node, 'folder')], id('list')),
        [
          b.if(cond, [b.assign(count, b.bin('+', b.v(count, id('next.count')), b.lit(1, id('next.one')), id('next.value')), id('next'))], [], id('check')),
        ],
        id('loop'),
      ),
    ],
    value: b.v(count, id('value')),
  };
}

function requiredInput(node: CompositeExpr, key: string): Expr {
  const value = node.inputs[key];
  if (!value) throw new Error(`Expression action "${node.id}" (${node.name}): input "${key}" is empty.`);
  return value;
}

export const countFiles: CompositeExprDef = { ...COMPOSITE_EXPR_SCHEMAS.countFiles, desugar };
