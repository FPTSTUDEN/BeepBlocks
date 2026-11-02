/**
 * End-to-end check of every starter project in real browser engines (tasks 3.3):
 *
 *   pnpm e2e                    Chromium and Firefox (one run per engine)
 *   pnpm e2e firefox            one engine: chromium | firefox
 *
 * For each engine and starter, in the built app (`vite preview`):
 *   1. open the starter from the "New…" dialog, Run, pause, scrub to the middle and to the end,
 *      step back and forward;
 *   2. the Output panel must equal the starter fixture's hand-checked golden
 *      (conformance/fixtures/starter-* /expected.json);
 *   3. copy the exported Python script from the Export dialog;
 *   4. Expand the composite (right-click → "Expand into basic blocks"), run again: same output;
 *      export again;
 *   5. both scripts run on a real copy of the scenario: the dry run leaves it unchanged and
 *      prints the output with "[dry run] " prefixes; `--apply` prints the output and leaves the
 *      same tree as the simulator (diffed like the conformance suite).
 *
 * Browsers come from Playwright (`pnpm exec playwright install chromium firefox`). The installed
 * Edge is covered by `pnpm smoke`. BP_PYTHON overrides the Python executable.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { preview } from 'vite';
import { STARTERS, type Starter } from '../src/app/starters.ts';
import { desugarProgram } from '../src/composites/index.ts';
import { getScenario } from '../src/domains/fileExplorer/scenarios/index.ts';
import type { SandboxFS } from '../src/domains/fileExplorer/fsTypes.ts';
import { DRY_RUN_PREFIX } from '../src/ir/timeline.ts';
import { simulateSync } from '../src/sim/index.ts';
import { diffTrees, materialize, normalizeTree, readTree } from '../conformance/lib/tree.ts';

const ROOT = resolve(import.meta.dirname, '..');
const TMP = join(ROOT, '.e2e-tmp');
const PORT = 4319;
const PYTHON = process.env.BP_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type Engine = 'chromium' | 'firefox';
const ENGINES: Engine[] = ['chromium', 'firefox'];

function launch(engine: Engine): Promise<Browser> {
  return engine === 'firefox' ? firefox.launch() : chromium.launch();
}

const golden = (s: Starter): string[] =>
  (
    JSON.parse(
      readFileSync(join(ROOT, 'conformance', 'fixtures', `starter-${s.scenarioId}`, 'expected.json'), 'utf8'),
    ) as { output: string[] }
  ).output;

/** Id of the starter's composite block (the one Expand replaces). */
const compositeId = (s: Starter) => s.program.body.find((n) => n.kind === 'composite')!.id;

// ------------------------------------------------------------------ page

async function status(page: Page): Promise<string> {
  // Without the decorative ✓ of "Done".
  return ((await page.getByTestId('status').textContent()) ?? '').replace('✓', '').trim();
}

async function outputLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((x) => x.textContent === 'Output');
    const items = h?.closest('section')?.querySelectorAll('li') ?? [];
    return [...items].map((li) => li.lastElementChild?.textContent ?? '');
  });
}

async function scrubTo(page: Page, value: number | 'end'): Promise<void> {
  await page.getByRole('slider', { name: 'Step' }).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const next = v === 'end' ? input.max : String(v);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Run, pause, scrub (middle, end), step back/forward; returns the final output. */
async function runAndScrub(page: Page, problems: string[], label: string): Promise<string[]> {
  const run = page.getByRole('button', { name: /Run$/ });
  await run.click();
  // Wait for a NEW playback (Pause enabled) and pause it in the same page task. Checking the
  // status instead would pass at once on the previous, stale timeline after Expand.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim().endsWith('Pause'));
    if (!(b instanceof HTMLButtonElement) || b.disabled) return false;
    b.click();
    return true;
  });
  if (await page.getByText('Program changed — run again').isVisible()) {
    problems.push(`${label}: the timeline is still stale after Run`);
  }
  const max = Number(await page.getByRole('slider', { name: 'Step' }).getAttribute('max'));
  const mid = Math.floor(max / 2);
  await scrubTo(page, mid);
  const midStatus = await status(page);
  if (midStatus !== `Step ${mid + 1} of ${max + 1}`) problems.push(`${label}: scrub to middle shows "${midStatus}"`);
  await scrubTo(page, 'end');
  if ((await status(page)) !== 'Done') problems.push(`${label}: scrub to end shows "${await status(page)}"`);
  await page.getByRole('button', { name: /Step back/ }).click();
  if ((await status(page)) !== `Step ${max} of ${max + 1}`) problems.push(`${label}: step back shows "${await status(page)}"`);
  await page.getByRole('button', { name: /Step forward/ }).click();
  if ((await status(page)) !== 'Done') problems.push(`${label}: step forward shows "${await status(page)}"`);
  return outputLines(page);
}

async function exportScript(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Export Python' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export to Python' });
  const text = (await dialog.getByLabel('Python script').textContent()) ?? '';
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'detached' });
  return text;
}

function compare(label: string, expected: string[], actual: string[], problems: string[]): void {
  const n = Math.max(expected.length, actual.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 5; i++) {
    if (expected[i] !== actual[i]) {
      problems.push(`${label} line ${i + 1}: expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`);
      shown++;
    }
  }
}

// ---------------------------------------------------------------- python

/** Python results per script text: the script is the same in every engine, so run it once. */
const pythonCache = new Map<string, string[]>();

