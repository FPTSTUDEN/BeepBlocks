import { describe, expect, it } from 'vitest';
import type { FsFolder, FsNode, SandboxFS } from './fsTypes.ts';
import { getNode } from './fsTypes.ts';
import {
  checkTree,
  copy,
  exists,
  initialClock,
  isFolder,
  list,
  makeFolder,
  modified,
  move,
  pathExt,
  pathJoin,
  pathName,
  pathParent,
  pathStem,
  readText,
  remove,
  rename,
  size,
  sortTree,
  walk,
  writeText,
  type FsFail,
} from './fs.ts';

const file = (name: string, content: string, mtime = 100): FsNode => ({
  type: 'file',
  name,
  modified: mtime,
  content,
});
const bin = (name: string, n: number, mtime = 100): FsNode => ({
  type: 'file',
  name,
  modified: mtime,
  binarySize: n,
});
const dir = (name: string, children: FsNode[], mtime = 50): FsFolder => ({
  type: 'folder',
  name,
  modified: mtime,
  children,
});

/** root: Docs/{a.txt, Sub/{deep.txt}}, Empty/, photo.JPG(binary), z.txt */
function sample(): SandboxFS {
  return sortTree({
    root: dir('', [
      dir('Docs', [file('a.txt', 'hello'), dir('Sub', [file('deep.txt', 'é', 300)])]),
      dir('Empty', []),
      bin('photo.JPG', 1234, 200),
      file('z.txt', 'zz'),
      file('zero.bin', 'a\0b'),
    ]),
  });
}

const code = (r: { ok: boolean }) => (r.ok ? 'OK' : (r as FsFail).code);
const names = (f: FsNode | undefined) =>
  f && f.type === 'folder' ? f.children.map((c) => c.name) : null;

describe('path helpers', () => {
  it('name / stem / ext follow pathlib on the last segment', () => {
    expect(pathName('a/report.final.pdf')).toBe('report.final.pdf');
    expect(pathStem('a/report.final.pdf')).toBe('report.final');
    expect(pathExt('a/report.final.pdf')).toBe('pdf');
    expect(pathStem('.bashrc')).toBe('.bashrc');
    expect(pathExt('.bashrc')).toBe('');
    expect(pathExt('IMG.JPG')).toBe('JPG');
    expect(pathExt('noext')).toBe('');
    expect(pathName('')).toBe('');
    expect(pathStem('')).toBe('');
  });
  it('join validates names → INVALID_NAME', () => {
    expect(pathJoin('', 'a')).toEqual({ ok: true, value: 'a' });
    expect(pathJoin('x/y', 'a')).toEqual({ ok: true, value: 'x/y/a' });
    for (const bad of ['', 'a/b', 'CON', 'x.', '..'])
      expect(code(pathJoin('', bad))).toBe('INVALID_NAME');
  });
  it('parent: OUTSIDE_ROOT for the root; root for top-level items', () => {
    expect(code(pathParent(''))).toBe('OUTSIDE_ROOT');
    expect(pathParent('a')).toEqual({ ok: true, value: '' });
    expect(pathParent('a/b/c')).toEqual({ ok: true, value: 'a/b' });
  });
});

