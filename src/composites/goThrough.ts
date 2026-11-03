import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { ACTION_SCHEMAS, getBind } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import { boolField, input } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const file = getBind(node, 'file');
  const list = boolField(node, 'includeSubfolders') ? 'fs.walk' : 'fs.list';
  return [
    b.forEach(
      file,
      b.op(list, [input(node, 'folder')], ctx.id('list')),
      [
        b.if(
          b.not(b.op('fs.isFolder', [b.v(file, ctx.id('file'))], ctx.id('isFolder')), ctx.id('isFile')),
          node.bodies.body ?? [],
          [],
          ctx.id('check'),
        ),
      ],
      ctx.id('loop'),
    ),
  ];
}

export const goThrough: CompositeDef = { ...ACTION_SCHEMAS.goThrough, desugar };
