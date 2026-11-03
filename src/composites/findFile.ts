import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { ACTION_SCHEMAS, getBind } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Expr, Stmt } from '../ir/types.ts';
import { boolField, enumField, input } from './util.ts';

const WHICH = ['first', 'biggest', 'smallest', 'newest', 'oldest'] as const;

function better(which: (typeof WHICH)[number], file: Expr, best: Expr, id: (s: string) => string): Expr {
  const left = which === 'biggest' ? b.op('fs.size', [file], id('left')) :
    which === 'smallest' ? b.op('fs.size', [file], id('left')) :
      which === 'newest' ? b.op('fs.modified', [file], id('left')) :
        which === 'oldest' ? b.op('fs.modified', [file], id('left')) :
          b.lit(true, id('first'));
  const right = which === 'biggest' ? b.op('fs.size', [best], id('right')) :
    which === 'smallest' ? b.op('fs.size', [best], id('right')) :
      which === 'newest' ? b.op('fs.modified', [best], id('right')) :
        which === 'oldest' ? b.op('fs.modified', [best], id('right')) :
          b.lit(true, id('first.right'));
  if (which === 'biggest' || which === 'newest') return b.bin('>', left, right, id('greater'));
  if (which === 'smallest' || which === 'oldest') return b.bin('<', left, right, id('less'));
  return b.lit(false, id('first.false'));
}

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const which = enumField(node, 'which', WHICH);
  const recursive = boolField(node, 'includeSubfolders');
  const file = getBind(node, 'file');
  const found = getBind(node, 'found');
  const best = ctx.freshName('best');
  const has = ctx.freshName('has');
  const folder = ctx.freshName('folder');
  const items = recursive ? 'fs.walk' : 'fs.list';
  const conds: Expr[] = [b.not(b.op('fs.isFolder', [b.v(file, id('file'))], id('folder')), id('isFile'))];
  if (node.inputs.condition) conds.push(node.inputs.condition);
  const accept = which === 'first'
    ? [b.assign(best, b.v(file, id('best.value')), id('best')), b.assign(has, b.lit(true, id('has.true')), id('has.set'))]
    : [
        b.if(
          b.bin('or', b.not(b.v(has, id('best.none')), id('best.not')), better(which, b.v(file, id('candidate')), b.v(best, id('best')), id), id('accept')),
          [b.assign(best, b.v(file, id('best.value')), id('best.set')), b.assign(has, b.lit(true, id('has.true')), id('has.set'))],
          [],
          id('best.if'),
        ),
      ];
  const stop = which === 'first' ? b.not(b.v(has, id('stop.has')), id('stop.not')) : b.lit(true, id('stop.always'));
  return [
    b.assign(folder, input(node, 'folder'), id('folder.init')),
    b.assign(best, b.v(folder, id('best.initial')), id('best.init')),
    b.assign(has, b.lit(false, id('has.init')), id('has')),
    b.forEach(
      file,
      b.op(items, [b.v(folder, id('items.folder'))], id('items')),
      [b.if(b.bin('and', stop, andConditions(conds, ctx, 'condition'), id('check')), accept, [], id('accept.if'))],
      id('loop'),
    ),
    b.if(
      b.v(has, id('result.has')),
      [
        b.assign(found, b.v(best, id('result.best')), id('found')),
        ...(node.bodies.found ?? []),
      ],
      node.bodies.notFound ?? [],
      id('result'),
    ),
  ];
}

function andConditions(conditions: Expr[], ctx: DesugarCtx, prefix: string): Expr {
  let out = conditions[0]!;
  for (let i = 1; i < conditions.length; i++) out = b.bin('and', out, conditions[i]!, ctx.id(`${prefix}.${i}`));
  return out;
}

export const findFile: CompositeDef = { ...ACTION_SCHEMAS.findFile, desugar };
