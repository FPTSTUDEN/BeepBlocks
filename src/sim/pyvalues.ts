/**
 * Python value semantics over `Value` (design.md §5.1, §5.6).
 *
 * The simulator emulates Python, not JavaScript: int/float distinction, floor division and
 * modulo with the sign of the divisor, `str()` / `repr()` formatting, code-point text order,
 * and case-insensitive path equality.
 */
import type { Value } from '../ir/timeline.ts';
import type { ArithOp, CompareOp } from '../ir/types.ts';
import { compareCodePoints } from '../domains/fileExplorer/fsTypes.ts';
import { SimError, internal } from './errors.ts';

export type IntValue = Extract<Value, { t: 'int' }>;
export type FloatValue = Extract<Value, { t: 'float' }>;
export type NumValue = IntValue | FloatValue;
export type ListValue = Extract<Value, { t: 'list' }>;

// ------------------------------------------------------------- constructors

/** Int value; raises INT_OVERFLOW outside the safe-integer range; normalizes -0 to 0. */
export function pyInt(v: number): IntValue {
  if (!Number.isSafeInteger(v)) {
    throw new SimError(
      'INT_OVERFLOW',
      'This whole number got too large for the simulator (more than 9007199254740991).',
    );
  }
  return { t: 'int', v: v === 0 ? 0 : v };
}

export const pyFloat = (v: number): FloatValue => ({ t: 'float', v });
export const pyText = (v: string): Value => ({ t: 'text', v });
export const pyBool = (v: boolean): Value => ({ t: 'bool', v });
export const pyPath = (v: string): Value => ({ t: 'path', v });
export const pyList = (v: Value[]): ListValue => ({ t: 'list', v });

export function isNum(v: Value): v is NumValue {
  return v.t === 'int' || v.t === 'float';
}

/** Number literal per design.md §4.1: integral and not marked float → int. */
export function numberLiteral(value: number, isFloat: boolean | undefined): NumValue {
  return Number.isInteger(value) && isFloat !== true ? pyInt(value) : pyFloat(value);
}

// --------------------------------------------------------------- arithmetic

const divByZero = (): never => {
  throw new SimError('DIVISION_BY_ZERO', 'Cannot divide by zero.');
};

/** Python float floor division (CPython `float_floor_div`). */
export function floatFloorDiv(x: number, y: number): number {
  if (y === 0) divByZero();
  return floatDivmod(x, y)[0];
}

/** Python float modulo (CPython `float_rem`): result has the sign of the divisor. */
export function floatMod(x: number, y: number): number {
  if (y === 0) divByZero();
  return floatDivmod(x, y)[1];
}

/** CPython `_float_div_mod`. */
function floatDivmod(vx: number, wx: number): [number, number] {
  let mod = vx % wx; // fmod
  let div = (vx - mod) / wx;
  if (mod !== 0) {
    if (wx < 0 !== mod < 0) {
      mod += wx;
      div -= 1.0;
    }
  } else {
    mod = copySign(0.0, wx);
  }
  let floordiv: number;
  if (div !== 0) {
    floordiv = Math.floor(div);
    if (div - floordiv > 0.5) floordiv += 1.0;
  } else {
    floordiv = copySign(0.0, vx / wx);
  }
  return [floordiv, mod];
}

function copySign(mag: number, sign: number): number {
  const neg = sign < 0 || Object.is(sign, -0);
  return neg ? -Math.abs(mag) : Math.abs(mag);
}

function intFloorDiv(a: number, b: number): number {
  if (b === 0) divByZero();
  const A = BigInt(a);
  const B = BigInt(b);
  let q = A / B;
  if (A % B !== 0n && A < 0n !== B < 0n) q -= 1n;
  return Number(q);
}

function intMod(a: number, b: number): number {
  if (b === 0) divByZero();
  let r = a % b;
  if (r !== 0 && r < 0 !== b < 0) r += b;
  return r;
}

/** Arithmetic on numbers per Python; int ∘ int stays int except `/`. */
export function arithNum(op: ArithOp, a: NumValue, b: NumValue): NumValue {
  if (a.t === 'int' && b.t === 'int') {
    const x = a.v;
    const y = b.v;
    switch (op) {
      case '+':
        return pyInt(x + y);
      case '-':
        return pyInt(x - y);
      case '*':
        return pyInt(x * y);
      case '/':
        if (y === 0) divByZero();
        return pyFloat(x / y);
      case '//':
        return pyInt(intFloorDiv(x, y));
      case '%':
        return pyInt(intMod(x, y));
    }
  }
  const x = a.v;
  const y = b.v;
  switch (op) {
    case '+':
      return pyFloat(x + y);
    case '-':
      return pyFloat(x - y);
    case '*':
      return pyFloat(x * y);
    case '/':
      if (y === 0) divByZero();
      return pyFloat(x / y);
    case '//':
      return pyFloat(floatFloorDiv(x, y));
    case '%':
      return pyFloat(floatMod(x, y));
  }
}

