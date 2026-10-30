/** Text ops (design.md §5.2, §5.6). */
import { SimError } from '../errors.ts';
import { pyBool, pyFloat, pyInt, pyStr, pyText } from '../pyvalues.ts';
import { arg, intArg, num, pure, text, type OpImpl } from './types.ts';
import { regexMatch, regexReplace, wildcardMatch } from './regex.ts';

const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function toNumber(s: string) {
  if (INT_RE.test(s)) {
    const n = Number(s);
    if (!Number.isSafeInteger(n)) {
      throw new SimError('INT_OVERFLOW', `"${s}" is too large a whole number for the simulator.`);
    }
    return pyInt(n);
  }
  if (FLOAT_RE.test(s)) return pyFloat(Number(s));
  throw new SimError('INVALID_NUMBER', `"${s}" is not a number.`);
}

/** Python `str.replace(old, new)` (all occurrences; empty `old` inserts between code points). */
export function pyReplace(s: string, old: string, rep: string): string {
  if (old === '') return rep + [...s].map((c) => c + rep).join('');
  return s.split(old).join(rep);
}

/** Python `str(n).zfill(w)`. */
export function zfill(s: string, width: number): string {
  const len = [...s].length;
  if (len >= width) return s;
  const pad = '0'.repeat(width - len);
  if (s.startsWith('-') || s.startsWith('+')) return s[0] + pad + s.slice(1);
  return pad + s;
}

/** Round half to even (as CPython does for fromtimestamp microseconds). */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** `datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d')`. */
export function epochToDate(t: number): string {
  const micros = roundHalfEven(t * 1e6);
  const days = Math.floor(micros / 86_400e6);
  const d = new Date(days * 86_400_000);
  if (!Number.isFinite(t) || Number.isNaN(d.getTime()) || d.getUTCFullYear() > 9999) {
    throw new SimError('INVALID_NUMBER', `${t} is not a time that can be shown as a date.`);
  }
  return d.toISOString().slice(0, 10);
}

export const TEXT_OPS = {
  'text.from': pure((a) => pyText(pyStr(arg(a, 0)))),
  'text.toNumber': pure((a) => toNumber(text(a, 0))),
  'text.length': pure((a) => pyInt([...text(a, 0)].length)),
  'text.lower': pure((a) => pyText(text(a, 0).toLowerCase())),
  'text.upper': pure((a) => pyText(text(a, 0).toUpperCase())),
  'text.contains': pure((a) => pyBool(text(a, 0).includes(text(a, 1)))),
  'text.startsWith': pure((a) => pyBool(text(a, 0).startsWith(text(a, 1)))),
  'text.endsWith': pure((a) => pyBool(text(a, 0).endsWith(text(a, 1)))),
  'text.replace': pure((a) => pyText(pyReplace(text(a, 0), text(a, 1), text(a, 2)))),
  'text.padNumber': pure((a) => {
    const n = intArg(a, 0, 'The number to pad');
    const w = intArg(a, 1, 'The width');
    return pyText(zfill(String(n), w));
  }),
  'text.date': pure((a) => pyText(epochToDate(num(a, 0).v))),
  'text.wildcard': pure((a) => pyBool(wildcardMatch(text(a, 0), text(a, 1)))),
  'text.regexMatch': pure((a) => pyBool(regexMatch(text(a, 0), text(a, 1)))),
  'text.regexReplace': pure((a) => pyText(regexReplace(text(a, 0), text(a, 1), text(a, 2)))),
} satisfies Record<string, OpImpl>;
