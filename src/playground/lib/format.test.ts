import { describe, expect, it } from 'vitest';
import {
  extensionOf,
  fileKind,
  formatDate,
  formatPyFloat,
  formatValue,
  fromDateTimeInput,
  humanSize,
  toDateTimeInput,
  valueType,
} from './format.ts';
import { displayPath, isWithin, rebase, ancestorsOf } from './paths.ts';

describe('formatPyFloat', () => {
  it.each([
    [5, '5.0'],
    [0.5, '0.5'],
    [-2.25, '-2.25'],
    [0.1 + 0.2, '0.30000000000000004'],
    [1e-5, '1e-05'],
    [0.0001, '0.0001'],
    [1e16, '1e+16'],
    [1234567890123456, '1234567890123456.0'],
    [1.5e300, '1.5e+300'],
    [-0, '-0.0'],
    [0, '0.0'],
    [Infinity, 'inf'],
    [NaN, 'nan'],
  ])('%s → %s', (v, s) => expect(formatPyFloat(v)).toBe(s));
});

describe('formatValue / valueType', () => {
  it('formats scalars like Python', () => {
    expect(formatValue({ t: 'int', v: 5 })).toBe('5');
    expect(formatValue({ t: 'float', v: 5 })).toBe('5.0');
    expect(formatValue({ t: 'text', v: 'a"b' })).toBe('"a\\"b"');
    expect(formatValue({ t: 'bool', v: true })).toBe('True');
    expect(formatValue({ t: 'path', v: 'a/b.txt' })).toBe('./a/b.txt');
    expect(formatValue({ t: 'path', v: '' })).toBe('.');
  });

  it('truncates lists', () => {
    const list = { t: 'list' as const, v: [1, 2, 3, 4, 5].map((v) => ({ t: 'int' as const, v })) };
    expect(formatValue(list)).toBe('[1, 2, 3, … (+2 more)]');
    expect(formatValue({ t: 'list', v: [] })).toBe('[]');
    expect(valueType(list)).toBe('list of number');
    expect(valueType({ t: 'list', v: [] })).toBe('list');
    expect(valueType({ t: 'float', v: 1 })).toBe('number');
    expect(valueType({ t: 'path', v: '' })).toBe('path');
  });
});

describe('sizes, dates, kinds', () => {
  it('humanSize', () => {
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(999)).toBe('999 B');
    expect(humanSize(1500)).toBe('1.5 KB');
    expect(humanSize(180_000)).toBe('180 KB');
    expect(humanSize(2_400_000)).toBe('2.4 MB');
    expect(humanSize(4_000_000)).toBe('4 MB');
    expect(humanSize(3_000_000_000)).toBe('3 GB');
  });

  it('formatDate is UTC YYYY-MM-DD HH:mm', () => {
    expect(formatDate(1_759_276_800)).toBe('2025-10-01 00:00');
    expect(formatDate(1_759_276_800 + 3661)).toBe('2025-10-01 01:01');
  });

  it('datetime input round-trips in UTC', () => {
    expect(toDateTimeInput(1_759_276_800)).toBe('2025-10-01T00:00');
    expect(fromDateTimeInput('2025-10-01T00:00')).toBe(1_759_276_800);
    expect(fromDateTimeInput('2025-10-01T00:00:30')).toBe(1_759_276_830);
    expect(fromDateTimeInput('nope')).toBeNull();
  });

  it('file kinds by extension', () => {
    expect(extensionOf('report.final.pdf')).toBe('pdf');
    expect(extensionOf('.bashrc')).toBe('');
    expect(fileKind({ type: 'file', name: 'IMG.JPG', modified: 0, binarySize: 1 }).label).toBe(
      'Image',
    );
    expect(fileKind({ type: 'file', name: 'x.unknown', modified: 0, content: '' }).label).toBe(
      'File',
    );
    expect(fileKind({ type: 'folder', name: 'a', modified: 0, children: [] }).label).toBe('Folder');
  });
});

describe('paths', () => {
  it('isWithin / rebase / ancestors / display', () => {
    expect(isWithin('A/b.txt', 'a')).toBe(true);
    expect(isWithin('ab/c', 'a')).toBe(false);
    expect(isWithin('x', '')).toBe(true);
    expect(rebase('Docs/a.txt', 'docs', 'Papers')).toBe('Papers/a.txt');
    expect(rebase('other', 'docs', 'Papers')).toBeNull();
    expect(ancestorsOf('a/b/c')).toEqual(['', 'a', 'a/b']);
    expect(ancestorsOf('')).toEqual([]);
    expect(displayPath('a')).toBe('./a');
  });
});
