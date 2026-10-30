/**
 * Translation of the portable regex subset (design.md §5.4) and wildcards (§5.6) to JS RegExp
 * so that matching behaves like Python `re` with `re.ASCII` (and no other flags).
 *
 * Differences handled (JS `u` flag vs Python `re.ASCII`):
 *  - `\s` / `\S`: JS matches Unicode spaces; Python ASCII matches only `[ \t\n\r\f\v]`.
 *  - `.`: JS excludes `\n \r \u2028 \u2029`; Python excludes only `\n`.
 *  - `$`: Python also matches just before a trailing `\n` at the end of the string.
 *  - `\-` outside a class is a syntax error under `u`; it is a literal `-`.
 * `\d`, `\w`, `\D`, `\W` already mean the ASCII sets in JS (no `i` flag).
 */

const SPACE_CHARS = '\\t\\n\\v\\f\\r ';
/** Complement of the ASCII whitespace set, for use inside a character class. */
const NON_SPACE_RANGES = '\\x00-\\x08\\x0e-\\x1f\\x21-\\u{10FFFF}';

const cache = new Map<string, RegExp>();

/** Translates a validated pattern to an equivalent JS source (to be compiled with `u`). */
export function translateRegex(pattern: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      const e = pattern[i + 1] ?? '';
      i += 1;
      if (e === 's') out += inClass ? SPACE_CHARS : `[${SPACE_CHARS}]`;
      else if (e === 'S') out += inClass ? NON_SPACE_RANGES : `[^${SPACE_CHARS}]`;
      else if (e === '-' && !inClass) out += '-';
      else out += `\\${e}`;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      // A leading `^` (negation) is copied by the next iteration as an ordinary class char.
      continue;
    }
    if (c === '.') out += '[^\\n]';
    else if (c === '$') out += '(?=\\n?$)';
    else out += c;
  }
  return out;
}

export function compileRegex(pattern: string, global = false): RegExp {
  const key = `${global ? 'g' : '-'}${pattern}`;
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(translateRegex(pattern), global ? 'gu' : 'u');
    cache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

/** `re.search` semantics. */
export function regexMatch(text: string, pattern: string): boolean {
  return compileRegex(pattern).test(text);
}

type ReplPart = { lit: string } | { group: number };

/** Parses a replacement: `\1`–`\9` are groups, `\\` is a backslash, everything else literal. */
export function parseReplacement(repl: string): ReplPart[] {
  const parts: ReplPart[] = [];
  let lit = '';
  for (let i = 0; i < repl.length; i++) {
    const c = repl[i]!;
    const e = repl[i + 1];
    if (c === '\\' && e !== undefined && /[1-9]/.test(e)) {
      if (lit) parts.push({ lit });
      lit = '';
      parts.push({ group: Number(e) });
      i += 1;
    } else if (c === '\\' && e === '\\') {
      lit += '\\';
      i += 1;
    } else {
      lit += c;
    }
  }
  if (lit) parts.push({ lit });
  return parts;
}

/** `re.sub(pattern, repl, text)`: all matches; unmatched groups give ''. */
export function regexReplace(text: string, pattern: string, repl: string): string {
  const parts = parseReplacement(repl);
  // A function replacer sidesteps JS `$` patterns entirely.
  return text.replace(compileRegex(pattern, true), (...m: unknown[]) =>
    parts
      .map((p) =>
        'lit' in p ? p.lit : typeof m[p.group] === 'string' ? (m[p.group] as string) : '',
      )
      .join(''),
  );
}

// `-` and `/` are deliberately not escaped: `\-` outside a class is a syntax error under `u`.
const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * Wildcard match: `*` any run (including empty), `?` exactly one code point, everything else
 * literal; whole string; compares `lower()` of both sides.
 */
export function wildcardMatch(text: string, pattern: string): boolean {
  let src = '';
  for (const ch of pattern.toLowerCase()) {
    if (ch === '*') src += '[^]*';
    else if (ch === '?') src += '[^]';
    else src += escapeRe(ch);
  }
  return new RegExp(`^${src}$`, 'u').test(text.toLowerCase());
}
