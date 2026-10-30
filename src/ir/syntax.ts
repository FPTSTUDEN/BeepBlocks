/**
 * Mini-language syntax shared by the validator and the composites/sim/export modules:
 * wildcard patterns, rename templates, and the portable regex subset (design.md §5.4, §6.2).
 */

// ================================================================== Wildcard

/** `*` = any run of characters, `?` = one character; whole-name, case-insensitive. */
export function checkWildcard(pattern: string): string | null {
  if (pattern.length === 0) return 'the pattern cannot be empty (use * for everything).';
  if (/[\\/]/.test(pattern)) return 'patterns match names only, so they cannot contain / or \\.';
  return null;
}

// ================================================================== Template

export type TemplatePart =
  | { kind: 'lit'; text: string }
  | { kind: 'name' }
  | { kind: 'ext' }
  | { kind: 'n'; width: number }
  | { kind: 'date' };

export type TemplateParse = { ok: true; parts: TemplatePart[] } | { ok: false; error: string };

/**
 * Parses a rename template: `{name}` `{ext}` `{n}` `{n:3}` `{date}`, `{{` and `}}` for literal braces.
 * Adjacent literal characters are merged into one part.
 */
export function parseTemplate(template: string): TemplateParse {
  const parts: TemplatePart[] = [];
  const lit = (s: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === 'lit') last.text += s;
    else parts.push({ kind: 'lit', text: s });
  };
  let i = 0;
  while (i < template.length) {
    const c = template[i]!;
    if (c === '{') {
      if (template[i + 1] === '{') {
        lit('{');
        i += 2;
        continue;
      }
      const end = template.indexOf('}', i);
      if (end < 0) return { ok: false, error: 'a "{" is never closed. Use {{ for a literal brace.' };
      const inner = template.slice(i + 1, end);
      const m = /^n(?::([1-9]))?$/.exec(inner);
      if (inner === 'name') parts.push({ kind: 'name' });
      else if (inner === 'ext') parts.push({ kind: 'ext' });
      else if (inner === 'date') parts.push({ kind: 'date' });
      else if (m) parts.push({ kind: 'n', width: m[1] ? Number(m[1]) : 0 });
      else {
        return {
          ok: false,
          error: `"{${inner}}" is not a known placeholder. Use {name}, {ext}, {n}, {n:3} or {date}.`,
        };
      }
      i = end + 1;
      continue;
    }
    if (c === '}') {
      if (template[i + 1] === '}') {
        lit('}');
        i += 2;
        continue;
      }
      return { ok: false, error: 'a "}" has no matching "{". Use }} for a literal brace.' };
    }
    lit(c);
    i += 1;
  }
  if (parts.length === 0) return { ok: false, error: 'the new name cannot be empty.' };
  return { ok: true, parts };
}

export function checkTemplate(template: string): string | null {
  const r = parseTemplate(template);
  return r.ok ? null : r.error;
}

// ===================================================================== Regex

export interface RegexCheck {
  error: string | null;
  /** Number of capturing groups. */
  groups: number;
}