describe('reads', () => {
  const fs = sample();
  it('exists resolves case-insensitively; a file mid-path means missing', () => {
    expect(exists(fs, 'docs/A.TXT')).toBe(true);
    expect(exists(fs, '')).toBe(true);
    expect(exists(fs, 'z.txt/x')).toBe(false);
    expect(exists(fs, 'nope')).toBe(false);
  });
  it('isFolder: NOT_FOUND', () => {
    expect(isFolder(fs, 'DOCS')).toEqual({ ok: true, value: true });
    expect(isFolder(fs, 'z.txt')).toEqual({ ok: true, value: false });
    expect(code(isFolder(fs, 'nope'))).toBe('NOT_FOUND');
  });
  it('list returns path as given + stored names; NOT_FOUND, NOT_A_FOLDER', () => {
    expect(list(fs, 'docs')).toEqual({ ok: true, value: ['docs/a.txt', 'docs/Sub'] });
    expect(list(fs, '')).toEqual({
      ok: true,
      value: ['Docs', 'Empty', 'photo.JPG', 'z.txt', 'zero.bin'],
    });
    expect(code(list(fs, 'nope'))).toBe('NOT_FOUND');
    expect(code(list(fs, 'z.txt'))).toBe('NOT_A_FOLDER');
  });
  it('walk is pre-order over files only; NOT_FOUND, NOT_A_FOLDER', () => {
    expect(walk(fs, '')).toEqual({
      ok: true,
      value: ['Docs/a.txt', 'Docs/Sub/deep.txt', 'photo.JPG', 'z.txt', 'zero.bin'],
    });
    expect(walk(fs, 'Empty')).toEqual({ ok: true, value: [] });
    expect(code(walk(fs, 'nope'))).toBe('NOT_FOUND');
    expect(code(walk(fs, 'z.txt'))).toBe('NOT_A_FOLDER');
  });
  it('size: UTF-8 bytes or binary size; NOT_FOUND, NOT_A_FILE', () => {
    expect(size(fs, 'docs/sub/deep.txt')).toEqual({ ok: true, value: 2 });
    expect(size(fs, 'photo.jpg')).toEqual({ ok: true, value: 1234 });
    expect(code(size(fs, 'nope'))).toBe('NOT_FOUND');
    expect(code(size(fs, 'Docs'))).toBe('NOT_A_FILE');
  });
  it('modified: NOT_FOUND', () => {
    expect(modified(fs, 'photo.JPG')).toEqual({ ok: true, value: 200 });
    expect(modified(fs, 'Docs')).toEqual({ ok: true, value: 50 });
    expect(code(modified(fs, 'nope'))).toBe('NOT_FOUND');
  });
  it('readText: NOT_FOUND, NOT_A_FILE, NOT_TEXT (binary, NUL, lone surrogate)', () => {
    expect(readText(fs, 'z.txt')).toEqual({ ok: true, value: 'zz' });
    expect(code(readText(fs, 'nope'))).toBe('NOT_FOUND');
    expect(code(readText(fs, 'Docs'))).toBe('NOT_A_FILE');
    expect(code(readText(fs, 'photo.JPG'))).toBe('NOT_TEXT');
    expect(code(readText(fs, 'zero.bin'))).toBe('NOT_TEXT');
    const lone: SandboxFS = { root: dir('', [file('s.txt', 'a\ud800b')]) };
    expect(code(readText(lone, 's.txt'))).toBe('NOT_TEXT');
    const emoji: SandboxFS = { root: dir('', [file('s.txt', '\u{1f600}')]) };
    expect(code(readText(emoji, 's.txt'))).toBe('OK');
  });
});

describe('writeText', () => {
  it('creates a file with the clock time, sharing untouched subtrees', () => {
    const fs = sample();
    const r = writeText(fs, 'Docs/new.txt', 'hi', 999);
    if (!r.ok) throw new Error(r.message);
    expect(getNode(r.fs, 'docs/new.txt')).toEqual(file('new.txt', 'hi', 999));
    expect(names(getNode(r.fs, 'Docs'))).toEqual(['a.txt', 'new.txt', 'Sub']);
    // Structural sharing: siblings off the path are the same objects.
    expect(getNode(r.fs, 'Empty')).toBe(getNode(fs, 'Empty'));
    expect(getNode(r.fs, 'Docs/Sub')).toBe(getNode(fs, 'Docs/Sub'));
    // Original unchanged.
    expect(exists(fs, 'Docs/new.txt')).toBe(false);
  });
  it('overwrites keeping the stored name and turns binary into text', () => {
    const r = writeText(sample(), 'PHOTO.jpg', 'x', 5);
    if (!r.ok) throw new Error(r.message);
    expect(getNode(r.fs, 'photo.jpg')).toEqual(file('photo.JPG', 'x', 5));
  });
  it('errors: ROOT_PROTECTED, NOT_FOUND (missing parent / parent is a file), NOT_A_FILE', () => {
    const fs = sample();
    expect(code(writeText(fs, '', 'x', 1))).toBe('ROOT_PROTECTED');
    expect(code(writeText(fs, 'nope/a.txt', 'x', 1))).toBe('NOT_FOUND');
    expect(code(writeText(fs, 'z.txt/a.txt', 'x', 1))).toBe('NOT_FOUND');
    expect(code(writeText(fs, 'Docs', 'x', 1))).toBe('NOT_A_FILE');
  });
});

