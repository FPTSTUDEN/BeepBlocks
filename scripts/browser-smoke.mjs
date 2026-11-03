/**
 * Browser smoke test: serves dist/ with `vite preview`, opens it in headless Edge/Chrome over
 * the DevTools protocol, checks the first-run starter, opens every starter from the New dialog,
 * runs the binary-search starter, then loads a seeded project, presses Run, and checks the result.
 *
 *   pnpm build && node scripts/browser-smoke.mjs
 *
 * BP_BROWSER overrides the browser executable. Exits 1 on any failed check or page error.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview } from 'vite';

const BROWSERS = [
  process.env.BP_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) {
  console.error('No Chromium-based browser found; set BP_BROWSER.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(timeoutMs),
  ]);
}

async function terminateBrowser(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      killer.once('close', resolve);
      killer.once('error', resolve);
    });
  } else {
    child.kill();
  }
  await waitForExit(child);
}

async function removeProfile(path) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err) {
      if (err?.code !== 'EBUSY' && err?.code !== 'EPERM') throw err;
      await sleep(250);
    }
  }
  rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}

/** A project that prints, then sorts the messy-downloads folder with a task block. */
function seedProject() {
  return {
    format: 'beepblocks-project',
    version: 1,
    title: 'Smoke test',
    program: {
      format: 'beepblocks-ir',
      version: 1,
      functions: [],
      body: [
        { id: 'p1', kind: 'print', value: { id: 'l1', kind: 'lit', value: 'smoke start' } },
        {
          id: 'sort',
          kind: 'composite',
          name: 'sortByType',
          fields: { grouping: 'category' },
          inputs: { folder: { id: 'r', kind: 'op', op: 'fs.root', args: [] } },
          bodies: {},
          binds: {},
        },
        { id: 'p2', kind: 'print', value: { id: 'l2', kind: 'lit', value: 'smoke end' } },
      ],
    },
    layout: { 'when-run': { x: 40, y: 40 } },
    scenario: null, // filled in the page from the built-in scenario
  };
}

