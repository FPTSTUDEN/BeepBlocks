import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { ACTION_SCHEMAS } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import { input } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const count = ctx.freshName('count');
  return [
    b.assign(count, input(node, 'n'), ctx.id('count')),
    b.while(
      b.bin('>', b.v(count, ctx.id('test.count')), b.lit(0, ctx.id('test.zero')), ctx.id('test')),
      [
        ...(node.bodies.body ?? []),
        b.assign(count, b.bin('-', b.v(count, ctx.id('next.count')), b.lit(1, ctx.id('next.one')), ctx.id('next.value')), ctx.id('next')),
      ],
      ctx.id('while'),
    ),
  ];
}

export const repeatTimes: CompositeDef = { ...ACTION_SCHEMAS.repeatTimes, desugar };
