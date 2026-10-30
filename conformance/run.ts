/**
 * Conformance suite runner (design.md §11, Req 10).
 *
 *   pnpm conformance                 run all fixtures
 *   pnpm conformance <name> [...]    run selected fixtures
 *   pnpm conformance --coverage      also print the coverage report (see coverage.ts)
 *   pnpm conformance --strict        fail if coverage is incomplete
 *
 * Environment: BP_PYTHON overrides the Python executable (default: python on Windows, python3 elsewhere).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseProgram, type Program } from '../src/ir/index.ts';
import { DRY_RUN_PREFIX, type OutputLine, type Timeline } from '../src/ir/timeline.ts';
import type { ErrorCode } from '../src/ir/errors.ts';
import type { FsFolder, SandboxFS } from '../src/domains/fileExplorer/fsTypes.ts';
import { desugarProgram } from '../src/composites/index.ts';
import { simulateSync } from '../src/sim/index.ts';
import { exportPython } from '../src/export/index.ts';
import { diffTrees, materialize, normalizeTree, readTree } from './lib/tree.ts';
import { coverageReport, type FixtureRecord } from './coverage.ts';

const ROOT = resolve(import.meta.dirname);
const FIXTURES = join(ROOT, 'fixtures');
const TMP = resolve(ROOT, '..', '.conformance-tmp');
const PYTHON = process.env.BP_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

/** stderr line printed by the Python runtime on a _BPError (design.md §5.5). */
const PY_ERROR = /^Error at block (\S*) \(([A-Z_]+)\): /m;

interface Expected {
  tree?: SandboxFS;
  error?: { code: ErrorCode; nodeId: string } | null;
  output?: string[];
}

interface Outcome {
  tree: SandboxFS;
  error: { code: string; nodeId: string } | null;
  output: string[];
}

function lines(out: OutputLine[]): string[] {
  return splitOutput(out.map((l) => l.text + '\n').join(''));
}

/** Splits printed text on "\n" only, so a "\r" inside a line is kept on every OS. */
function splitOutput(text: string): string[] {
  const out = text.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
}

function runPython(script: string, dir: string, apply: boolean) {
  const args = [script, dir, ...(apply ? ['--apply'] : [])];
  const res = spawnSync(PYTHON, args, {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    timeout: 60_000,
  });
  if (res.error) throw new Error(`Could not run ${PYTHON}: ${res.error.message}`);
  // Python's text-mode stdout writes "\n" as "\r\n" on Windows; undo exactly that translation.
  const stdout = splitOutput(process.platform === 'win32' ? res.stdout.replace(/\r\n/g, '\n') : res.stdout);
  const m = PY_ERROR.exec(res.stderr);
  const error = m ? { nodeId: m[1]!, code: m[2]! } : null;
  if (res.status !== 0 && !m) {
    throw new Error(`Python exited with ${res.status} without a block error:\n${res.stderr}`);
  }
  if (res.status === 0 && m) throw new Error('Python printed a block error but exited with 0');
  return { stdout, error };
}

function sameError(a: Outcome['error'], b: Outcome['error']): boolean {
  return a === null || b === null ? a === b : a.code === b.code && a.nodeId === b.nodeId;
}

function diffLines(label: string, expected: string[], actual: string[]): string[] {
  const out: string[] = [];
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      out.push(`${label} line ${i + 1}: expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`);
      if (out.length >= 5) {
        out.push(`${label}: …`);
        break;
      }
    }
  }
  return out;
}

/** Paths touched by any action (excluded from mtime comparison), lower-cased: paths are case-insensitive. */
function touchedPaths(timeline: Timeline<SandboxFS>): Set<string> {
  const s = new Set<string>();
  for (const snap of timeline.snapshots) {
    if (snap.action) {
      s.add(snap.action.from.toLowerCase());
      if (snap.action.to) s.add(snap.action.to.toLowerCase());
    }
  }
  return s;
}

/** NUL, or a lone UTF-16 surrogate. */
const UNPORTABLE_TEXT = /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Text content that cannot round-trip through a real disk: NUL reads back as binary and
 * lone surrogates are written as U+FFFD.
 */
function unportableContent(fs: SandboxFS): string[] {
  const out: string[] = [];
  const walk = (folder: FsFolder, path: string) => {
    for (const c of folder.children) {
      const p = path === '' ? c.name : `${path}/${c.name}`;
      if (c.type === 'folder') walk(c, p);
      else if (c.content !== undefined && UNPORTABLE_TEXT.test(c.content)) {
        out.push(`tree.json: ${p} has NUL or lone-surrogate content, which cannot be compared on disk`);
      }
    }
  };
  walk(fs.root, '');
  return out;
}

