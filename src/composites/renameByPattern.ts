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
import { input, textField } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const match = textField(node, 'match');
  const file = ctx.freshName('item');
  return [
    b.composite(
      'everyFile',
      {
        fields: {
          action: 'rename',
          includeSubfolders: false,
          makeFolder: false,
          renameTemplate: textField(node, 'template'),
        },
        inputs: {
          folder: input(node, 'folder'),
          condition: b.op(
            'text.wildcard',
            [
              b.op('fs.name', [b.v(file, id('condition.name.file'))], id('condition.name')),
              b.lit(match, id('condition.pattern')),
            ],
            id('condition'),
          ),
        },
        binds: { file },
      },
      id('everyFile'),
    ),
  ];
}

export const renameByPattern: CompositeDef = { ...COMPOSITE_SCHEMAS.renameByPattern, desugar };
