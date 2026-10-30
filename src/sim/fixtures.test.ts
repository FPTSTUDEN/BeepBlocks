/** Reproduces the seed conformance fixtures through `simulateSync` (golden expected.json). */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProgram } from '../ir/serialize.ts';
import type { FsNode, SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { sortTree } from '../domains/fileExplorer/fs.ts';
import { simulateSync } from './index.ts';

const FIXTURES = resolve(import.meta.dirname, '..', '..', 'conformance', 'fixtures');

/** Drops mtimes (golden trees use 0 placeholders; times are compared by conformance). */
function stripTimes(n: FsNode): unknown {
  if (n.type === 'folder') return { ...n, modified: 0, children: n.children.map(stripTimes) };
  return { ...n, modified: 0 };
}

const names = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

/**
 * sim/ cannot desugar (module boundary), so fixtures with task blocks are left to the
 * conformance runner, which desugars first.
 */
const hasComposite = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.some(hasComposite)
    : typeof v === 'object' && v !== null &&
      ((v as { kind?: unknown }).kind === 'composite' || Object.values(v).some(hasComposite));

describe('seed conformance fixtures', () => {
  it('found the seed fixtures', () => {
    expect(names).toEqual(
      expect.arrayContaining(['basic-arith-print', 'mkdir-move', 'rename-collision-error']),
    );
  });

  it.each(names)('%s', (name) => {
    const dir = join(FIXTURES, name);
    const parsed = parseProgram(readFileSync(join(dir, 'program.json'), 'utf8'));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    if (hasComposite(parsed.program)) return;
    const tree = sortTree(JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8')) as SandboxFS);
    const sim = simulateSync(parsed.program, tree);
    if (!sim.ok) throw new Error(JSON.stringify(sim.errors));
    const { timeline } = sim;
    const last = timeline.snapshots[timeline.snapshots.length - 1]!;
    const expectedPath = join(dir, 'expected.json');
    if (!existsSync(expectedPath)) return;
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as {
      output?: string[];
      error?: { code: string; nodeId: string } | null;
      tree?: SandboxFS;
    };
    if (expected.output) expect(timeline.output.map((l) => l.text)).toEqual(expected.output);
    if (expected.error !== undefined) {
      expect(last.error ? { code: last.error.code, nodeId: last.error.nodeId } : null).toEqual(
        expected.error,
      );
      expect(timeline.outcome).toBe(expected.error ? 'error' : 'done');
    }
    if (expected.tree) {
      expect(stripTimes(last.state.root)).toEqual(stripTimes(sortTree(expected.tree).root));
    }
  });
});
