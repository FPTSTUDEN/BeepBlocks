/**
 * Test helpers: run an exported script with real Python on a materialized tree (like
 * conformance/run.ts) and build small trees and programs.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FsFile, FsFolder, FsNode, SandboxFS } from '../../../domains/fileExplorer/fsTypes.ts';
import type { Program, Stmt } from '../../../ir/types.ts';
import { materialize, normalizeTree, readTree } from '../../../../conformance/lib/tree.ts';

export const PYTHON =
  process.env.BP_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

/** Exactly the first stderr line on a block error (design.md §5.5). */
const PY_ERROR = /^Error at block (\S*) \(([A-Z_]+)\): .*$/;

export interface PyRun {
  status: number | null;
  stdout: string[];
  stderr: string;
  error: { code: string; nodeId: string } | null;
  /** The folder after the run. */
  tree: SandboxFS;
}

/** Writes `source` to a temp dir, materializes `tree`, runs the script, reads the tree back. */
export function runScript(source: string, tree: SandboxFS, apply: boolean): PyRun {
  const dir = mkdtempSync(join(tmpdir(), 'bp-export-'));
  try {
    const script = join(dir, 'script.py');
    writeFileSync(script, source, 'utf8');
    const work = join(dir, 'work');
    materialize(tree, work);
    const res = spawnSync(PYTHON, [script, work, ...(apply ? ['--apply'] : [])], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      timeout: 60_000,
    });
    if (res.error) throw new Error(`Could not run ${PYTHON}: ${res.error.message}`);
    const stdout = res.stdout.split(/\r?\n/);
    if (stdout[stdout.length - 1] === '') stdout.pop();
    const first = res.stderr.split(/\r?\n/)[0] ?? '';
    const m = PY_ERROR.exec(first);
    return {
      status: res.status,
      stdout,
      stderr: res.stderr,
      error: m ? { nodeId: m[1]!, code: m[2]! } : null,
      tree: readTree(work),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs Python's compiler on each source (syntax check only). Returns one error text per source ('' = fine). */
export function pyCompileAll(sources: readonly string[]): string[] {
  const code =
    'import json, sys, traceback\n' +
    'out = []\n' +
    'for s in json.loads(sys.stdin.read()):\n' +
    '    try:\n' +
    '        compile(s, "script.py", "exec")\n' +
    '        out.append("")\n' +
    '    except SyntaxError:\n' +
    '        out.append(traceback.format_exc())\n' +
    'print(json.dumps(out))\n';
  const res = spawnSync(PYTHON, ['-c', code], {
    input: JSON.stringify(sources),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    timeout: 60_000,
  });
  if (res.error) throw new Error(`Could not run ${PYTHON}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout) as string[];
}

/** Runs Python's compiler on `source` (syntax check only). Returns the error ('' if fine). */
export function pyCompileErrors(source: string): string {
  return pyCompileAll([source])[0]!;
}

// ------------------------------------------------------------------- trees

export const T0 = 1_767_225_600; // 2026-01-01

export const file = (name: string, content: string, modified = T0): FsFile => ({
  type: 'file',
  name,
  modified,
  content,
});
export const binary = (name: string, binarySize: number, modified = T0): FsFile => ({
  type: 'file',
  name,
  modified,
  binarySize,
});
export const folder = (name: string, children: FsNode[], modified = T0): FsFolder => ({
  type: 'folder',
  name,
  modified,
  children,
});
export const tree = (children: FsNode[]): SandboxFS =>
  normalizeTree({ root: folder('', children) });

// ---------------------------------------------------------------- programs

/**
 * A stand-in for the composites module: replaces each composite (by id, anywhere) with the
 * given primitive statements, which use derived ids like the real desugaring.
 */
export function fakeDesugar(expansions: Record<string, Stmt[]>): (p: Program) => Program {
  const block = (stmts: Stmt[]): Stmt[] =>
    stmts.flatMap((s): Stmt[] => {
      switch (s.kind) {
        case 'composite': {
          const out = expansions[s.id];
          if (!out) throw new Error(`no expansion for composite ${s.id}`);
          return block(out);
        }
        case 'if':
          return [{ ...s, then: block(s.then), else: block(s.else) }];
        case 'while':
        case 'forEach':
          return [{ ...s, body: block(s.body) }];
        default:
          return [s];
      }
    });
  return (p) => ({
    ...p,
    functions: p.functions.map((f) => ({ ...f, body: block(f.body) })),
    body: block(p.body),
  });
}
