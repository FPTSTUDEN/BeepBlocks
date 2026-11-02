// @vitest-environment jsdom
/* eslint-disable no-restricted-imports -- tests build REAL timelines with the simulator. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import type { Timeline } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { getScenario } from '../domains/fileExplorer/scenarios/index.ts';
import { simulateSync } from '../sim/index.ts';
import { Playground, type PlaygroundProps } from './index.tsx';
import { traceNodeIds } from './lib/trace.ts';

afterEach(cleanup);

function run(body: Stmt[], fs: SandboxFS): Timeline<SandboxFS> {
  const r = simulateSync(b.program(body), fs);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.timeline;
}

function props(t: Timeline<SandboxFS>, initial: SandboxFS, index: number): PlaygroundProps {
  return {
    initial,
    timeline: t,
    index,
    onIndexChange: () => {},
    stale: false,
    onRun: () => {},
    onReset: () => {},
    onTrace: () => {},
    editingScenario: false,
    onScenarioChange: () => {},
  };
}

const camera = getScenario('camera-photos')!.tree;

/** Renames every *.JPG photo in the top folder from IMG_… to photo_…. */
const renameProgram: Stmt[] = [
  b.assign('items', b.op('fs.list', [b.root()], 'ls'), 'items'),
  b.forEach(
    'item',
    b.v('items'),
    [
      b.if(
        b.bin('==', b.op('fs.ext', [b.v('item')]), b.lit('JPG')),
        [
          b.assign(
            'renamed',
            b.op(
              'fs.rename',
              [
                b.v('item'),
                b.op('text.replace', [
                  b.op('fs.name', [b.v('item')]),
                  b.lit('IMG'),
                  b.lit('photo'),
                ]),
              ],
              'rn',
            ),
            'as',
          ),
        ],
        [],
        'if',
      ),
    ],
    'loop',
  ),
  b.print(b.lit('finished'), 'p'),
];

