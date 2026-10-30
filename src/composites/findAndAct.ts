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
import { counterInit, counterNext, planTemplate, renameStmts } from './template.ts';
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
  const plan =
    action === 'rename' ? planTemplate(optTextField(node, 'renameTemplate') ?? '') : null;

  const out: Stmt[] = [];

  // Inputs in schema order: folder, then destination.
  const items = ctx.freshName('items');
  out.push(
    b.assign(
      items,
      b.op(recursive ? 'fs.walk' : 'fs.list', [input(node, 'folder')], id('items.list')),
      id('items'),
    ),
  );
  let destination: string | null = null;
  if (action === 'move' || action === 'copy') {
    destination = ctx.freshName('destination');
    out.push(b.assign(destination, input(node, 'destination'), id('destination')));
  }
  const counter = plan?.usesCounter ? ctx.freshName('n') : null;
  if (counter) out.push(counterInit(ctx, counter));

  const item = ctx.freshName('item');
  const v = (local: string) => b.v(item, id(local));

  // ---- criteria
  const conds: Expr[] = [];
  if (!recursive) {
    conds.push(
      b.not(b.op('fs.isFolder', [v('crit.file.item')], id('crit.file.isFolder')), id('crit.file')),
    );
  }
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

  // ---- action
  let act: Stmt[];
  switch (action) {
    case 'move':
    case 'copy': {
      const dest = destination!;
      act = [
        b.if(
          b.bin(
            '!=',
            b.op('fs.parent', [v('act.guard.item')], id('act.guard.parent')),
            b.v(dest, id('act.guard.dest')),
            id('act.guard.test'),
          ),
          [
            b.do(
              b.op(
                action === 'move' ? 'fs.move' : 'fs.copy',
                [v('act.item'), b.v(dest, id('act.dest'))],
                id('act.op'),
              ),
              id('act'),
            ),
          ],
          [],
          id('act.guard'),
        ),
      ];
      break;
    }
    case 'delete':
      act = [b.do(b.op('fs.delete', [v('act.item')], id('act.op')), id('act'))];
      break;
    case 'rename':
      act = [
        ...(counter ? [counterNext(ctx, counter)] : []),
        ...renameStmts(plan!, { ctx, item, counter }),
      ];
      break;
  }

  const cond = andAll(conds, ctx, 'crit');
  const loopBody = cond ? [b.if(cond, act, [], id('check'))] : act;
  out.push(b.forEach(item, b.v(items, id('loop.items')), loopBody, id('loop')));
  return out;
}

export const findAndAct: CompositeDef = { ...COMPOSITE_SCHEMAS.findAndAct, desugar };
