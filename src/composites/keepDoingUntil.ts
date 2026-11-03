import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { ACTION_SCHEMAS } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import { input } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  return [
    b.while(
      b.not(input(node, 'condition'), ctx.id('not')),
      node.bodies.body ?? [],
      ctx.id('while'),
    ),
  ];
}

export const keepDoingUntil: CompositeDef = { ...ACTION_SCHEMAS.keepDoingUntil, desugar };