describe('Playground with a real simulator timeline', () => {
  const t = run(renameProgram, camera);

  it('the run ends done and renders every step', () => {
    expect(t.outcome).toBe('done');
    const { rerender, getByTestId } = render(<Playground {...props(t, camera, 0)} />);
    for (let i = 0; i < t.snapshots.length; i++) {
      rerender(<Playground {...props(t, camera, i)} />);
    }
    expect(getByTestId('status').textContent).toContain('Done');
    expect(screen.getByText('finished')).toBeTruthy();
  });

  it('shows the rename diff, the loop variable tag, and traces through the rename', () => {
    const i = t.snapshots.findIndex((s) => s.action?.op === 'RENAME');
    const a = t.snapshots[i]!.action!;
    const onTrace = vi.fn();
    const { container } = render(<Playground {...props(t, camera, i)} onTrace={onTrace} />);
    const row = container.querySelector<HTMLElement>(`[role="option"][data-path="${a.to!}"]`)!;
    expect(row.textContent).toContain(`renamed, was ${a.from}`);
    // `item` still holds the old path, which no longer exists.
    const item = container.querySelector('[data-var="item"]')!;
    expect(item.textContent).toContain(`./${a.from}`);
    expect(item.textContent).toContain('(missing)');
    fireEvent.click(row);
    const ids = onTrace.mock.lastCall![0] as string[];
    expect(ids).toContain('rn');
    expect(ids).toEqual(traceNodeIds(t, i, a.to!));
  });

  it('real hints: index tags, gutter and the end row', () => {
    const fs = getScenario('nightly-logs')!.tree;
    const hint = { indexInto: 'items' };
    const tl = run(
      [
        b.assign('items', b.op('fs.list', [b.root()]), 'items'),
        b.assign('low', b.lit(0), 'low', hint),
        b.assign('high', b.op('list.length', [b.v('items')]), 'high', hint),
      ],
      fs,
    );
    const i = tl.snapshots.findIndex((s) => s.nodeId === 'high');
    const items = tl.snapshots[i]!.frames[0]!.vars['items']!;
    const n = items.t === 'list' ? items.v.length : -1;
    render(<Playground {...props(tl, fs, i)} />);
    const end = screen.getByTestId('end-row');
    expect(end.textContent).toContain(`end = ${String(n)}`);
    expect(end.querySelector('[data-tag="high"]')).not.toBeNull();
    const list = screen.getByRole('listbox', {
      name: new RegExp(`List items \\(${String(n)} items`),
    });
    const first = within(list).getAllByRole('option')[0]!;
    expect(first.textContent).toMatch(/^position 0/);
    expect(first.querySelector('[data-tag="low"]')).not.toBeNull();
  });

  it('a real error run shows the banner with the failing block', () => {
    const tl = run(
      [b.do(b.op('fs.delete', [b.op('fs.join', [b.root(), b.lit('nope.txt')])], 'del'), 'd')],
      camera,
    );
    expect(tl.outcome).toBe('error');
    render(<Playground {...props(tl, camera, tl.snapshots.length - 1)} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(`at block ${tl.snapshots.at(-1)!.error!.nodeId}`);
  });
});

describe('file list keyboard navigation on a nested scenario', () => {
  const tree = getScenario('project-tree')!.tree;
  const t = run([b.print(b.lit('hi'), 'p')], tree);
  const rowEl = (path: string) => document.querySelector<HTMLElement>(`[role=option][data-path="${path}"]`)!;

  it('→ opens a folder; ← and Backspace go up one folder from any row', () => {
    render(<Playground {...props(t, tree, 0)} />);
    rowEl('logs').focus();
    fireEvent.keyDown(rowEl('logs'), { key: 'ArrowRight' });
    expect(screen.getByRole('listbox', { name: 'Files in ./logs' })).toBeTruthy();
    rowEl('logs/old').focus();
    fireEvent.keyDown(rowEl('logs/old'), { key: 'ArrowRight' });
    expect(screen.getByRole('listbox', { name: 'Files in ./logs/old' })).toBeTruthy();
    // A file row: Backspace goes up to logs, then ← goes up to the top folder.
    rowEl('logs/old/2025-11.log').focus();
    fireEvent.keyDown(rowEl('logs/old/2025-11.log'), { key: 'Backspace' });
    expect(screen.getByRole('listbox', { name: 'Files in ./logs' })).toBeTruthy();
    rowEl('logs/app.log').focus();
    fireEvent.keyDown(rowEl('logs/app.log'), { key: 'ArrowLeft' });
    expect(screen.getByRole('listbox', { name: 'Files in Top folder' })).toBeTruthy();
  });

  it('← in the top folder does nothing and does not step the timeline', () => {
    const onIndexChange = vi.fn();
    render(<Playground {...props(t, tree, 1)} onIndexChange={onIndexChange} />);
    rowEl('cache.tmp').focus();
    fireEvent.keyDown(rowEl('cache.tmp'), { key: 'ArrowLeft' });
    expect(screen.getByRole('listbox', { name: 'Files in Top folder' })).toBeTruthy();
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('keeps badges and tags in a row’s accessible text and labels size and date', () => {
    render(<Playground {...props(t, tree, 0)} />);
    const text = rowEl('cache.tmp').textContent!;
    expect(text).toContain('cache.tmp');
    expect(text).toMatch(/, size 16 B/);
    expect(text).toMatch(/, modified 2026-01-20 12:00/);
    expect(rowEl('cache.tmp').getAttribute('aria-label')).toBeNull();
  });
});

describe('scenario editor focus', () => {
  const tree = getScenario('project-tree')!.tree;
  function Editor() {
    const [fs, setFs] = useState(tree);
    return (
      <Playground
        {...props(run([], tree), fs, 0)}
        initial={fs}
        editingScenario
        onScenarioChange={setFs}
      />
    );
  }

  it('choosing a folder in the tree leaves focus in the tree', () => {
    render(<Editor />);
    const tree = screen.getByRole('tree', { name: 'Folders' });
    const docs = within(tree).getByRole('treeitem', { name: /docs/ });
    docs.focus();
    fireEvent.keyDown(docs, { key: 'Enter' });
    expect(document.activeElement).toBe(within(tree).getByRole('treeitem', { name: /docs/ }));
  });

  it('keeps focus in the name field after a rename', () => {
    render(<Editor />);
    fireEvent.click(document.querySelector<HTMLElement>('[role=option][data-path="cache.tmp"]')!);
    const edit = screen.getByRole('region', { name: 'Edit File cache.tmp' });
    const name = within(edit).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'cache.old' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Rename' }));
    const renamed = screen.getByRole('region', { name: 'Edit File cache.old' });
    expect(document.activeElement).toBe(within(renamed).getByRole('textbox', { name: 'Name' }));
  });

  it('moves focus to the parent folder in the tree after a delete', () => {
    render(<Editor />);
    const tree = screen.getByRole('tree', { name: 'Folders' });
    fireEvent.keyDown(within(tree).getByRole('treeitem', { name: /docs/ }), { key: 'Enter' });
    fireEvent.click(document.querySelector<HTMLElement>('[role=option][data-path="docs/draft.tmp"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft.tmp' }));
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
    expect(document.activeElement?.textContent).toContain('docs');
  });
});

describe('playback focus while a run starts', () => {
  const tree = getScenario('project-tree')!.tree;
  const t = run([b.print(b.lit('a'), 'p1'), b.print(b.lit('b'), 'p2')], tree);

  /** Like the app: Run is blocked ("Running…") until the timeline arrives a moment later. */
  function Host() {
    const [timeline, setTimeline] = useState<Timeline<SandboxFS> | null>(null);
    const [running, setRunning] = useState(false);
    const [index, setIndex] = useState(0);
    return (
      <Playground
        {...props(t, tree, index)}
        timeline={timeline}
        onIndexChange={setIndex}
        runBlockedReason={running ? 'Running…' : null}
        onRun={() => {
          setRunning(true);
          setTimeout(() => {
            setTimeline(t);
            setRunning(false);
          }, 10);
        }}
        onReset={() => {
          setTimeline(null);
          setIndex(0);
        }}
      />
    );
  }

  it('parks focus on the toolbar, then moves it to Pause; Reset is announced', async () => {
    vi.useFakeTimers();
    try {
      render(<Host />);
      const runBtn = screen.getByRole('button', { name: /Run/ });
      runBtn.focus();
      fireEvent.click(runBtn);
      expect(document.activeElement).toBe(screen.getByRole('toolbar', { name: 'Playback controls' }));
      await act(async () => {
        vi.advanceTimersByTime(20);
      });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Pause/ }));
      fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
      const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]')!;
      expect(live.textContent).toBe('Reset to the starting files.');
    } finally {
      vi.useRealTimers();
    }
  });
});
