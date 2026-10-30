/** Math ops (design.md §5.2, §5.6). */
import { SimError } from '../errors.ts';
import { pyFloat, pyInt, pyLess } from '../pyvalues.ts';
import { num, pure, type OpImpl } from './types.ts';

export const MATH_OPS = {
  // Python math.floor returns an int.
  'math.floor': pure((a) => {
    const x = num(a, 0);
    if (x.t === 'int') return x;
    if (!Number.isFinite(x.v)) {
      throw new SimError('INT_OVERFLOW', `${x.v} cannot be rounded down to a whole number.`);
    }
    return pyInt(Math.floor(x.v));
  }),
  'math.abs': pure((a) => {
    const x = num(a, 0);
    return x.t === 'int' ? pyInt(Math.abs(x.v)) : pyFloat(Math.abs(x.v));
  }),
  // Python min/max return the first argument on ties.
  'math.min': pure((a) => {
    const x = num(a, 0);
    const y = num(a, 1);
    return pyLess(y, x) ? y : x;
  }),
  'math.max': pure((a) => {
    const x = num(a, 0);
    const y = num(a, 1);
    return pyLess(x, y) ? y : x;
  }),
} satisfies Record<string, OpImpl>;
