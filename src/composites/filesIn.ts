import type { CompositeExprDef, CompositeExpr, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_EXPR_SCHEMAS, getField, getBind } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import { T, type Expr, type Stmt } from '../ir/types.ts';

function desugar(node: CompositeExpr, ctx: DesugarCtx): { pre: Stmt[]; value: Expr } {
  const id = ctx.id;
  const file = getBind(node, 'file');
  const files = ctx.freshName('files');
  const item = ctx.freshName('item');
  const include = getField(node, 'includeSubfolders') === true;
  const order = String(getField(node, 'order') ?? 'listing');
  const condition = node.inputs.condition;
  const criteria: Expr[] = [
    b.not(b.op('fs.isFolder', [b.v(item, id('file'))], id('isFolder')), id('notFolder')),
  ];
  if (condition) criteria.push(condition);
  let cond = criteria[0]!;
  for (let i = 1; i < criteria.length; i++) cond = b.bin('and', cond, criteria[i]!, id(`condition.${i}`));
  const body: Stmt[] = [
    b.if(
      cond,
      [b.do(b.op('list.append', [b.v(files, id('append.files')), b.v(item, id('append.item'))], id('append.op')), id('append'))],
      [],
      id('check'),
    ),
  ];
  const pre: Stmt[] = [
    b.assign(files, b.list(T.path, [], id('empty')), id('files')),
    b.forEach(item, b.op(include ? 'fs.walk' : 'fs.list', [requiredInput(node, 'folder')], id('list')), body, id('collect')),
  ];
  if (order !== 'listing') {
    const key = order === 'date' ? 'modified' : order;
    pre.push(
      b.assign(
        files,
        b.op('list.sortBy', [b.v(files, id('sort.files')), b.lit(key, id('sort.key')), b.lit(order === 'date' || order === 'size', id('sort.desc'))], id('sort.op')),
        id('sort'),
      ),
    );
  }
  return { pre, value: b.v(files, id('value')) };
}

function requiredInput(node: CompositeExpr, key: string): Expr {
  const value = node.inputs[key];
  if (!value) throw new Error(`Expression action "${node.id}" (${node.name}): input "${key}" is empty.`);
  return value;
}

export const filesIn: CompositeExprDef = { ...COMPOSITE_EXPR_SCHEMAS.filesIn, desugar };
