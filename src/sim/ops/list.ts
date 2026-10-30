/** List ops (design.md §5.2, §5.6). */
import type { Value } from '../../ir/timeline.ts';
import { compareCodePoints } from '../../domains/fileExplorer/fsTypes.ts';
import * as sfs from '../../domains/fileExplorer/fs.ts';
import { SimError, internal } from '../errors.ts';
import { pyBool, pyEquals, pyInt, pyLess, pyList, pyPath } from '../pyvalues.ts';
import { arg, bool, intArg, list, text, unwrap, type OpImpl } from './types.ts';

/** Largest list `list.range` will build (the simulator stores lists eagerly). */
export const MAX_RANGE = 1_000_000;

/** Python tuple key comparison over (lower, original) using code-point order. */
function compareNameKey(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la !== lb ? compareCodePoints(la, lb) : compareCodePoints(a, b);
}

/** Python `sorted(items, key=…, reverse=desc)`: stable in both directions. */
function stableSort<T>(items: T[], cmp: (a: T, b: T) => number, desc: boolean): T[] {
  return [...items].sort(desc ? (a, b) => cmp(b, a) : cmp);
}

/** Python ordering of numbers/text using only `<` (as `sorted` does). */
function pyOrder(a: Value, b: Value): number {
  if (pyLess(a, b)) return -1;
  if (pyLess(b, a)) return 1;
  return 0;
}

export const LIST_OPS = {
  'list.length': (_c, a) => ({ value: pyInt(list(a, 0).v.length) }),
  'list.get': (_c, a) => {
    const items = list(a, 0).v;
    const i = intArg(a, 1, 'The position');
    if (i < 0 || i >= items.length) {
      throw new SimError(
        'INDEX_OUT_OF_RANGE',
        items.length === 0
          ? `Position ${i} does not exist: the list is empty.`
          : `Position ${i} does not exist: positions go from 0 to ${items.length - 1}.`,
      );
    }
    return { value: items[i]! };
  },
  'list.append': (_c, a) => {
    list(a, 0).v.push(arg(a, 1));
    return { value: null };
  },
  'list.contains': (_c, a) => {
    const x = arg(a, 1);
    return { value: pyBool(list(a, 0).v.some((v) => pyEquals(v, x))) };
  },
  'list.range': (_c, a) => {
    const start = intArg(a, 0, 'The start');
    const stop = intArg(a, 1, 'The end');
    const n = Math.max(0, stop - start);
    if (n > MAX_RANGE) {
      throw new SimError(
        'STEP_LIMIT',
        `A range of ${n} numbers is too large for the simulator (at most ${MAX_RANGE}).`,
      );
    }
    return { value: pyList(Array.from({ length: n }, (_, i) => pyInt(start + i))) };
  },
  'list.sortBy': (ctx, a) => {
    const items = list(a, 0).v.map((v) => (v.t === 'path' ? v.v : internal('sortBy on non-path')));
    const key = text(a, 1);
    const desc = bool(a, 2);
    if (key === 'name' || key === 'ext') {
      const k = key === 'name' ? sfs.pathName : sfs.pathExt;
      const sorted = stableSort(items, (x, y) => compareNameKey(k(x), k(y)), desc);
      return { value: pyList(sorted.map(pyPath)) };
    }
    if (key !== 'size' && key !== 'modified') return internal(`unknown sort key ${key}`);
    // Every item is checked in list order before sorting (design.md §5.6).
    const keys = new Map<number, number>();
    items.forEach((p, i) => {
      const r = key === 'size' ? sfs.size(ctx.fs, p) : sfs.modified(ctx.fs, p);
      keys.set(i, unwrap(r).value);
    });
    const order = stableSort(
      items.map((_, i) => i),
      (x, y) => keys.get(x)! - keys.get(y)!,
      desc,
    );
    return { value: pyList(order.map((i) => pyPath(items[i]!))), readPaths: items };
  },
  'list.sort': (_c, a) => ({
    value: pyList(stableSort(list(a, 0).v, pyOrder, bool(a, 1))),
  }),
} satisfies Record<string, OpImpl>;