function runFixture(name: string, records: FixtureRecord[]): string[] {
  const dir = join(FIXTURES, name);
  const parsed = parseProgram(readFileSync(join(dir, 'program.json'), 'utf8'));
  if (!parsed.ok) return parsed.errors.map((e) => `invalid program: [${e.nodeId}] ${e.message}`);
  const tree = normalizeTree(JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8')) as SandboxFS);
  const unportable = unportableContent(tree);
  if (unportable.length > 0) return unportable;
  const expectedPath = join(dir, 'expected.json');
  const expected: Expected | null = existsSync(expectedPath)
    ? (JSON.parse(readFileSync(expectedPath, 'utf8')) as Expected)
    : null;

  // 1–2. Desugar + simulate.
  const program: Program = desugarProgram(parsed.program);
  const sim = simulateSync(program, tree);
  if (!sim.ok) return sim.errors.map((e) => `desugared program invalid: [${e.nodeId}] ${e.message}`);
  const last = sim.timeline.snapshots[sim.timeline.snapshots.length - 1];
  const simOut: Outcome = {
    tree: last ? (last.state as SandboxFS) : tree,
    error: last?.error ? { code: last.error.code, nodeId: last.error.nodeId } : null,
    output: lines(sim.timeline.output),
  };
  records.push({ name, source: parsed.program, desugared: program, errorCode: simOut.error?.code ?? null });

  // 3. Export.
  const exported = exportPython(parsed.program, { desugar: desugarProgram, title: name });
  if (!exported.ok) return exported.errors.map((e) => `export failed: [${e.nodeId}] ${e.message}`);
  const work = join(TMP, name);
  mkdirSync(work, { recursive: true });
  const script = join(work, 'script.py');
  writeFileSync(script, exported.source, 'utf8');

  const problems: string[] = [];

  // 4. Apply run.
  const applyDir = join(work, 'apply');
  materialize(tree, applyDir);
  const applied = runPython(script, applyDir, true);
  const applyTree = readTree(applyDir);
  problems.push(
    ...diffTrees(simOut.tree, applyTree, { compareMtimes: { except: touchedPaths(sim.timeline) } }).map(
      (d) => `apply tree: ${d}`,
    ),
  );
  if (!sameError(simOut.error, applied.error)) {
    problems.push(`apply error: simulator ${JSON.stringify(simOut.error)}, python ${JSON.stringify(applied.error)}`);
  }
  problems.push(...diffLines('apply output', simOut.output, applied.stdout));

  // 5. Dry run: folder must be unchanged; output equals simulator output with prefixes.
  const dryDir = join(work, 'dry');
  materialize(tree, dryDir);
  const dry = runPython(script, dryDir, false);
  problems.push(
    ...diffTrees(tree, readTree(dryDir), { compareMtimes: { except: new Set() } }).map(
      (d) => `dry run changed the folder: ${d}`,
    ),
  );
  if (!sameError(simOut.error, dry.error)) {
    problems.push(`dry-run error: simulator ${JSON.stringify(simOut.error)}, python ${JSON.stringify(dry.error)}`);
  }
  const expectedDry = lines(
    sim.timeline.output.map((l) => (l.kind === 'action' ? { ...l, text: DRY_RUN_PREFIX + l.text } : l)),
  );
  problems.push(...diffLines('dry-run output', expectedDry, dry.stdout));

  // 7. Golden expectations (catch both sides being wrong the same way).
  if (expected) {
    if (expected.tree) {
      problems.push(...diffTrees(normalizeTree(expected.tree), simOut.tree).map((d) => `golden tree: ${d}`));
    }
    if (expected.error !== undefined && !sameError(expected.error, simOut.error)) {
      problems.push(`golden error: expected ${JSON.stringify(expected.error)}, simulator ${JSON.stringify(simOut.error)}`);
    }
    if (expected.output) problems.push(...diffLines('golden output', expected.output, simOut.output));
  }
  return problems;
}

function main(): void {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const selected = args.filter((a) => !a.startsWith('--'));
  const all = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const names = selected.length > 0 ? selected : all;
  const unknown = names.filter((n) => !all.includes(n));
  if (unknown.length > 0) {
    console.error(`Unknown fixture(s): ${unknown.join(', ')}`);
    process.exit(2);
  }

  const records: FixtureRecord[] = [];
  let failed = 0;
  for (const name of names) {
    let problems: string[];
    try {
      problems = runFixture(name, records);
    } catch (err) {
      problems = [`crashed: ${err instanceof Error ? err.message : String(err)}`];
    }
    if (problems.length === 0) console.log(`PASS  ${name}`);
    else {
      failed += 1;
      console.log(`FAIL  ${name}`);
      for (const p of problems) console.log(`        ${p}`);
    }
  }
  console.log(`\n${names.length - failed}/${names.length} fixtures passed.`);

  let coverageOk = true;
  if (flags.has('--coverage') || flags.has('--strict')) {
    const report = coverageReport(records);
    console.log(`\n${report.text}`);
    coverageOk = report.complete;
  }
  if (failed > 0 || (flags.has('--strict') && !coverageOk)) process.exit(1);
}

main();
