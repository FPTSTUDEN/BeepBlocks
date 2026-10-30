import { describe, expect, it } from 'vitest';
import { OP_NAMES, OPS, type OpName } from '../../ir/ops.ts';
import type { Value } from '../../ir/timeline.ts';
import { compareNames, type FsNode, type SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { SimError } from '../errors.ts';
import { pyBool, pyFloat, pyInt, pyList, pyPath, pyText } from '../pyvalues.ts';
import { SIM_OPS } from './index.ts';
import { translateRegex } from './regex.ts';

const FS: SandboxFS = {
  root: {
    type: 'folder',
    name: '',
    modified: 0,
    children: (
      [
        { type: 'file', name: 'b.TXT', modified: 30, content: 'xyz' },
        { type: 'file', name: 'a.jpg', modified: 10, binarySize: 50 },
        { type: 'file', name: 'C.txt', modified: 20, content: '' },
      ] as FsNode[]
    ).sort((x, y) => compareNames(x.name, y.name)),
  },
};

const call = (op: OpName, ...args: Value[]) => SIM_OPS[op]({ fs: FS, now: 100 }, args).value;
const t = pyText;
const i = pyInt;
const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof SimError) return e.code;
    throw e;
  }
};

describe('completeness', () => {
  it('implements every op in the registry', () => {
    for (const name of OP_NAMES) expect(typeof SIM_OPS[name], name).toBe('function');
    expect(Object.keys(SIM_OPS).sort()).toEqual([...OP_NAMES].sort());
  });
  it('read ops report readPaths and file ops report an action', () => {
    for (const name of OP_NAMES) {
      const sig = OPS[name];
      if (sig.counter === 'none') continue;
      const args: Value[] =
        name === 'fs.writeText'
          ? [pyPath('new.txt'), t('x')]
          : name === 'fs.rename'
            ? [pyPath('b.txt'), t('d.txt')]
            : name === 'fs.move' || name === 'fs.copy'
              ? [pyPath('b.txt'), pyPath('nope')]
              : name === 'fs.makeFolder'
                ? [pyPath('dir')]
                : [pyPath(name === 'fs.list' || name === 'fs.walk' ? '' : 'b.txt')];
      if (name === 'fs.move' || name === 'fs.copy') {
        expect(code(() => SIM_OPS[name]({ fs: FS, now: 1 }, args))).toBe('NOT_FOUND');
        continue;
      }
      const r = SIM_OPS[name]({ fs: FS, now: 1 }, args);
      if (sig.counter === 'read') expect(r.readPaths, name).toBeDefined();
      else expect(r.action, name).toBeDefined();
    }
  });
});

