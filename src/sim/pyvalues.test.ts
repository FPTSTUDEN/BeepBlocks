import { describe, expect, it } from 'vitest';
import type { ArithOp } from '../ir/types.ts';
import type { Value } from '../ir/timeline.ts';
import table from './__fixtures__/pyfloat-table.json';
import { SimError } from './errors.ts';
import {
  arith,
  compare,
  formatPyFloat,
  negate,
  pyEquals,
  pyFloat,
  pyInt,
  pyList,
  pyPath,
  pyStr,
  pyText,
  type NumValue,
} from './pyvalues.ts';

interface Enc {
  t: string;
  v?: number;
  r?: string;
}
interface ArithRow {
  a: Enc;
  op: string;
  b: Enc;
  result?: Enc;
  error?: string;
}

const dec = (e: Enc): NumValue => (e.t === 'int' ? pyInt(e.v!) : pyFloat(e.v!));
const show = (e: Enc) => (e.t === 'int' ? String(e.v) : e.r!);

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof SimError) return e.code;
    throw e;
  }
}

describe('formatPyFloat (Python repr table)', () => {
  const rows = (table as { repr: { v: number; r: string }[] }).repr;
  it('has at least 200 entries', () => expect(rows.length).toBeGreaterThanOrEqual(200));
  it.each(rows.map((r) => [r.r, r.v] as const))('repr → %s', (r, v) => {
    expect(formatPyFloat(v)).toBe(r);
  });
  it('handles the documented examples', () => {
    expect(formatPyFloat(1)).toBe('1.0');
    expect(formatPyFloat(1e-5)).toBe('1e-05');
    expect(formatPyFloat(1e16)).toBe('1e+16');
    expect(formatPyFloat(-0)).toBe('-0.0');
    expect(formatPyFloat(Infinity)).toBe('inf');
  });
});

describe('arithmetic (Python table)', () => {
  const rows = (table as { arith: ArithRow[] }).arith;
  it.each(rows.map((r) => [`${show(r.a)} ${r.op} ${show(r.b)}`, r] as const))('%s', (_, row) => {
    const run = () => arith(row.op as ArithOp, dec(row.a), dec(row.b));
    if (row.error) {
      expect(errorCode(run)).toBe(row.error);
      return;
    }
    const got = run();
    const want = row.result!;
    expect(got.t).toBe(want.t);
    if (want.t === 'int') expect(got.v).toBe(want.v);
    else expect(formatPyFloat((got as NumValue).v)).toBe(want.r);
  });
});

describe('arithmetic spot checks', () => {
  const i = pyInt;
  const f = pyFloat;
  it('uses floor semantics', () => {
    expect(arith('//', f(7.5), i(2))).toEqual(f(3));
    expect(arith('%', i(-7), i(3))).toEqual(i(2));
    expect(arith('%', i(7), i(-3))).toEqual(i(-2));
    expect(arith('//', i(-7), i(2))).toEqual(i(-4));
    expect(arith('/', i(1), i(3))).toEqual(f(1 / 3));
  });
  it('raises DIVISION_BY_ZERO and INT_OVERFLOW', () => {
    expect(errorCode(() => arith('/', i(1), i(0)))).toBe('DIVISION_BY_ZERO');
    expect(errorCode(() => arith('%', f(1), f(-0)))).toBe('DIVISION_BY_ZERO');
    expect(errorCode(() => arith('*', i(2 ** 30), i(2 ** 30)))).toBe('INT_OVERFLOW');
    expect(errorCode(() => arith('+', i(Number.MAX_SAFE_INTEGER), i(1)))).toBe('INT_OVERFLOW');
  });
  it('never produces int -0', () => {
    expect(Object.is(negate(i(0)).v, 0)).toBe(true);
    expect(Object.is(arith('*', i(0), i(-5)).v, 0)).toBe(true);
    expect(Object.is(negate(f(0)).v, -0)).toBe(true);
  });
  it('concatenates text and lists', () => {
    expect(arith('+', pyText('a'), pyText('b'))).toEqual(pyText('ab'));
    expect(arith('+', pyList([i(1)]), pyList([i(2)]))).toEqual(pyList([i(1), i(2)]));
  });
});

describe('equality and ordering', () => {
  it('compares numbers across int/float', () => {
    expect(pyEquals(pyInt(1), pyFloat(1))).toBe(true);
    expect(compare('<', pyInt(1), pyFloat(1.5))).toBe(true);
    expect(compare('<=', pyFloat(NaN), pyFloat(NaN))).toBe(false);
  });
  it('compares paths case-insensitively and lists element-wise', () => {
    expect(pyEquals(pyPath('Docs/A.txt'), pyPath('docs/a.TXT'))).toBe(true);
    expect(pyEquals(pyList([pyPath('A')]), pyList([pyPath('a')]))).toBe(true);
    expect(pyEquals(pyList([pyInt(1)]), pyList([pyInt(1), pyInt(2)]))).toBe(false);
    expect(compare('!=', pyText('a'), pyText('A'))).toBe(true);
  });
  it('orders text by code point', () => {
    expect(compare('<', pyText('\uff5e'), pyText('\u{1f600}'))).toBe(true);
    expect(compare('<', pyText('B'), pyText('a'))).toBe(true);
    expect(compare('>=', pyText('b'), pyText('b'))).toBe(true);
  });
});

describe('pyStr', () => {
  const rows = (table as { str: { value: Enc; str: string }[] }).str;
  it.each(rows.map((r) => [r.str, r.value] as const))('str → %s', (s, v) => {
    expect(pyStr(dec(v))).toBe(s);
  });
  it('formats scalars like Python', () => {
    const cases: [Value, string][] = [
      [{ t: 'bool', v: true }, 'True'],
      [{ t: 'bool', v: false }, 'False'],
      [pyPath(''), '.'],
      [pyPath('a/b'), 'a/b'],
      [pyFloat(6), '6.0'],
      [pyText('x'), 'x'],
      [pyList([pyInt(1), pyText("it's")]), `[1, "it's"]`],
    ];
    for (const [v, s] of cases) expect(pyStr(v)).toBe(s);
  });
});
