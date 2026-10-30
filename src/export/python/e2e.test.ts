/* eslint-disable no-restricted-imports -- test only: compares the exported Python with the simulator */
/**
 * End-to-end: export → real Python (dry run and --apply) on a materialized folder, compared
 * with the simulator (output lines, error code + node id, final tree) and, for the seed
 * conformance fixtures, with their golden expectations.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Program } from '../../ir/types.ts';
import { DRY_RUN_PREFIX, type Timeline } from '../../ir/timeline.ts';
import { validateProgram } from '../../ir/validate.ts';
import {
  fileSize,
  type FsFolder,
  type FsNode,
  type SandboxFS,
} from '../../domains/fileExplorer/fsTypes.ts';
import { simulateSync } from '../../sim/index.ts';
import { diffTrees, normalizeTree } from '../../../conformance/lib/tree.ts';
import { exportPython } from '../index.ts';
import { runScript } from './__testing__/python.ts';
import { CASES, ERROR_CASES, type Case } from './__testing__/programs.ts';

const identity = (p: Program) => p;

/** Paths touched by actions, matched ignoring case (their mtimes legitimately differ). */
function touched(timeline: Timeline<SandboxFS>): Set<string> {
  const s = new Set<string>();
  for (const snap of timeline.snapshots) {
    if (snap.action) {
      s.add(snap.action.from.toLowerCase());
      if (snap.action.to) s.add(snap.action.to.toLowerCase());
    }
  }
  return { has: (p: string) => s.has(p.toLowerCase()) } as Set<string>;
}

/**
 * readTree() reads a file containing NUL bytes back as opaque (binarySize), so a sandbox text
 * file with NUL content is compared in that form.
 */
function nulAsBinary(t: SandboxFS): SandboxFS {
  const fix = (n: FsNode): FsNode => {
    if (n.type === 'folder') return { ...n, children: n.children.map(fix) };
    if (n.content === undefined || !n.content.includes('\u0000')) return n;
    return { type: 'file', name: n.name, modified: n.modified, binarySize: fileSize(n) };
  };
  return { root: fix(t.root) as FsFolder };
}

interface Expectation {
  output: string[];
  error: { code: string; nodeId: string } | null;
  tree: SandboxFS;
}

/** Runs `program` in the simulator and in Python (both modes) and compares everything. */
function differential(c: Case): Expectation {
  const desugar = c.desugar ?? identity;
  expect(validateProgram(c.program).filter((e) => e.severity === 'error')).toEqual([]);
  const desugared = desugar(c.program);
  const sim = simulateSync(desugared, c.tree);
  if (!sim.ok) throw new Error(`simulator refused: ${JSON.stringify(sim.errors)}`);
  const last = sim.timeline.snapshots[sim.timeline.snapshots.length - 1]!;
  const simError = last.error ? { code: last.error.code, nodeId: last.error.nodeId } : null;
  const simOut = sim.timeline.output.map((l) => l.text);
  const simTree = last.state;

  const exported = exportPython(c.program, { desugar, title: c.name });
  if (!exported.ok) throw new Error(`export failed: ${JSON.stringify(exported.errors)}`);

  const applied = runScript(exported.source, c.tree, true);
  expect(applied.error, applied.stderr).toEqual(simError);
  expect(applied.status, applied.stderr).toBe(simError ? 1 : 0);
  expect(applied.stdout).toEqual(simOut);
  expect(
    diffTrees(nulAsBinary(simTree), applied.tree, {
      compareMtimes: { except: touched(sim.timeline) },
    }),
  ).toEqual([]);

  const dry = runScript(exported.source, c.tree, false);
  expect(dry.error, dry.stderr).toEqual(simError);
  expect(dry.status, dry.stderr).toBe(simError ? 1 : 0);
  expect(dry.stdout).toEqual(
    sim.timeline.output.map((l) => (l.kind === 'action' ? DRY_RUN_PREFIX + l.text : l.text)),
  );
  expect(
    diffTrees(nulAsBinary(c.tree), dry.tree, { compareMtimes: { except: new Set() } }),
  ).toEqual([]);
  return { output: simOut, error: simError, tree: simTree };
}

describe('simulator vs Python', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = differential(c);
    expect(r.error).toBeNull();
  });

  it.each(ERROR_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = differential(c);
    expect(r.error).toEqual(c.error);
    expect(r.output[0]).toBe('start');
    expect(r.output).not.toContain('never');
  });

  it('covers every runtime error code that Python can raise', () => {
    const codes = new Set(ERROR_CASES.map((c) => c.error?.code));
    for (const code of [
      'NOT_FOUND',
      'ALREADY_EXISTS',
      'NOT_EMPTY',
      'INVALID_NAME',
      'NOT_A_FOLDER',
      'NOT_A_FILE',
      'NOT_TEXT',
      'INVALID_MOVE',
      'ROOT_PROTECTED',
      'OUTSIDE_ROOT',
      'INDEX_OUT_OF_RANGE',
      'DIVISION_BY_ZERO',
      'INVALID_NUMBER',
      'INT_OVERFLOW',
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('keeps earlier changes after a failure with --apply, none in the dry run', () => {
    const c = ERROR_CASES.find((x) => x.name === 'error-partial-failure')!;
    const r = differential(c);
    const made = r.tree.root.children.find((n) => n.name === 'new');
    expect(made?.type).toBe('folder');
    const names = made?.type === 'folder' ? made.children.map((n) => n.name) : [];
    expect(names).toEqual(['a.txt', 'w.txt']);
  });
});

// ------------------------------------------------------------ seed fixtures

const FIXTURES = resolve(import.meta.dirname, '../../../conformance/fixtures');
const fixtureNames = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('conformance seed fixtures', () => {
  it.each(fixtureNames)('%s', (name) => {
    const dir = join(FIXTURES, name);
    const program = JSON.parse(readFileSync(join(dir, 'program.json'), 'utf8')) as Program;
    if (validateProgram(program, { primitiveOnly: true }).some((e) => e.severity === 'error')) {
      return; // needs the real composites module; covered by `pnpm conformance`
    }
    const t = normalizeTree(JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8')) as SandboxFS);
    const r = differential({ name, program, tree: t });
    const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as {
      error?: { code: string; nodeId: string } | null;
      output?: string[];
      tree?: SandboxFS;
    };
    if (expected.output) expect(r.output).toEqual(expected.output);
    if (expected.error !== undefined) expect(r.error).toEqual(expected.error);
    if (expected.tree) expect(diffTrees(normalizeTree(expected.tree), r.tree)).toEqual([]);
  });

  it('has the three seed fixtures', () => {
    expect(fixtureNames).toEqual(
      expect.arrayContaining(['basic-arith-print', 'mkdir-move', 'rename-collision-error']),
    );
  });
});
