import { describe, expect, it } from 'vitest';
import { checkName, compareCodePoints, compareNames, fileSize, getNode } from './fsTypes.ts';

describe('checkName', () => {
  it.each(['report.pdf', '.bashrc', 'a b', 'CONSOLE.txt', 'résumé', 'x'.repeat(255)])('accepts %j', (n) =>
    expect(checkName(n)).toBeNull(),
  );
  it.each(['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a?', 'a*', 'tab\there', 'end.', 'end ', 'CON', 'con.txt', 'Lpt9.log', 'x'.repeat(256)])(
    'rejects %j',
    (n) => expect(checkName(n)).not.toBeNull(),
  );
});

describe('ordering', () => {
  it('sorts case-insensitively, then by code point', () => {
    expect(['b', 'B', 'a', 'A'].sort(compareNames)).toEqual(['A', 'a', 'B', 'b']);
  });
  it('compares by code point, not UTF-16', () => {
    // U+FF5E (BMP) vs U+1F600 (astral): code-point order puts the BMP char first.
    expect(compareCodePoints('\uff5e', '\u{1f600}')).toBe(-1);
    expect('\uff5e' < '\u{1f600}').toBe(false); // JS default would get this wrong
  });
});

describe('helpers', () => {
  it('measures UTF-8 size', () => {
    expect(fileSize({ type: 'file', name: 'a', modified: 0, content: 'é' })).toBe(2);
    expect(fileSize({ type: 'file', name: 'a', modified: 0, binarySize: 7 })).toBe(7);
  });
  it('looks up paths case-insensitively', () => {
    const fs = {
      root: {
        type: 'folder' as const,
        name: '',
        modified: 0,
        children: [{ type: 'folder' as const, name: 'Docs', modified: 0, children: [] }],
      },
    };
    expect(getNode(fs, 'docs')?.name).toBe('Docs');
    expect(getNode(fs, 'docs/x')).toBeUndefined();
    expect(getNode(fs, '')).toBe(fs.root);
  });
});
