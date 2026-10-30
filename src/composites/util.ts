/** Small helpers shared by the desugarings. */
import type { CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { getField } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Expr } from '../ir/types.ts';

function wrongField(node: CompositeStmt, key: string, want: string): Error {
  return new Error(`Task block "${node.id}" (${node.name}): setting "${key}" must be ${want}.`);
}

export function textField(node: CompositeStmt, key: string): string {
  const v = getField(node, key);
  if (typeof v !== 'string') throw wrongField(node, key, 'text');
  return v;
}

export function optTextField(node: CompositeStmt, key: string): string | null {
  const v = getField(node, key);
  if (v === null) return null;
  if (typeof v !== 'string') throw wrongField(node, key, 'text');
  return v;
}

export function optNumberField(node: CompositeStmt, key: string): number | null {
  const v = getField(node, key);
  if (v === null) return null;
  if (typeof v !== 'number') throw wrongField(node, key, 'a number');
  return v;
}

export function boolField(node: CompositeStmt, key: string): boolean {
  const v = getField(node, key);
  if (typeof v !== 'boolean') throw wrongField(node, key, 'yes or no');
  return v;
}

export function enumField<T extends string>(
  node: CompositeStmt,
  key: string,
  options: readonly T[],
): T {
  const v = getField(node, key);
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) {
    throw wrongField(node, key, `one of ${options.join(', ')}`);
  }
  return v as T;
}

export function input(node: CompositeStmt, key: string): Expr {
  const e = node.inputs[key];
  if (!e) throw new Error(`Task block "${node.id}" (${node.name}): input "${key}" is empty.`);
  return e;
}

/** Left-folds conditions with `and`; ids are `${prefix}.and${i}`. Null when empty. */
export function andAll(conds: Expr[], ctx: DesugarCtx, prefix: string): Expr | null {
  const [first, ...rest] = conds;
  if (!first) return null;
  let acc: Expr = first;
  rest.forEach((c, i) => {
    acc = b.bin('and', acc, c, ctx.id(`${prefix}.and${i + 1}`));
  });
  return acc;
}
