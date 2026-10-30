/**
 * Python source-text helpers: safe string and number literals, comment and docstring text.
 */

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');

/**
 * Characters that are valid in Python source but invisible or misleading to a reader
 * (line/paragraph separators, BOM, zero-width and bidi controls). Escaped in literals and
 * replaced in comments, so a name cannot hide code ("Trojan Source").
 */
const INVISIBLE = /[\u0085\u00a0\u061c\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;

/** A double-quoted Python string literal that evaluates to exactly `s`. */
export function pyString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const c = s.charCodeAt(i);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) out += `\\x${hex(c, 2)}`;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += ch + s[i + 1]!;
        i += 1;
      } else out += `\\u${hex(c, 4)}`;
    } else if (c >= 0xdc00 && c <= 0xdfff) out += `\\u${hex(c, 4)}`;
    else if (INVISIBLE.test(ch)) out += `\\u${hex(c, 4)}`;
    else out += ch;
  }
  return `${out}"`;
}

/**
 * A literal for a regex pattern: a raw string (`r"\d+"`) when that is unambiguous, otherwise
 * an ordinary string literal.
 */
export function pyPatternString(s: string): string {
  const trailing = /\\*$/.exec(s)![0].length;
  if (/^[\x20-\x7e]*$/.test(s) && !s.includes('"') && trailing % 2 === 0) return `r"${s}"`;
  return pyString(s);
}

/** A Python number literal: ints as decimal, floats always with `.`, `e`, so they stay floats. */
export function pyNumber(value: number, isFloat: boolean): string {
  if (Number.isInteger(value) && !isFloat) return value === 0 ? '0' : String(value);
  if (Object.is(value, -0)) return '-0.0';
  const s = String(value);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Single-line, printable text for a `#` comment. */
export function commentText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || INVISIBLE.test(ch)) out += ' ';
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += ch + s[i + 1]!;
        i += 1;
      } else out += '\ufffd';
    } else if (c >= 0xdc00 && c <= 0xdfff) out += '\ufffd';
    else out += ch;
  }
  return out.replace(/\s+$/, '');
}

/** Body text for a raw (`r"""`) docstring: no `"""`, no `\` right before a quote. */
export function docstringText(s: string): string {
  const lines = s.split('\n').map(commentText);
  let out = lines.join('\n').replace(/\\(?=")/g, '\\ ');
  while (out.includes('"""')) out = out.replace(/"""/g, `"'"`);
  return out;
}

/** Shortens `s` to at most `max` characters (code points), ending with an ellipsis. */
export function truncate(s: string, max: number): string {
  const cps = [...s];
  return cps.length <= max ? s : `${cps.slice(0, max - 1).join('')}\u2026`;
}
