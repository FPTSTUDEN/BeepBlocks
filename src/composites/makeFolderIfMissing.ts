import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { ACTION_SCHEMAS, getField } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import { input } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const path = ctx.freshName('folder');
  const value = input(node, 'path');
  return [
    b.assign(path, value, ctx.id('path')),
    b.if(
      b.not(b.op('fs.exists', [b.v(path, ctx.id('exists.path'))], ctx.id('exists')), ctx.id('missing')),
      [b.do(b.op('fs.makeFolder', [b.v(path, ctx.id('make.path'))], ctx.id('make')), ctx.id('made'))],
      [],
      ctx.id('if'),
    ),
  ];
}

export const makeFolderIfMissing: CompositeDef = {
  ...ACTION_SCHEMAS.makeFolderIfMissing,
  desugar,
};