describe('makeFolder', () => {
  it('creates an empty folder with the clock time', () => {
    const r = makeFolder(sample(), 'Docs/Sub/Inner', 7);
    if (!r.ok) throw new Error(r.message);
    expect(getNode(r.fs, 'docs/sub/inner')).toEqual(dir('Inner', [], 7));
  });
  it('errors: ALREADY_EXISTS (root), NOT_FOUND, ALREADY_EXISTS (any type, any case)', () => {
    const fs = sample();
    expect(code(makeFolder(fs, '', 1))).toBe('ALREADY_EXISTS');
    expect(code(makeFolder(fs, 'nope/x', 1))).toBe('NOT_FOUND');
    expect(code(makeFolder(fs, 'z.txt/x', 1))).toBe('NOT_FOUND');
    expect(code(makeFolder(fs, 'docs', 1))).toBe('ALREADY_EXISTS');
    expect(code(makeFolder(fs, 'Z.TXT', 1))).toBe('ALREADY_EXISTS');
  });
});

describe('rename', () => {
  it('renames in place, re-sorts, preserves mtime, returns parent-as-given + new name', () => {
    const r = rename(sample(), 'docs/A.txt', 'zeta.md');
    if (!r.ok) throw new Error(r.message);
    expect(r.value).toBe('docs/zeta.md');
    expect(names(getNode(r.fs, 'Docs'))).toEqual(['Sub', 'zeta.md']);
    expect(getNode(r.fs, 'Docs/zeta.md')?.modified).toBe(100);
  });
  it('allows a case-only rename of itself', () => {
    const r = rename(sample(), 'z.txt', 'Z.TXT');
    if (!r.ok) throw new Error(r.message);
    expect(names(r.fs.root)).toContain('Z.TXT');
    expect(names(r.fs.root)).not.toContain('z.txt');
  });
  it('errors in order: INVALID_NAME, NOT_FOUND, ROOT_PROTECTED, ALREADY_EXISTS', () => {
    const fs = sample();
    expect(code(rename(fs, 'nope', 'bad?'))).toBe('INVALID_NAME');
    expect(code(rename(fs, 'nope', 'ok'))).toBe('NOT_FOUND');
    expect(code(rename(fs, '', 'ok'))).toBe('ROOT_PROTECTED');
    expect(code(rename(fs, 'z.txt', 'DOCS'))).toBe('ALREADY_EXISTS');
  });
});

describe('move', () => {
  it('moves into a folder, preserves mtime, returns dest-as-given + stored name', () => {
    const fs = sample();
    const r = move(fs, 'PHOTO.jpg', 'docs/sub');
    if (!r.ok) throw new Error(r.message);
    expect(r.value).toBe('docs/sub/photo.JPG');
    expect(exists(r.fs, 'photo.JPG')).toBe(false);
    expect(getNode(r.fs, 'Docs/Sub/photo.JPG')).toBe(getNode(fs, 'photo.JPG'));
    expect(names(getNode(r.fs, 'Docs/Sub'))).toEqual(['deep.txt', 'photo.JPG']);
  });
  it('moves a folder with its contents', () => {
    const r = move(sample(), 'Docs/Sub', 'Empty');
    if (!r.ok) throw new Error(r.message);
    expect(getNode(r.fs, 'Empty/Sub/deep.txt')?.modified).toBe(300);
    expect(names(getNode(r.fs, 'Docs'))).toEqual(['a.txt']);
  });
  it('errors in order', () => {
    const fs = sample();
    expect(code(move(fs, 'nope', 'nope2'))).toBe('NOT_FOUND');
    expect(code(move(fs, '', 'nope'))).toBe('ROOT_PROTECTED');
    expect(code(move(fs, 'z.txt', 'nope'))).toBe('NOT_FOUND');
    expect(code(move(fs, 'Docs', 'z.txt'))).toBe('NOT_A_FOLDER');
    expect(code(move(fs, 'Docs', 'docs'))).toBe('INVALID_MOVE');
    expect(code(move(fs, 'Docs', 'DOCS/sub'))).toBe('INVALID_MOVE');
    expect(code(move(fs, 'z.txt', ''))).toBe('ALREADY_EXISTS'); // the source itself
    const clash = writeText(fs, 'Empty/Z.TXT', 'q', 1);
    if (!clash.ok) throw new Error();
    expect(code(move(clash.fs, 'z.txt', 'empty'))).toBe('ALREADY_EXISTS');
  });
});