const CLASS_ESCAPES = new Set(['d', 'D', 'w', 'W', 's', 'S']);
const LITERAL_ESCAPES = new Set(['\\', '.', '^', '$', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}', '/', '-']);
const CONTROL_ESCAPES = new Set(['n', 't', 'r']);

/**
 * Checks that `pattern` uses only the portable subset that behaves identically in
 * JS (`u` flag) and Python (`re.ASCII`). Lookarounds, backreferences, named groups,
 * inline flags, word boundaries and possessive quantifiers are rejected.
 */
export function checkRegex(pattern: string): RegexCheck {
  let groups = 0;
  let depth = 0;
  /** Whether the previous token can take a quantifier. */
  let canQuantify = false;
  /** Whether the previous token was a quantifier (to allow one lazy `?`). */
  let afterQuantifier = false;
  let afterLazy = false;
  const fail = (error: string): RegexCheck => ({ error, groups });

  const escape = (i: number, inClass: boolean): string | null => {
    const e = pattern[i + 1];
    if (e === undefined) return 'the pattern cannot end with a single \\.';
    if (CLASS_ESCAPES.has(e) || LITERAL_ESCAPES.has(e) || CONTROL_ESCAPES.has(e)) return null;
    if (/[1-9]/.test(e)) return 'back-references like \\1 are not supported in patterns.';
    if (e === 'b' || e === 'B') {
      return inClass ? '\\b is not supported inside [ ].' : 'word boundaries (\\b) are not supported.';
    }
    return `"\\${e}" is not supported; escape only punctuation, or use \\d \\w \\s.`;
  };

  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '\\') {
      const err = escape(i, false);
      if (err) return fail(err);
      i += 2;
      canQuantify = true;
      afterQuantifier = afterLazy = false;
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      if (pattern[j] === '^') j += 1;
      if (pattern[j] === ']') j += 1; // literal ] first is not portable in JS; reject below
      let closed = false;
      let empty = true;
      for (; j < pattern.length; j++) {
        const d = pattern[j]!;
        if (d === '\\') {
          const err = escape(j, true);
          if (err) return fail(err);
          j += 1;
          empty = false;
          continue;
        }
        if (d === '[') return fail('use \\[ for a literal [ inside [ ].');
        if (d === ']') {
          closed = true;
          break;
        }
        empty = false;
      }
      if (!closed) return fail('a "[" is never closed.');
      if (empty || pattern[i + 1] === ']' || (pattern[i + 1] === '^' && pattern[i + 2] === ']')) {
        return fail('character sets [ ] cannot be empty; use \\] for a literal ].');
      }
      i = j + 1;
      canQuantify = true;
      afterQuantifier = afterLazy = false;
      continue;
    }
    if (c === '(') {
      if (pattern[i + 1] === '?') {
        if (pattern[i + 2] !== ':') {
          return fail('only plain groups ( ) and non-capturing groups (?: ) are supported.');
        }
        i += 3;
      } else {
        groups += 1;
        i += 1;
      }
      depth += 1;
      canQuantify = false;
      afterQuantifier = afterLazy = false;
      continue;
    }
    if (c === ')') {
      if (depth === 0) return fail('a ")" has no matching "(".');
      depth -= 1;
      i += 1;
      canQuantify = true;
      afterQuantifier = afterLazy = false;
      continue;
    }
    if (c === '*' || c === '+' || c === '?' || c === '{') {
      let len = 1;
      if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
        if (!m) return fail('use \\{ for a literal {, or {m}, {m,} or {m,n} to repeat.');
        if (m[3] !== undefined && m[3] !== '' && Number(m[3]) < Number(m[1])) {
          return fail(`in {${m[1]},${m[3]}} the second number must not be smaller.`);
        }
        len = m[0].length;
      }
      if (c === '?' && afterQuantifier && !afterLazy) {
        afterLazy = true;
        i += 1;
        continue;
      }
      if (afterQuantifier) return fail('two repeat symbols in a row are not supported.');
      if (!canQuantify) return fail(`"${c}" must come after something to repeat.`);
      i += len;
      canQuantify = false;
      afterQuantifier = true;
      afterLazy = false;
      continue;
    }
    if (c === ']') return fail('use \\] for a literal ].');
    if (c === '}') return fail('use \\} for a literal }.');
    // '|', '^', '$' are not quantifiable; everything else (including '.') is an atom.
    canQuantify = !(c === '|' || c === '^' || c === '$');
    afterQuantifier = afterLazy = false;
    i += 1;
  }
  if (depth > 0) return fail('a "(" is never closed.');
  try {
    new RegExp(pattern, 'u');
  } catch {
    return fail('this pattern is not valid.');
  }
  return { error: null, groups };
}

/** Replacement strings: `\1`–`\9` refer to groups, `\\` is a backslash; everything else is literal. */
export function checkRegexReplacement(replacement: string, groups: number): string | null {
  for (let i = 0; i < replacement.length; i++) {
    if (replacement[i] !== '\\') continue;
    const e = replacement[i + 1];
    if (e === '\\') {
      i += 1;
      continue;
    }
    if (e !== undefined && /[1-9]/.test(e)) {
      if (Number(e) > groups) return `\\${e} refers to group ${e}, but the pattern has ${groups}.`;
      i += 1;
      continue;
    }
    return 'in a replacement, use \\1–\\9 for groups and \\\\ for a backslash.';
  }
  return null;
}
