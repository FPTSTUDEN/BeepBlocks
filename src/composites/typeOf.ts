import type { CompositeExprDef, CompositeExpr, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_EXPR_SCHEMAS, getField } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import { T, type Expr, type Stmt } from '../ir/types.ts';
import { CATEGORIES, OTHER_CATEGORY } from './sortByType.ts';

function desugar(node: CompositeExpr, ctx: DesugarCtx): { pre: Stmt[]; value: Expr } {
  const id = ctx.id;
  const file = node.inputs.file;
  if (!file) throw new Error(`Expression action "${node.id}" (${node.name}) needs a file input.`);
  const ext = ctx.freshName('ext');
  const type = ctx.freshName('type');
  const by = String(getField(node, 'by') ?? 'category');
  const pre: Stmt[] = [
    b.assign(ext, b.op('text.lower', [b.op('fs.ext', [file], id('ext.raw'))], id('ext.lower')), id('ext')),
  ];
  if (by === 'extension') return { pre, value: b.v(ext, id('value')) };
  let rest: Stmt[] = [b.assign(type, b.lit(OTHER_CATEGORY, id('other.value')), id('other'))];
  for (let i = CATEGORIES.length - 1; i >= 0; i--) {
    const category = CATEGORIES[i]!;
    rest = [
      b.if(
        b.op('list.contains', [
          b.list(T.text, category.exts.map((e, j) => b.lit(e, id(`cat.${i}.${j}`))), id(`cat.${i}.list`)),
          b.v(ext, id(`cat.${i}.ext`)),
        ], id(`cat.${i}.test`)),
        [b.assign(type, b.lit(category.name, id(`cat.${i}.value`)), id(`cat.${i}`))],
        rest,
        id(`cat.${i}.if`),
      ),
    ];
  }
  return { pre: [...pre, ...rest], value: b.v(type, id('value')) };
}

export const typeOf: CompositeExprDef = { ...COMPOSITE_EXPR_SCHEMAS.typeOf, desugar };