describe('copy', () => {
  it('copies deeply and preserves all mtimes; source remains', () => {
    const fs = sample();
    const r = copy(fs, 'docs', 'Empty');
    if (!r.ok) throw new Error(r.message);
    expect(r.value).toBe('Empty/Docs');
    expect(getNode(r.fs, 'Empty/Docs/Sub/deep.txt')).toEqual(file('deep.txt', 'é', 300));
    expect(getNode(r.fs, 'Empty/Docs')?.modified).toBe(50);
    expect(exists(r.fs, 'Docs/a.txt')).toBe(true);
    // Mutating the copy does not affect the original.
    const w = writeText(r.fs, 'Empty/Docs/a.txt', 'changed', 9);
    if (!w.ok) throw new Error();
    expect(readText(w.fs, 'Docs/a.txt')).toEqual({ ok: true, value: 'hello' });
  });
  it('errors in order', () => {
    const fs = sample();
    expect(code(copy(fs, 'nope', 'Empty'))).toBe('NOT_FOUND');
    expect(code(copy(fs, '', 'Empty'))).toBe('ROOT_PROTECTED');
    expect(code(copy(fs, 'z.txt', 'nope'))).toBe('NOT_FOUND');
    expect(code(copy(fs, 'z.txt', 'photo.JPG'))).toBe('NOT_A_FOLDER');
    expect(code(copy(fs, 'Docs', 'Docs/Sub'))).toBe('INVALID_MOVE');
    expect(code(copy(fs, 'z.txt', ''))).toBe('ALREADY_EXISTS');
  });
});

describe('remove', () => {
  it('deletes files and empty folders', () => {
    const fs = sample();
    const a = remove(fs, 'Z.txt');
    const b = remove(fs, 'empty');
    if (!a.ok || !b.ok) throw new Error();
    expect(exists(a.fs, 'z.txt')).toBe(false);
    expect(exists(b.fs, 'Empty')).toBe(false);
  });
  it('errors: NOT_FOUND, ROOT_PROTECTED, NOT_EMPTY', () => {
    const fs = sample();
    expect(code(remove(fs, 'nope'))).toBe('NOT_FOUND');
    expect(code(remove(fs, ''))).toBe('ROOT_PROTECTED');
    expect(code(remove(fs, 'Docs'))).toBe('NOT_EMPTY');
  });
});

describe('tree helpers', () => {
  it('initialClock = max mtime + 60', () => {
    expect(initialClock(sample())).toBe(360);
  });
  it('checkTree accepts valid trees and reports problems', () => {
    expect(checkTree(sample())).toEqual([]);
    const bad: SandboxFS = {
      root: dir('', [file('b', 'x'), file('a', 'x'), file('A', 'x'), file('CON', 'x')]),
    };
    expect(checkTree(bad).length).toBeGreaterThanOrEqual(3);
    const both: SandboxFS = {
      root: dir('', [{ type: 'file', name: 'x', modified: 1.5, content: '', binarySize: 1 }]),
    };
    expect(checkTree(both)).toHaveLength(2);
  });
});