function runPython(script: string, dir: string, apply: boolean): string[] {
  const res = spawnSync(PYTHON, [script, dir, ...(apply ? ['--apply'] : [])], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    timeout: 120_000,
  });
  if (res.error) throw new Error(`Could not run ${PYTHON}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`Python exited with ${res.status}:\n${res.stderr}`);
  const out = (process.platform === 'win32' ? res.stdout.replace(/\r\n/g, '\n') : res.stdout).split('\n');
  if (out.at(-1) === '') out.pop();
  return out;
}

/** Dry run + apply on fresh copies of `tree`; returns problems (cached per script). */
function checkScript(s: Starter, source: string, expected: string[], expectedDry: string[], finalTree: SandboxFS): string[] {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const cached = pythonCache.get(hash);
  if (cached) return cached;
  const problems: string[] = [];
  const tree = normalizeTree(getScenario(s.scenarioId)!.tree);
  const work = join(TMP, `${s.scenarioId}-${hash}`);
  mkdirSync(work, { recursive: true });
  const file = join(work, 'script.py');
  writeFileSync(file, source, 'utf8');

  const dry = join(work, 'dry');
  materialize(tree, dry);
  compare('dry-run output', expectedDry, runPython(file, dry, false), problems);
  problems.push(...diffTrees(tree, readTree(dry), { compareMtimes: { except: new Set() } }).map((d) => `dry run changed the folder: ${d}`));

  const apply = join(work, 'apply');
  materialize(tree, apply);
  compare('--apply output', expected, runPython(file, apply, true), problems);
  problems.push(...diffTrees(finalTree, readTree(apply)).map((d) => `--apply tree: ${d}`));

  if (problems.length === 0) rmSync(work, { recursive: true, force: true });
  pythonCache.set(hash, problems);
  return problems;
}

// ------------------------------------------------------------------ main

async function checkStarter(page: Page, s: Starter): Promise<string[]> {
  const problems: string[] = [];
  const expected = golden(s);
  await page.getByRole('button', { name: 'New…' }).click();
  await page.getByRole('button', { name: `Open example “${s.title}”` }).click();
  await page.locator(`[data-id="${compositeId(s)}"]`).first().waitFor();

  compare('run output', expected, await runAndScrub(page, problems, 'run'), problems);
  const original = await exportScript(page);

  // Expand with the mouse (the keyboard path is covered by `pnpm smoke`).
  await page.locator(`[data-id="${compositeId(s)}"] > .blocklyPath`).first().click({ button: 'right', position: { x: 6, y: 6 }, force: true }); // its own labels sit on top
  await page.locator('.blocklyContextMenu .blocklyMenuItem', { hasText: 'Expand into basic blocks' }).click();
  await page.locator(`[data-id="${compositeId(s)}"]`).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /Run$/ }).waitFor();
  compare('expanded run output', expected, await runAndScrub(page, problems, 'expanded run'), problems);
  const expanded = await exportScript(page);

  const sim = simulateSync(desugarProgram(s.program), getScenario(s.scenarioId)!.tree);
  if (!sim.ok) throw new Error('starter does not simulate');
  const finalTree = sim.timeline.snapshots.at(-1)!.state;
  const expectedDry = sim.timeline.output.map((l) => (l.kind === 'action' ? DRY_RUN_PREFIX : '') + l.text);
  problems.push(...checkScript(s, original, expected, expectedDry, finalTree).map((p) => `script: ${p}`));
  problems.push(...checkScript(s, expanded, expected, expectedDry, finalTree).map((p) => `expanded script: ${p}`));
  return problems;
}

async function main(): Promise<void> {
  const selected = process.argv.slice(2) as Engine[];
  const unknown = selected.filter((e) => !ENGINES.includes(e));
  if (unknown.length > 0) {
    console.error(`Unknown engine(s): ${unknown.join(', ')}. Use ${ENGINES.join(', ')}.`);
    process.exit(2);
  }
  const engines = selected.length > 0 ? selected : ENGINES;
  const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  let failed = 0;
  try {
    for (const engine of engines) {
      const browser = await launch(engine);
      console.log(`${engine} ${browser.version()}`);
      try {
        for (const s of STARTERS) {
          const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
          const page = await context.newPage();
          const pageErrors: string[] = [];
          page.on('pageerror', (e) => pageErrors.push(e.message));
          page.on('console', (m) => {
            if (m.type() === 'error') pageErrors.push(m.text());
          });
          let problems: string[];
          try {
            await page.goto(`http://localhost:${PORT}/`);
            await page.locator('.blocklySvg').waitFor();
            problems = await checkStarter(page, s);
          } catch (err) {
            problems = [`crashed: ${err instanceof Error ? err.message : String(err)}`];
          }
          problems.push(...pageErrors.map((e) => `page error: ${e}`));
          await context.close();
          if (problems.length === 0) console.log(`  PASS  ${s.title}`);
          else {
            failed++;
            console.log(`  FAIL  ${s.title}`);
            for (const p of problems) console.log(`          ${p}`);
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
    // Passing scripts delete their folders; drop the parent too when nothing failed.
    if (failed === 0) rmSync(TMP, { recursive: true, force: true });
  }
  const total = engines.length * STARTERS.length;
  console.log(`\n${total - failed}/${total} starter runs passed (${engines.join(', ')}).`);
  if (failed > 0) process.exit(1);
}

await main();
