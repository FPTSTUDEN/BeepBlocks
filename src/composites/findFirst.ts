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
import { T, type Stmt } from '../ir/types.ts';
import { enumField, input } from './util.ts';

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const sortBy = enumField(node, 'sortBy', ['name', 'modified', 'size'] as const);
  const candidate = getBind(node, 'candidate');
  const match = getBind(node, 'match');

  const files = ctx.freshName('files');
  const item = ctx.freshName('item');
  const items = ctx.freshName('items');
  const low = ctx.freshName('low');
  const high = ctx.freshName('high');
  const mid = ctx.freshName('mid');
  const hint = () => ({ indexInto: items });

  return [
    b.assign(files, b.list(T.path, [], id('files.empty')), id('files')),
    b.forEach(
      item,
      b.op('fs.list', [input(node, 'folder')], id('collect.list')),
      [
        b.if(
          b.not(
            b.op('fs.isFolder', [b.v(item, id('collect.test.item'))], id('collect.test.isFolder')),
            id('collect.test'),
          ),
          [
            b.do(
              b.op(
                'list.append',
                [b.v(files, id('collect.add.files')), b.v(item, id('collect.add.item'))],
                id('collect.add.op'),
              ),
              id('collect.add'),
            ),
          ],
          [],
          id('collect.if'),
        ),
      ],
      id('collect'),
    ),
    b.assign(
      items,
      b.op(
        'list.sortBy',
        [
          b.v(files, id('sort.files')),
          b.lit(sortBy, id('sort.key')),
          b.lit(false, id('sort.desc')),
        ],
        id('sort.op'),
      ),
      id('sort'),
    ),
    b.assign(low, b.lit(0, id('low.value')), id('low'), hint()),
    b.assign(
      high,
      b.op('list.length', [b.v(items, id('high.items'))], id('high.value')),
      id('high'),
      hint(),
    ),
    b.while(
      b.bin('<', b.v(low, id('loop.low')), b.v(high, id('loop.high')), id('loop.test')),
      [
        b.assign(
          mid,
          b.bin(
            '//',
            b.bin('+', b.v(low, id('mid.low')), b.v(high, id('mid.high')), id('mid.sum')),
            b.lit(2, id('mid.two')),
            id('mid.value'),
          ),
          id('mid'),
          hint(),
        ),
        b.assign(
          candidate,
          b.op(
            'list.get',
            [b.v(items, id('candidate.items')), b.v(mid, id('candidate.mid'))],
            id('candidate.value'),
          ),
          id('candidate'),
        ),
        b.if(
          input(node, 'condition'),
          [b.assign(high, b.v(mid, id('left.mid')), id('left'), hint())],
          [
            b.assign(
              low,
              b.bin('+', b.v(mid, id('right.mid')), b.lit(1, id('right.one')), id('right.value')),
              id('right'),
              hint(),
            ),
          ],
          id('probe'),
        ),
      ],
      id('loop'),
    ),
    b.if(
      b.bin(
        '<',
        b.v(low, id('result.low')),
        b.op('list.length', [b.v(items, id('result.items'))], id('result.length')),
        id('result.test'),
      ),
      [
        b.assign(
          match,
          b.op(
            'list.get',
            [b.v(items, id('match.items')), b.v(low, id('match.low'))],
            id('match.value'),
          ),
          id('match'),
        ),
        ...(node.bodies.found ?? []),
      ],
      [...(node.bodies.notFound ?? [])],
      id('result'),
    ),
  ];
}

export const findFirst: CompositeDef = { ...COMPOSITE_SCHEMAS.findFirst, desugar };
