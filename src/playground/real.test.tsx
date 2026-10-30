// @vitest-environment jsdom
/* eslint-disable no-restricted-imports -- tests build REAL timelines with the simulator. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
