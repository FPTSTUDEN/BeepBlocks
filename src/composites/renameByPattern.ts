/**
 * renameByPattern (design.md §6.2, task C.3).
 *
 *   n = 0                                      # only if the template uses {n}
 *   for item in fs.list(<folder>):
 *       if not fs.isFolder(item) and text.wildcard(fs.name(item), MATCH):
 *           n = n + 1                          # only if the template uses {n}
 *           <renameStmts>                      # ext / new_name / guarded fs.rename
 */
import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_SCHEMAS } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import { counterInit, counterNext, planTemplate, renameStmts } from './template.ts';
import { input, textField } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const match = textField(node, 'match');
  const plan = planTemplate(textField(node, 'template'));
  const folder = input(node, 'folder');

  const out: Stmt[] = [];
  const counter = plan.usesCounter ? ctx.freshName('n') : null;
  if (counter) out.push(counterInit(ctx, counter));

  const item = ctx.freshName('item');
  const inner: Stmt[] = [];
  if (counter) inner.push(counterNext(ctx, counter));
  inner.push(...renameStmts(plan, { ctx, item, counter }));

  out.push(
    b.forEach(
      item,
      b.op('fs.list', [folder], id('loop.list')),
      [
        b.if(
          b.bin(
            'and',
            b.not(
              b.op('fs.isFolder', [b.v(item, id('check.isFolder.item'))], id('check.isFolder')),
              id('check.isFile'),
            ),
            b.op(
              'text.wildcard',
              [
                b.op('fs.name', [b.v(item, id('check.match.item'))], id('check.match.name')),
                b.lit(match, id('check.match.pattern')),
              ],
              id('check.match'),
            ),
            id('check.cond'),
          ),
          inner,
          [],
          id('check'),
        ),
      ],
      id('loop'),
    ),
  );
  return out;
}

export const renameByPattern: CompositeDef = { ...COMPOSITE_SCHEMAS.renameByPattern, desugar };
