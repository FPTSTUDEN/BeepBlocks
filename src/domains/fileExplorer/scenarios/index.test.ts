import { describe, expect, it } from 'vitest';
import { COMPOSITE_NAMES } from '../../../ir/composites.ts';
import { getNode, type FsNode } from '../fsTypes.ts';
import { checkTree, list, readText, walk } from '../fs.ts';
import { SCENARIOS, getScenario } from './index.ts';

const files = (n: FsNode): FsNode[] => (n.type === 'folder' ? n.children.flatMap(files) : [n]);

describe('built-in scenarios', () => {
  it('has the four v1 scenarios with unique ids', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'messy-downloads',
      'camera-photos',
      'project-tree',
      'nightly-logs',
    ]);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s satisfies the tree invariants', (_, s) => {
    expect(s.title.length).toBeGreaterThan(0);
    expect(s.description.length).toBeGreaterThan(0);
    if (s.suggestedComposite) expect(COMPOSITE_NAMES).toContain(s.suggestedComposite);
    expect(s.tree.root.type).toBe('folder');
    expect(checkTree(s.tree)).toEqual([]);
    expect(walk(s.tree, '').ok).toBe(true);
  });

  it('messy-downloads mixes extensions, including uppercase and none', () => {
    const s = getScenario('messy-downloads')!;
    expect(s.suggestedComposite).toBe('sortByType');
    const names = s.tree.root.children.map((c) => c.name);
    expect(names.some((n) => /\.[A-Z0-9]+$/.test(n) && /[A-Z]/.test(n.split('.').pop()!))).toBe(
      true,
    );
    expect(names.some((n) => !n.includes('.'))).toBe(true);
    expect(new Set(names.map((n) => n.split('.').pop()!.toLowerCase())).size).toBeGreaterThan(10);
  });

  it('camera-photos has IMG_nnnn photos in mixed case plus non-photos', () => {
    const s = getScenario('camera-photos')!;
    expect(s.suggestedComposite).toBe('renameByPattern');
    const names = s.tree.root.children.map((c) => c.name);
    expect(names).toContain('IMG_0001.JPG');
    expect(names.some((n) => n.startsWith('img_'))).toBe(true);
    expect(names.some((n) => n.endsWith('.jpg'))).toBe(true);
    expect(names.filter((n) => !/^img_\d{4}\.jpg$/i.test(n)).length).toBeGreaterThanOrEqual(3);
  });

  it('project-tree has nested .tmp/.log files and large files', () => {
    const s = getScenario('project-tree')!;
    expect(s.suggestedComposite).toBe('findAndAct');
    const all = walk(s.tree, '');
    if (!all.ok) throw new Error();
    expect(all.value.filter((p) => p.endsWith('.tmp')).length).toBeGreaterThanOrEqual(3);
    expect(all.value.some((p) => p.split('/').length >= 3 && p.endsWith('.log'))).toBe(true);
    const big = files(s.tree.root).filter(
      (f) => f.type === 'file' && (f.binarySize ?? 0) > 10 * 1024 * 1024,
    );
    expect(big.length).toBeGreaterThanOrEqual(3);
    expect(getNode(s.tree, 'src/__pycache__')).toBeDefined();
  });

  it('nightly-logs: 64 dated logs flipping from OK to ERROR once', () => {
    const s = getScenario('nightly-logs')!;
    expect(s.suggestedComposite).toBe('findFirst');
    const ls = list(s.tree, '');
    if (!ls.ok) throw new Error();
    expect(ls.value).toHaveLength(64);
    const statuses = ls.value.map((p) => {
      const r = readText(s.tree, p);
      if (!r.ok) throw new Error(r.message);
      return /status: (\w+)/.exec(r.value)![1];
    });
    const first = statuses.indexOf('ERROR');
    expect(first).toBe(40);
    expect(ls.value[first]).toBe('nightly-2026-02-10.log');
    expect(statuses.slice(0, first).every((x) => x === 'OK')).toBe(true);
    expect(statuses.slice(first).every((x) => x === 'ERROR')).toBe(true);
    // Sorted by name == sorted by modified time (bisect works with either key).
    const times = s.tree.root.children.map((c) => c.modified);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
