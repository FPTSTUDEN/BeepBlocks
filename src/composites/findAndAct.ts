/**
 * findAndAct (design.md §6.1 "Further desugaring rules", §6.2, task C.5).
 *
 *   items = fs.walk(<folder>)                  # recursive
 *   items = fs.list(<folder>)                  # not recursive (folders filtered below)
 *   destination = <destination>                # move/copy only (used twice)
 *   n = 0                                      # rename with {n} only
 *   for item in items:
 *       if [not fs.isFolder(item)]             # not recursive only
 *          and text.wildcard(fs.name(item), PATTERN)
 *          and text.lower(fs.ext(item)) == EXT
 *          and fs.size(item) >= MIN and fs.size(item) <= MAX
 *          and fs.modified(item) >= date(AFTER) and fs.modified(item) < date(BEFORE):
 *           <action>
 *
 * Unset criteria are left out; with no criteria at all the `if` is omitted.
 * Actions:
 *   move/copy: if fs.parent(item) != destination: fs.move/copy(item, destination)
 *   delete:    fs.delete(item)
 *   rename:    n = n + 1 (if {n}); <renameStmts>
 */
import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_SCHEMAS } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Expr, Stmt } from '../ir/types.ts';
import { andAll, boolField, enumField, input, optNumberField, optTextField } from './util.ts';

const ACTIONS = ['move', 'copy', 'delete', 'rename'] as const;

/** Normalizes the extension field: leading '.' stripped, lowercased. */
export function normalizeExtension(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase();
}

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const recursive = boolField(node, 'recursive');
  const action = enumField(node, 'action', ACTIONS);
  const namePattern = optTextField(node, 'namePattern');
  const extension = optTextField(node, 'extension');
  const minSize = optNumberField(node, 'minSize');
  const maxSize = optNumberField(node, 'maxSize');
  const after = optTextField(node, 'modifiedAfter');
  const before = optTextField(node, 'modifiedBefore');
  const file = ctx.freshName('item');
  const v = (local: string) => b.v(file, id(local));

  // ---- criteria
  const conds: Expr[] = [];
  if (namePattern !== null) {
    conds.push(
      b.op(
        'text.wildcard',
        [
          b.op('fs.name', [v('crit.name.item')], id('crit.name.name')),
          b.lit(namePattern, id('crit.name.pattern')),
        ],
        id('crit.name'),
      ),
    );
  }
  if (extension !== null) {
    conds.push(
      b.bin(
        '==',
        b.op(
          'text.lower',
          [b.op('fs.ext', [v('crit.ext.item')], id('crit.ext.raw'))],
          id('crit.ext.lower'),
        ),
        b.lit(normalizeExtension(extension), id('crit.ext.value')),
        id('crit.ext'),
      ),
    );
  }
  if (minSize !== null) {
    conds.push(
      b.bin(
        '>=',
        b.op('fs.size', [v('crit.min.item')], id('crit.min.size')),
        b.lit(minSize, id('crit.min.value')),
        id('crit.min'),
      ),
    );
  }
  if (maxSize !== null) {
    conds.push(
      b.bin(
        '<=',
        b.op('fs.size', [v('crit.max.item')], id('crit.max.size')),
        b.lit(maxSize, id('crit.max.value')),
        id('crit.max'),
      ),
    );
  }
  if (after !== null) {
    conds.push(
      b.bin(
        '>=',
        b.op('fs.modified', [v('crit.after.item')], id('crit.after.modified')),
        b.date(after, id('crit.after.date')),
        id('crit.after'),
      ),
    );
  }
  if (before !== null) {
    conds.push(
      b.bin(
        '<',
        b.op('fs.modified', [v('crit.before.item')], id('crit.before.modified')),
        b.date(before, id('crit.before.date')),
        id('crit.before'),
      ),
    );
  }

  const condition = andAll(conds, ctx, 'crit');
  return [
    b.composite(
      'everyFile',
      {
        fields: {
          action,
          includeSubfolders: recursive,
          makeFolder: false,
          renameTemplate: action === 'rename' ? optTextField(node, 'renameTemplate') : null,
        },
        inputs: {
          folder: input(node, 'folder'),
          ...(condition ? { condition } : {}),
          ...(action === 'move' || action === 'copy'
            ? { destination: input(node, 'destination') }
            : {}),
        },
        binds: { file },
      },
      id('everyFile'),
    ),
  ];
}

export const findAndAct: CompositeDef = { ...COMPOSITE_SCHEMAS.findAndAct, desugar };