const server = await preview({ preview: { port: 4317, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4317/';
const profile = mkdtempSync(join(tmpdir(), 'bp-smoke-'));
const debugPort = await getFreePort();
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const problems = [];
const pageErrors = [];
/** Page states the axe audit ran on. */
const audits = [];
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let ws;
let closeBrowser;
try {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = targets.find((t) => t.type === 'page');
    } catch {
      /* not up yet */
    }
  }
  if (!page) throw new Error('Browser did not expose a page target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  closeBrowser = () => send('Browser.close');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const waitFor = async (expression, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  /** A real key press through the browser's input pipeline (not a synthetic DOM event). */
  const press = async (key, { ctrl = false, shift = false } = {}) => {
    const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const text = key === ' ' ? ' ' : key === 'Enter' ? '\r' : undefined;
    const base = { key, windowsVirtualKeyCode: KEY_CODES[key], modifiers };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text && !ctrl ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(120);
  };
  /** Short description of the focused element (block id inside Blockly). */
  const focused = () =>
    evaluate(`(() => {
      const a = document.activeElement;
      const block = a?.closest?.('[data-id]')?.getAttribute('data-id');
      return block ? 'block:' + block : (a?.id ? '#' + a.id + ' ' : '') + (a?.getAttribute('role') ?? a?.tagName ?? '') + ' ' + (a?.textContent ?? '').trim().slice(0, 40);
    })()`);
  const expectFocus = async (pattern, what) => {
    const end = Date.now() + 3000;
    let got = '';
    while (Date.now() < end) {
      got = await focused();
      if (pattern.test(got)) return;
      await sleep(100);
    }
    throw new Error(`Keyboard walkthrough: expected focus on ${what}, got "${got}"`);
  };
  const statusText = () => evaluate(`document.querySelector('[data-testid=status]').textContent`);

  /**
   * WCAG 2.1 A/AA audit of the current page state with axe-core. Violations are collected as
   * problems (one line per rule and element).
   */
  const audit = async (label) => {
    if (!(await evaluate('!!window.axe'))) await evaluate(axeSource);
    const result = await evaluate(`(async () => {
      const r = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations'],
      });
      return r.violations.map((v) => ({
        id: v.id,
        help: v.help,
        nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ') + (n.failureSummary ? ' :: ' + n.failureSummary.split('\\n').slice(1, 2).join('').trim() : '')),
        count: v.nodes.length,
      }));
    })()`);
    audits.push(label);
    for (const v of result) {
      problems.push(`axe [${label}] ${v.id} (${v.count}): ${v.help}`);
      for (const n of v.nodes) problems.push(`    ${n}`);
    }
  };
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      pageErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  // 1. Fresh load: the shell, the editor and the playground mount.
  await send('Page.navigate', { url });
  await waitFor(`!!document.querySelector('.blocklySvg')`, 'the Blockly workspace');
  await waitFor(`!!document.querySelector('[role=region][aria-label^="Playground"]')`, 'the playground');

  // 1b. First run opens a starter; every starter opens from the New dialog and renders its blocks.
  await waitFor(`document.querySelector('.title-input')?.value === 'Sort my downloads'`, 'the first-run starter');
  await waitFor(`document.querySelectorAll('.blocklyDraggable').length >= 1`, 'the first-run blocks');
  await audit('first run, light');

  // 1a. Keyboard-only walkthrough (real key events) on the first-run starter.
  await evaluate(`document.activeElement?.blur()`);
  await press('Tab');
  await expectFocus(/Skip to the block editor/, 'the first skip link');
  await press('Enter');
  await expectFocus(/^#bp-editor-pane/, 'the editor pane');
  await press('Tab'); // palette category
  await press('Tab'); // palette flyout
  await press('Tab'); // workspace: the "when run" block
  await expectFocus(/^block:when-run$/, 'the "when run" block');
  await press('ArrowDown');
  await expectFocus(/^block:dl-sort$/, 'the sort task block');
  await press('Enter', { ctrl: true });
  await waitFor(
    `[...document.querySelectorAll('.blocklyContextMenu .blocklyMenuItem')].some(e => e.textContent.includes('Expand into basic blocks'))`,
    'the block menu with "Expand" (Ctrl+Enter)',
  );
  await press('Escape');
  await expectFocus(/^block:dl-sort$/, 'the sort block after closing its menu');
  await press('ArrowRight'); // the folder input
  await press('ArrowRight'); // the "group by" dropdown field
  await press('Enter');
  await waitFor(`!!document.querySelector('.blocklyDropdownMenu[role=listbox]')`, 'the field dropdown (Enter)');
  await press('Escape');
  // Playground: skip link, folder tree, file list, then the playback controls. (Focusing the
  // first skip link stands in for Tab from the address bar.)
  await evaluate(`document.querySelector('.skip-links a').focus()`);
  await press('Tab');
  await expectFocus(/Skip to the playground/, 'the second skip link');
  await press('Enter');
  await press('Tab');
  await expectFocus(/treeitem .*Top folder/, 'the folder tree');
  await press('Tab');
  await expectFocus(/^option /, 'the file list');
  await press('End');
  await expectFocus(/option .*song\.mp3/, 'the last file (End)');
  await press('Tab');
  await expectFocus(/Run$/, 'the Run button');
  await press(' ');
  await expectFocus(/Pause$/, 'Pause after starting the run with Space');
  await press(' ');
  await expectFocus(/Run$/, 'Run after pausing with Space');
  const paused = await statusText();
  await press('ArrowRight');
  const stepped = await statusText();
  const n = (s) => Number(/Step (\d+)/.exec(s)?.[1]);
  if (!(n(stepped) === n(paused) + 1)) problems.push(`ArrowRight did not step forward: "${paused}" → "${stepped}"`);
  await press('Home');
  if ((await statusText()) !== 'Not run yet') problems.push('Home did not reset the timeline');
  const starters = [
    ['Sort my downloads', 'Messy Downloads folder'],
    ['Rename camera photos', 'Camera photos'],
    ['Clear out temporary files', 'Project folder'],
    ['Find the first failing night', 'Nightly build logs'],
  ];
  for (const [title, scenario] of starters) {
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'New…').click()`);
    await waitFor(`!!document.querySelector('dialog[open]')`, 'the New dialog');
    if (title === starters[0][0]) await audit('New dialog, light');
    await evaluate(
      `document.querySelector('dialog[open] button[aria-label=' + JSON.stringify(${JSON.stringify(`Open example “${title}”`)}) + ']').click()`,
    );
    await waitFor(`document.querySelector('.title-input')?.value === ${JSON.stringify(title)}`, `starter "${title}"`);
    await waitFor(
      `document.querySelector('#bp-scenario').selectedOptions[0]?.textContent === ${JSON.stringify(scenario)}`,
      `the scenario of "${title}"`,
    );
    await waitFor(`document.querySelectorAll('.blocklyDraggable').length >= 2`, `the blocks of "${title}"`);
  }
  // The last starter (binary search) runs and finds the first failing log.
  await waitFor(
    `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().endsWith('Run')); return b && !b.disabled; })()`,
    'Run to be enabled on the bisect starter',
  );
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().endsWith('Run')).click()`);
  await waitFor(`/Step \\d+ of \\d+|Done/.test(document.body.innerText)`, 'the bisect timeline');
  // Pause partway (active row, tags, position gutter on screen) for an audit.
  await evaluate(`(async () => {
    const pause = [...document.querySelectorAll('button')].find(b => b.textContent.trim().endsWith('Pause'));
    pause?.click();
    const fwd = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Step forward'));
    for (let i = 0; i < 150 && !fwd.disabled; i++) { fwd.click(); await new Promise(r => setTimeout(r, 0)); }
  })()`);
  await audit('bisect mid-run, light');
  await evaluate(`(async () => {
    const fwd = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Step forward'));
    for (let i = 0; i < 2000 && !fwd.disabled; i++) { fwd.click(); await new Promise(r => setTimeout(r, 0)); }
  })()`);
  await waitFor(
    `document.body.innerText.includes('First failing night: nightly-2026-02-10.log')`,
    'the bisect result',
  );
  // Back to the messy-downloads starter for the seeded-project checks below.
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'New…').click()`);
  await waitFor(`!!document.querySelector('dialog[open]')`, 'the New dialog');
  await evaluate(`document.querySelector('dialog[open] button[aria-label="Open example “Sort my downloads”"]').click()`);
  await waitFor(`document.querySelector('.title-input')?.value === 'Sort my downloads'`, 'the downloads starter');
  // Let the autosave settle, or the reload's beforeunload flush would overwrite the seed below.
  await waitFor(
    `JSON.parse(localStorage.getItem('beepblocks.project') || '{}').title === 'Sort my downloads'`,
    'the starter autosave',
    5000,
  );

  // 2. Seed a project (using the built-in scenario the app saved) and reload.
  await waitFor(`!!localStorage.getItem('beepblocks.project')`, 'the first autosave', 5000).catch(async () => {
    // No edits yet → nothing autosaved; pick the scenario from a fresh project instead.
  });
  const seeded = seedProject();
  await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem('beepblocks.project') || 'null');
    const p = ${JSON.stringify(seeded)};
    p.scenario = saved ? saved.scenario : null;
    localStorage.setItem('beepblocks.project', JSON.stringify(p));
    return !!p.scenario;
  })()`).then((ok) => {
    if (!ok) throw new Error('Could not read a scenario to seed the project with');
  });
  await send('Page.reload');
  await waitFor(`document.querySelector('.title-input')?.value === 'Smoke test'`, 'the seeded project');
  await waitFor(`document.querySelectorAll('.blocklyDraggable').length >= 3`, 'the seeded blocks');

  // 3. Run (in a real module Worker) and wait for the end of playback.
  await waitFor(
    `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().endsWith('Run')); return b && !b.disabled; })()`,
    'Run to be enabled',
  );
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().endsWith('Run')).click()`);
  await waitFor(`/Step \\d+ of \\d+|Done/.test(document.body.innerText)`, 'a timeline');
  // Jump to the end with the keyboard shortcut path: press "Step forward" until done.
  await evaluate(`(async () => {
    const fwd = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Step forward'));
    for (let i = 0; i < 500 && !fwd.disabled; i++) { fwd.click(); await new Promise(r => setTimeout(r, 0)); }
  })()`);
  await waitFor(`document.body.innerText.includes('smoke end')`, 'the final output line');
  const text = await evaluate('document.body.innerText');
  for (const expected of ['smoke start', 'MKDIR', 'MOVE', 'smoke end', 'Done']) {
    if (!text.includes(expected)) problems.push(`output is missing "${expected}"`);
  }

  // 4. Export dialog renders a script.
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Export Python').click()`);
  await waitFor(`!!document.querySelector('dialog[open] pre')`, 'the export dialog');
  const script = await evaluate(`document.querySelector('dialog[open] pre').textContent`);
  if (!script.includes('--apply') || !script.includes('smoke start')) problems.push('export preview looks wrong');
  await audit('export dialog, light');

  // 5. Dark theme applies; audit the finished run and a step with diff badges in dark mode.
  await evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent === 'Close').click()`);
  await waitFor(`!document.querySelector('dialog[open]')`, 'the export dialog to close');
  await evaluate(`document.querySelector('input[value=dark]').click()`);
  await waitFor(`document.documentElement.dataset.bpMode === 'dark'`, 'dark mode');
  await audit('run done, dark');
  await evaluate(`(async () => {
    const back = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Step back'));
    for (let i = 0; i < 6 && !back.disabled; i++) { back.click(); await new Promise(r => setTimeout(r, 0)); }
  })()`);
  await audit('mid-run with diffs, dark');

  // 6. Extreme accent colours (they are blended until legible): yellow in light, blue in dark.
  const setAccent = (hex) =>
    evaluate(`(() => {
      const input = document.querySelector('input[type=color]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(hex)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  await setAccent('#0000ff');
  await waitFor(`JSON.parse(localStorage.getItem('beepblocks.settings') || '{}').accent === '#0000ff'`, 'the blue accent');
  await audit('accent #0000ff, dark');
  await evaluate(`document.querySelector('input[value=light]').click()`);
  await setAccent('#ffff00');
  await waitFor(`document.documentElement.dataset.bpMode === 'light'`, 'light mode');
  await waitFor(`JSON.parse(localStorage.getItem('beepblocks.settings') || '{}').accent === '#ffff00'`, 'the yellow accent');
  await audit('accent #ffff00, light');
} catch (err) {
  problems.push(err instanceof Error ? err.message : String(err));
} finally {
  try {
    await closeBrowser?.();
  } catch {
    /* Browser may already have exited after a failed smoke assertion. */
  }
  ws?.close();
  await terminateBrowser(browser);
  await server.close();
  await removeProfile(profile);
}

for (const e of pageErrors) problems.push(`page error: ${e}`);
if (problems.length > 0) {
  console.log('FAIL browser smoke test');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`PASS browser smoke test (${browserPath.split(/[\\/]/).pop()}; axe clean in: ${audits.join(', ')})`);
