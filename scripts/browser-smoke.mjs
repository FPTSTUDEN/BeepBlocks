/**
 * Browser smoke test: serves dist/ with `vite preview`, opens it in headless Edge/Chrome over
 * the DevTools protocol, loads a seeded project, presses Run, and checks the result.
 *
 *   pnpm build && node scripts/browser-smoke.mjs
 *
 * BP_BROWSER overrides the browser executable. Exits 1 on any failed check or page error.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

/** A project that prints, then sorts the messy-downloads folder with a task block. */
function seedProject() {
  return {
    format: 'block-playground-project',
    version: 1,
    title: 'Smoke test',
    program: {
      format: 'block-playground-ir',
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
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const problems = [];
const pageErrors = [];
let ws;
try {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    await sleep(200);
    try {
      const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
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

  // 2. Seed a project (using the built-in scenario the app saved) and reload.
  await waitFor(`!!localStorage.getItem('bp.project')`, 'the first autosave', 5000).catch(async () => {
    // No edits yet → nothing autosaved; pick the scenario from a fresh project instead.
  });
  const seeded = seedProject();
  await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem('bp.project') || 'null');
    const p = ${JSON.stringify(seeded)};
    p.scenario = saved ? saved.scenario : null;
    localStorage.setItem('bp.project', JSON.stringify(p));
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

  // 5. Dark theme applies.
  await evaluate(`(() => { document.querySelector('dialog[open]')?.close(); document.querySelector('input[value=dark]').click(); })()`);
  await waitFor(`document.documentElement.dataset.bpMode === 'dark'`, 'dark mode');
} catch (err) {
  problems.push(err instanceof Error ? err.message : String(err));
} finally {
  ws?.close();
  browser.kill();
  await server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

for (const e of pageErrors) problems.push(`page error: ${e}`);
if (problems.length > 0) {
  console.log('FAIL browser smoke test');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`PASS browser smoke test (${browserPath.split(/[\\/]/).pop()})`);