describe('text ops', () => {
  it('text.from is Python str()', () => {
    expect(call('text.from', pyFloat(5))).toEqual(t('5.0'));
    expect(call('text.from', pyBool(false))).toEqual(t('False'));
    expect(call('text.from', pyPath(''))).toEqual(t('.'));
  });
  it('text.toNumber', () => {
    expect(call('text.toNumber', t('+42'))).toEqual(i(42));
    expect(call('text.toNumber', t('-0'))).toEqual(i(0));
    expect(call('text.toNumber', t('007'))).toEqual(i(7));
    expect(call('text.toNumber', t('1.'))).toEqual(pyFloat(1));
    expect(call('text.toNumber', t('.5e1'))).toEqual(pyFloat(5));
    for (const bad of [' 1', '1_0', 'inf', 'nan', '', '.', '1e', '٣', '0x1']) {
      expect(
        code(() => call('text.toNumber', t(bad))),
        bad,
      ).toBe('INVALID_NUMBER');
    }
    expect(code(() => call('text.toNumber', t('99999999999999999999')))).toBe('INT_OVERFLOW');
  });
  it('length counts code points; case; contains; replace', () => {
    expect(call('text.length', t('a\u{1f600}'))).toEqual(i(2));
    expect(call('text.upper', t('straße'))).toEqual(t('STRASSE'));
    expect(call('text.lower', t('ABC'))).toEqual(t('abc'));
    expect(call('text.contains', t('hello'), t('ell'))).toEqual(pyBool(true));
    expect(call('text.startsWith', t('hello'), t('he'))).toEqual(pyBool(true));
    expect(call('text.endsWith', t('hello'), t('lo'))).toEqual(pyBool(true));
    expect(call('text.replace', t('a.b.c'), t('.'), t('$&'))).toEqual(t('a$&b$&c'));
    expect(call('text.replace', t('abc'), t(''), t('-'))).toEqual(t('-a-b-c-'));
  });
  it('padNumber is str(n).zfill(w) and requires ints', () => {
    expect(call('text.padNumber', i(7), i(3))).toEqual(t('007'));
    expect(call('text.padNumber', i(-5), i(3))).toEqual(t('-05'));
    expect(call('text.padNumber', i(1234), i(2))).toEqual(t('1234'));
    expect(code(() => call('text.padNumber', pyFloat(2), i(3)))).toBe('INVALID_NUMBER');
    expect(code(() => call('text.padNumber', i(2), pyFloat(3)))).toBe('INVALID_NUMBER');
  });
  it('text.date is the UTC date', () => {
    expect(call('text.date', i(1767225600))).toEqual(t('2026-01-01'));
    expect(call('text.date', i(1767225599))).toEqual(t('2025-12-31'));
    expect(call('text.date', pyFloat(86399.9999999))).toEqual(t('1970-01-02'));
  });
  it('wildcard: * ? literal, whole string, case-insensitive', () => {
    const w = (s: string, p: string) => (call('text.wildcard', t(s), t(p)) as { v: boolean }).v;
    expect(w('IMG_0001.JPG', 'img_*.jpg')).toBe(true);
    expect(w('a.jpg.bak', '*.jpg')).toBe(false);
    expect(w('', '*')).toBe(true);
    expect(w('ab', 'a?')).toBe(true);
    expect(w('a\u{1f600}', 'a?')).toBe(true);
    expect(w('abc', 'a?')).toBe(false);
    expect(w('[x].txt', '[x].*')).toBe(true);
    expect(w('x.txt', '[x].*')).toBe(false);
    expect(w('a+b(1)', 'a+b(?)')).toBe(true);
  });
  it('regex subset behaves like Python re.ASCII (values checked with CPython 3.13)', () => {
    const sub = (s: string, p: string, r: string) =>
      (call('text.regexReplace', t(s), t(p), t(r)) as { v: string }).v;
    const m = (s: string, p: string) => (call('text.regexMatch', t(s), t(p)) as { v: boolean }).v;
    expect(sub('a 12-34 b 5-6', '(\\d+)-(\\d+)', '\\2_\\1')).toBe('a 34_12 b 6_5');
    expect(sub('abxd', 'x*', '-')).toBe('-a-b--d-');
    expect(sub('ab', '(a)|b', '[\\1]')).toBe('[a][]');
    expect(sub('a\u00a0b c\td', '\\s+', '_')).toBe('a\u00a0b_c_d');
    expect(sub('ab\u00a0cd ef', '[\\S]+', 'X')).toBe('X X');
    expect(m('a\rc', '^a.c$')).toBe(true);
    expect(m('abc\n', '^abc$')).toBe(true);
    expect(m('a\nc', 'a.c')).toBe(false);
    expect(sub('a$b', '\\$', '\\\\')).toBe('a\\b');
    expect(sub('é1_', '\\w', '.')).toBe('é..');
    expect(sub('a\n', '$', 'X')).toBe('aX\nX');
    expect(sub('a-b', 'a\\-b', 'Z')).toBe('Z');
    expect(sub('a-bc', '[a\\-c]', 'Z')).toBe('ZZbZ');
    expect(sub('12345', '\\d{2,}?', '#')).toBe('##5');
    expect(sub('cost', 'o', '$1$$')).toBe('c$1$$st');
  });
  it('translateRegex leaves classes alone except \\s/\\S', () => {
    expect(translateRegex('[.$]')).toBe('[.$]');
    expect(translateRegex('[^\\s]')).toBe('[^\\t\\n\\v\\f\\r ]');
  });
});

