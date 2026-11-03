/**
 * findFirst — binary search (design.md §6.2, task C.6).
 *
 *   files = []
 *   for item in fs.list(<folder>):
 *       if not fs.isFolder(item):
 *           list.append(files, item)
 *   items = list.sortBy(files, SORT_BY, False)
 *   low = 0                                    # hint: indexInto items
 *   high = list.length(items)                  # hint: indexInto items
 *   while low < high:
 *       mid = (low + high) // 2                # hint: indexInto items
 *       <candidate> = list.get(items, mid)
 *       if <condition>:
 *           high = mid                         # hint: indexInto items
 *       else:
 *           low = mid + 1                      # hint: indexInto items
 *   if low < list.length(items):
 *       <match> = list.get(items, low)
 *       <found>
 *   else:
 *       <notFound>
 */
import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_SCHEMAS, getBind } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import { enumField, input } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const sortBy = enumField(node, 'sortBy', ['name', 'modified', 'size'] as const);
  const candidate = getBind(node, 'candidate');
  const match = getBind(node, 'match');

  return [
    b.composite(
      'halvingSearch',
      {
        inputs: {
          line: b.op(
            'list.sortBy',
            [
              b.compositeExpr(
                'filesIn',
                { fields: { includeSubfolders: false, order: 'listing' }, inputs: { folder: input(node, 'folder') } },
                id('filesIn'),
              ),
              b.lit(sortBy, id('sort.key')),
              b.lit(false, id('sort.desc')),
            ],
            id('sort'),
          ),
        },
        bodies: {
          decide: [
            b.if(
              input(node, 'condition'),
              [b.composite('keepLeftHalf', {}, id('keepLeftHalf'))],
              [b.composite('keepRightHalf', {}, id('keepRightHalf'))],
              id('decide'),
            ),
          ],
          found: node.bodies.found ?? [],
          notFound: node.bodies.notFound ?? [],
        },
        binds: { middle: candidate, answer: match },
      },
      id('halvingSearch'),
    ),
  ];
}

export const findFirst: CompositeDef = { ...COMPOSITE_SCHEMAS.findFirst, desugar };
