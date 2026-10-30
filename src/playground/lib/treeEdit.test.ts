import { describe, expect, it } from 'vitest';
import type { FsFolder, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { fileSize, getNode } from '../../domains/fileExplorer/fsTypes.ts';
import {
  addNode,
  deleteNode,
  freshName,
  renameNode,
  setBinarySize,
  setModified,
  setTextContent,
  validateName,
  type EditResult,
} from './treeEdit.ts';

const fs: SandboxFS = {
  root: {
    type: 'folder',
    name: '',
    modified: 0,
    children: [
      {
        type: 'folder',
        name: 'Docs',
        modified: 0,
        children: [{ type: 'file', name: 'a.txt', modified: 0, content: 'a' }],
      },
      { type: 'file', name: 'b.txt', modified: 0, content: 'bb' },
    ],
  },
};
const frozen = JSON.stringify(fs);

function ok(r: EditResult): SandboxFS {
  if (!r.ok) throw new Error(r.error);
  return r.fs;
}
const names = (f: SandboxFS, path = '') =>
  (getNode(f, path) as FsFolder).children.map((c) => c.name);

describe('tree edits', () => {
  it('add keeps children sorted and does not mutate the input', () => {
    const next = ok(addNode(fs, '', { type: 'file', name: 'A0.txt', modified: 0, content: '' }));
    expect(names(next)).toEqual(['A0.txt', 'b.txt', 'Docs']);
    expect(JSON.stringify(fs)).toBe(frozen);
    const nested = addNode(fs, 'docs', { type: 'folder', name: 'Sub', modified: 0, children: [] });
    expect(nested.ok && nested.path).toBe('docs/Sub');
    expect(names(ok(nested), 'Docs')).toEqual(['a.txt', 'Sub']);
  });

  it('rejects invalid and duplicate names (case-insensitive) in plain language', () => {
    const dup = addNode(fs, '', { type: 'file', name: 'B.TXT', modified: 0, content: '' });
    expect(dup).toEqual({ ok: false, error: expect.stringContaining('"b.txt" already exists') });
    const bad = addNode(fs, '', { type: 'file', name: 'a?b', modified: 0, content: '' });
    expect(bad.ok).toBe(false);
    expect(validateName(fs, '', 'CON.txt')).toMatch(/reserved/);
    expect(validateName(fs, 'missing', 'x')).toMatch(/no longer exists/);
  });

  it('rename: sorted, case-only rename allowed, collisions rejected, root protected', () => {
    const r = renameNode(fs, 'b.txt', 'a-first.txt');
    expect(r.ok && r.path).toBe('a-first.txt');
    expect(names(ok(r))).toEqual(['a-first.txt', 'Docs']);
    expect(names(ok(renameNode(fs, 'b.txt', 'B.txt')))).toEqual(['B.txt', 'Docs']);
    expect(renameNode(fs, 'b.txt', 'docs').ok).toBe(false);
    expect(renameNode(fs, '', 'x').ok).toBe(false);
    expect(renameNode(fs, 'nope', 'x').ok).toBe(false);
  });

  it('delete removes folders recursively', () => {
    expect(names(ok(deleteNode(fs, 'DOCS')))).toEqual(['b.txt']);
    expect(deleteNode(fs, '').ok).toBe(false);
  });

  it('edit content, binary size and date', () => {
    const t = ok(setTextContent(fs, 'Docs/a.txt', 'héllo'));
    const f = getNode(t, 'Docs/a.txt');
    expect(f?.type === 'file' && fileSize(f)).toBe(6);
    const b = ok(setBinarySize(fs, 'b.txt', 2048));
    const bf = getNode(b, 'b.txt');
    expect(bf).toEqual({ type: 'file', name: 'b.txt', modified: 0, binarySize: 2048 });
    expect(setBinarySize(fs, 'b.txt', -1).ok).toBe(false);
    expect(setBinarySize(fs, 'b.txt', 1.5).ok).toBe(false);
    expect(setTextContent(fs, 'Docs', 'x').ok).toBe(false);
    expect(getNode(ok(setModified(fs, 'Docs', 123)), 'Docs')?.modified).toBe(123);
    expect(ok(setModified(fs, '', 5)).root.modified).toBe(5);
    expect(setModified(fs, 'b.txt', 1.5).ok).toBe(false);
  });

  it('freshName avoids existing names', () => {
    expect(freshName(fs, '', 'b', '.txt')).toBe('b 2.txt');
    expect(freshName(fs, '', 'New folder')).toBe('New folder');
  });
});
