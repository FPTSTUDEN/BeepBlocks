import { describe, expect, it } from 'vitest';
import { checkRegex, checkRegexReplacement, parseTemplate, checkWildcard } from './syntax.ts';

describe('template', () => {
  it('parses placeholders and literal braces', () => {
    const r = parseTemplate('photo_{n:3}_{name}{{x}}{ext}{date}');
    expect(r).toEqual({
      ok: true,
      parts: [
        { kind: 'lit', text: 'photo_' },
        { kind: 'n', width: 3 },
        { kind: 'lit', text: '_' },
        { kind: 'name' },
        { kind: 'lit', text: '{x}' },
        { kind: 'ext' },
        { kind: 'date' },
      ],
    });
  });
  it.each(['', '{', 'a}', '{nme}', '{n:0}', '{n:10}'])('rejects %j', (t) =>
    expect(parseTemplate(t).ok).toBe(false),
  );
});

describe('wildcard', () => {
  it('rejects empty and path separators', () => {
    expect(checkWildcard('*.jpg')).toBeNull();
    expect(checkWildcard('')).not.toBeNull();
    expect(checkWildcard('a/*')).not.toBeNull();
  });
});

describe('regex subset', () => {
  it.each([
    ['^IMG_\\d{4}\\.jpe?g$', 0],
    ['(a|b)+?c', 1],
    ['(?:x)(y)(z)', 2],
    ['[A-Za-z_\\-]+', 0],
    ['[^\\s]*', 0],
    ['a{2,}', 0],
    ['.\\.', 0],
  ])('accepts %j', (p, groups) => expect(checkRegex(p)).toEqual({ error: null, groups }));

  it.each([
    '(?=a)',
    '(?<n>a)',
    '(?i)a',
    '(a)\\1',
    '\\bword',
    '*a',
    'a**',
    'a*+',
    '(a',
    'a)',
    '[a',
    '[]',
    'a{',
    'a{3,1}',
    '\\p{L}',
    'a]',
    '\\',
  ])('rejects %j', (p) => expect(checkRegex(p).error).not.toBeNull());

  it('checks replacements against group count', () => {
    expect(checkRegexReplacement('\\1-\\\\', 1)).toBeNull();
    expect(checkRegexReplacement('\\2', 1)).not.toBeNull();
    expect(checkRegexReplacement('\\n', 1)).not.toBeNull();
    expect(checkRegexReplacement('$1 cost', 0)).toBeNull();
  });
});
