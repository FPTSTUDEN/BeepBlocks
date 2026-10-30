import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseProgram } from '../src/ir/index.ts';
import type { SandboxFS } from '../src/domains/fileExplorer/fsTypes.ts';
import { diffTrees, materialize, normalizeTree, readTree } from './lib/tree.ts';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const names = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe.each(names)('fixture %s', (name) => {
  it('has a valid program', () => {
    const res = parseProgram(readFileSync(join(FIXTURES, name, 'program.json'), 'utf8'));
    expect(res.ok ? [] : res.errors).toEqual([]);
  });

  it('round-trips its tree through the real disk', () => {
    const tree = normalizeTree(JSON.parse(readFileSync(join(FIXTURES, name, 'tree.json'), 'utf8')) as SandboxFS);
    const dir = mkdtempSync(join(tmpdir(), 'bp-'));
    try {
      materialize(tree, join(dir, 'x'));
      expect(diffTrees(tree, readTree(join(dir, 'x')), { compareMtimes: { except: new Set() } })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
