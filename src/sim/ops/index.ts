/** Simulator op registry: one implementation per op in `ir/ops.ts` (design.md §4.2). */
import type { OpName } from '../../ir/ops.ts';
import type { OpImpl } from './types.ts';
import { TEXT_OPS } from './text.ts';
import { LIST_OPS } from './list.ts';
import { MATH_OPS } from './math.ts';
import { FS_OPS } from './fs.ts';

export type { OpCtx, OpImpl, OpResult } from './types.ts';

/** Typed as a total record so a missing op is a compile error (and a test failure). */
export const SIM_OPS: Readonly<Record<OpName, OpImpl>> = {
  ...TEXT_OPS,
  ...LIST_OPS,
  ...MATH_OPS,
  ...FS_OPS,
};