/** Binary arithmetic over any values the typechecker allows (`+` also on text and lists). */
export function arith(op: ArithOp, a: Value, b: Value): Value {
  if (op === '+') {
    if (a.t === 'text' && b.t === 'text') return pyText(a.v + b.v);
    if (a.t === 'list' && b.t === 'list') return pyList([...a.v, ...b.v]);
  }
  if (isNum(a) && isNum(b)) return arithNum(op, a, b);
  return internal(`"${op}" on ${a.t} and ${b.t}`);
}

/** Unary minus: int 0 stays 0 (never -0); float keeps IEEE sign. */
export function negate(a: Value): NumValue {
  if (a.t === 'int') return pyInt(-a.v);
  if (a.t === 'float') return pyFloat(-a.v);
  return internal(`negate ${a.t}`);
}

// ------------------------------------------------------ equality and order

/** Python `==`. Numbers compare by value across int/float; paths ignore case; lists element-wise. */
export function pyEquals(a: Value, b: Value): boolean {
  if (isNum(a) && isNum(b)) return a.v === b.v;
  switch (a.t) {
    case 'text':
      return b.t === 'text' && a.v === b.v;
    case 'bool':
      return b.t === 'bool' && a.v === b.v;
    case 'path':
      return b.t === 'path' && a.v.toLowerCase() === b.v.toLowerCase();
    case 'list':
      return (
        b.t === 'list' && a.v.length === b.v.length && a.v.every((x, i) => pyEquals(x, b.v[i]!))
      );
    default:
      return false;
  }
}

/** Python `<` on numbers or text (text by Unicode code point). */
export function pyLess(a: Value, b: Value): boolean {
  if (isNum(a) && isNum(b)) return a.v < b.v;
  if (a.t === 'text' && b.t === 'text') return compareCodePoints(a.v, b.v) < 0;
  return internal(`"<" on ${a.t} and ${b.t}`);
}

export function compare(op: CompareOp, a: Value, b: Value): boolean {
  switch (op) {
    case '==':
      return pyEquals(a, b);
    case '!=':
      return !pyEquals(a, b);
    case '<':
      return pyLess(a, b);
    case '>':
      return pyLess(b, a);
    // Python evaluates a <= b as `a <= b`, which for NaN is false (not `not b < a`).
    case '<=':
      return pyLess(a, b) || (pyEqualsOrdered(a, b) ?? false);
    case '>=':
      return pyLess(b, a) || (pyEqualsOrdered(a, b) ?? false);
  }
}

function pyEqualsOrdered(a: Value, b: Value): boolean | null {
  if (isNum(a) && isNum(b)) return a.v === b.v;
  if (a.t === 'text' && b.t === 'text') return a.v === b.v;
  return null;
}

// --------------------------------------------------------------- formatting

/**
 * Python `repr(float)`: shortest round-trip digits; fixed notation when the decimal exponent
 * is in [-4, 16), otherwise scientific with a signed, at-least-2-digit exponent.
 */
export function formatPyFloat(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  // toExponential() without an argument yields the shortest round-trip digits.
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(Math.abs(x).toExponential());
  if (!m) return internal(`cannot format ${x}`);
  const digits = m[1]! + (m[2] ?? '');
  const exp = Number(m[3]);
  const decpt = exp + 1; // position of the decimal point relative to the digits
  if (decpt <= -4 || decpt > 16) {
    const mant = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
    const e = Math.abs(exp).toString().padStart(2, '0');
    return `${sign}${mant}e${exp < 0 ? '-' : '+'}${e}`;
  }
  if (decpt <= 0) return `${sign}0.${'0'.repeat(-decpt)}${digits}`;
  if (decpt >= digits.length) return `${sign}${digits}${'0'.repeat(decpt - digits.length)}.0`;
  return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
}

/** Python `str()` of a value. Paths print relative POSIX, `.` for the root. */
export function pyStr(v: Value): string {
  switch (v.t) {
    case 'int':
      return String(v.v);
    case 'float':
      return formatPyFloat(v.v);
    case 'text':
      return v.v;
    case 'bool':
      return v.v ? 'True' : 'False';
    case 'path':
      return v.v === '' ? '.' : v.v;
    case 'list':
      return `[${v.v.map(pyRepr).join(', ')}]`;
  }
}

/** Python-like `repr()` (used only for lists, which `text.from` cannot receive). */
export function pyRepr(v: Value): string {
  if (v.t === 'text') {
    const s = v.v.replace(/\\/g, '\\\\');
    if (s.includes("'") && !s.includes('"')) return `"${s}"`;
    return `'${s.replace(/'/g, "\\'")}'`;
  }
  if (v.t === 'path') return `'${pyStr(v)}'`;
  return pyStr(v);
}

/** Deep copy for snapshots: lists are copied recursively, scalars are immutable. */
export function deepCopy(v: Value): Value {
  return v.t === 'list' ? { t: 'list', v: v.v.map(deepCopy) } : v;
}