describe('list ops', () => {
  const nums = () => pyList([i(3), pyFloat(1), i(2), i(1)]);
  it('get / length / contains / append', () => {
    expect(call('list.get', nums(), i(0))).toEqual(i(3));
    expect(code(() => call('list.get', nums(), i(-1)))).toBe('INDEX_OUT_OF_RANGE');
    expect(code(() => call('list.get', nums(), i(4)))).toBe('INDEX_OUT_OF_RANGE');
    expect(code(() => call('list.get', nums(), pyFloat(1)))).toBe('INVALID_NUMBER');
    expect(call('list.length', nums())).toEqual(i(4));
    expect(call('list.contains', nums(), pyFloat(2))).toEqual(pyBool(true));
    expect(call('list.contains', pyList([pyPath('A/b')]), pyPath('a/B'))).toEqual(pyBool(true));
    const xs = pyList([]);
    expect(call('list.append', xs, i(1))).toBeNull();
    expect(xs.v).toEqual([i(1)]);
  });
  it('range requires ints', () => {
    expect(call('list.range', i(2), i(5))).toEqual(pyList([i(2), i(3), i(4)]));
    expect(call('list.range', i(5), i(2))).toEqual(pyList([]));
    expect(code(() => call('list.range', pyFloat(0), i(2)))).toBe('INVALID_NUMBER');
  });
  it('sort is stable, Python-ordered, returns a new list', () => {
    const xs = nums();
    expect(call('list.sort', xs, pyBool(false))).toEqual(pyList([pyFloat(1), i(1), i(2), i(3)]));
    expect(call('list.sort', xs, pyBool(true))).toEqual(pyList([i(3), i(2), pyFloat(1), i(1)]));
    expect(xs).toEqual(nums());
    expect(call('list.sort', pyList([t('b'), t('B'), t('a')]), pyBool(false))).toEqual(
      pyList([t('B'), t('a'), t('b')]),
    );
  });
  it('sortBy keys', () => {
    const ps = () => pyList(['b.TXT', 'a.jpg', 'C.txt'].map(pyPath));
    const names = (v: Value | null) => (v as { v: { v: string }[] }).v.map((p) => p.v);
    expect(names(call('list.sortBy', ps(), t('name'), pyBool(false)))).toEqual([
      'a.jpg',
      'b.TXT',
      'C.txt',
    ]);
    expect(names(call('list.sortBy', ps(), t('ext'), pyBool(false)))).toEqual([
      'a.jpg',
      'b.TXT',
      'C.txt',
    ]);
    expect(names(call('list.sortBy', ps(), t('ext'), pyBool(true)))).toEqual([
      'C.txt',
      'b.TXT',
      'a.jpg',
    ]);
    expect(names(call('list.sortBy', ps(), t('size'), pyBool(false)))).toEqual([
      'C.txt',
      'b.TXT',
      'a.jpg',
    ]);
    expect(names(call('list.sortBy', ps(), t('modified'), pyBool(true)))).toEqual([
      'b.TXT',
      'C.txt',
      'a.jpg',
    ]);
    expect(
      code(() => call('list.sortBy', pyList([pyPath('zz')]), t('modified'), pyBool(false))),
    ).toBe('NOT_FOUND');
    expect(code(() => call('list.sortBy', pyList([pyPath('')]), t('size'), pyBool(false)))).toBe(
      'NOT_A_FILE',
    );
    // name/ext never touch the disk.
    expect(call('list.sortBy', pyList([pyPath('zz')]), t('name'), pyBool(false))).toEqual(
      pyList([pyPath('zz')]),
    );
  });
});

describe('math ops', () => {
  it('floor returns int; abs keeps type; min/max return the first on ties', () => {
    expect(call('math.floor', pyFloat(-2.5))).toEqual(i(-3));
    expect(call('math.floor', i(4))).toEqual(i(4));
    expect(call('math.abs', pyFloat(-2.5))).toEqual(pyFloat(2.5));
    expect(call('math.abs', i(-2))).toEqual(i(2));
    expect(call('math.min', i(1), pyFloat(1))).toEqual(i(1));
    expect(call('math.max', pyFloat(1), i(1))).toEqual(pyFloat(1));
    expect(call('math.min', i(3), pyFloat(2))).toEqual(pyFloat(2));
    expect(call('math.max', i(3), pyFloat(2))).toEqual(i(3));
  });
});

describe('fs path ops', () => {
  it('name/stem/ext/join/parent', () => {
    expect(call('fs.name', pyPath('d/report.final.pdf'))).toEqual(t('report.final.pdf'));
    expect(call('fs.stem', pyPath('d/report.final.pdf'))).toEqual(t('report.final'));
    expect(call('fs.ext', pyPath('d/.bashrc'))).toEqual(t(''));
    expect(call('fs.join', pyPath('d'), t('x'))).toEqual(pyPath('d/x'));
    expect(code(() => call('fs.join', pyPath(''), t('a|b')))).toBe('INVALID_NAME');
    expect(call('fs.parent', pyPath('x'))).toEqual(pyPath(''));
    expect(code(() => call('fs.parent', pyPath('')))).toBe('OUTSIDE_ROOT');
    expect(call('fs.root')).toEqual(pyPath(''));
  });
});
