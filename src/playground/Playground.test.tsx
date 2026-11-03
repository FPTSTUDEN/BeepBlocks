// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Timeline } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { getNode } from '../domains/fileExplorer/fsTypes.ts';
import { MOCK_TIMELINES } from './__mocks__/timelines.ts';
import { EXTRA_TIMELINES } from './__mocks__/extraTimelines.ts';
import { Playground, type PlaygroundProps } from './index.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps focus on the replacement playback control', () => {
  render(<Harness timeline={rename} />);
  const run = screen.getByRole('button', { name: /Run/ });
  run.focus();
  fireEvent.click(run);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Pause/ }));
  fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Run/ }));
});

const { rename, sort, bisect, error } = MOCK_TIMELINES;
const { cleanup: cleanupTl } = EXTRA_TIMELINES;

type HarnessProps = Partial<Omit<PlaygroundProps, 'timeline'>> & {
  timeline: Timeline<SandboxFS> | null;
};

/** Holds the controlled index like the app does. */
function Harness(props: HarnessProps) {
  const [index, setIndex] = useState(props.index ?? 0);
  const initial =
    props.initial ?? props.timeline?.snapshots[0]?.state ?? rename.snapshots[0]!.state;
  return (
    <Playground
      initial={initial}
      stale={false}
      onRun={() => {}}
      onReset={() => {}}
      onTrace={() => {}}
      editingScenario={false}
      onScenarioChange={() => {}}
      {...props}
      index={index}
      onIndexChange={(i) => {
        setIndex(i);
        props.onIndexChange?.(i);
      }}
    />
  );
}

const status = () => screen.getByTestId('status').textContent;
const region = () => screen.getByRole('region', { name: 'Playground' });
const row = (container: HTMLElement, path: string) => {
  const el = container.querySelector<HTMLElement>(`[role="option"][data-path="${path}"]`);
  if (!el) throw new Error(`no row for ${path}`);
  return el;
};
const indexOf = (
  t: Timeline<SandboxFS>,
  pred: (s: Timeline<SandboxFS>['snapshots'][0]) => boolean,
) => t.snapshots.findIndex(pred);

describe('Playground renders every mock timeline', () => {
  it.each(Object.entries({ ...MOCK_TIMELINES, cleanup: cleanupTl }))(
    '%s: every snapshot renders with the right output count',
    (_name, t) => {
      const { rerender, container } = render(<Harness timeline={t} index={0} />);
      t.snapshots.forEach((s, i) => {
        rerender(<Playground {...baseProps(t)} index={i} />);
        expect(
          container.querySelectorAll('[data-kind="print"], [data-kind="action"]'),
        ).toHaveLength(s.output);
      });

    },
  );
});

it('uses APG keys in the file list without invoking timeline shortcuts', () => {
  const onTrace = vi.fn();
  const onIndexChange = vi.fn();
  render(<Harness timeline={sort} onTrace={onTrace} onIndexChange={onIndexChange} />);
  const list = screen.getByRole('listbox', { name: 'Files in Top folder' });
  const options = within(list).getAllByRole('option');
  options.at(-1)!.focus();
  fireEvent.keyDown(options.at(-1)!, { key: 'Home' });
  expect(document.activeElement).toBe(options[0]);
  fireEvent.keyDown(options[0]!, { key: 'End' });
  expect(document.activeElement).toBe(options.at(-1));
  fireEvent.keyDown(options.at(-1)!, { key: ' ' });
  expect(onTrace).toHaveBeenCalled();
  expect(onIndexChange).not.toHaveBeenCalled();
  expect(status()).toContain('Step 1 of');
});

function baseProps(t: Timeline<SandboxFS> | null): PlaygroundProps {
  return {
    initial: t?.snapshots[0]?.state ?? rename.snapshots[0]!.state,
    timeline: t,
    index: 0,
    onIndexChange: () => {},
    stale: false,
    onRun: () => {},
    onReset: () => {},
    onTrace: () => {},
    editingScenario: false,
    onScenarioChange: () => {},
  };
}

describe('no timeline', () => {
  it('shows the initial state and Run calls onRun', () => {
    const onRun = vi.fn();
    const { container } = render(<Harness timeline={null} onRun={onRun} />);
    expect(status()).toBe('Not run yet');
    expect(row(container, 'IMG_0001.JPG').textContent).toContain('2.4 MB');
    expect(row(container, 'IMG_0001.JPG').textContent).toContain('2025-10-02 00:00');
    expect(within(row(container, 'IMG_0001.JPG')).getByRole('img').getAttribute('aria-label')).toBe(
      'Image',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Step forward/ }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Step' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('starts playing once the requested timeline arrives', () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    const props = { ...baseProps(null), onIndexChange };
    const { rerender } = render(<Playground {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    rerender(<Playground {...props} timeline={rename} />);
    act(() => vi.advanceTimersByTime(250));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });
});

describe('controls', () => {
  it('exposes an accessible step-mode selector and reports its choice', () => {
    render(
      <Harness
        timeline={rename}
        stepStops={[0, 2, 4]}
      />,
    );
    const mode = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Step' });
    expect(mode.value).toBe('block');
    expect(within(mode).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'by block',
      'every detail',
    ]);
    fireEvent.change(mode, { target: { value: 'detail' } });
    expect(mode.value).toBe('detail');
  });

  it('step forward / back / scrubber / reset', () => {
    const onReset = vi.fn();
    const onIndexChange = vi.fn();
    render(<Harness timeline={rename} onReset={onReset} onIndexChange={onIndexChange} />);
    expect(status()).toBe(`Step 1 of ${String(rename.snapshots.length)}`);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Step back/ }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /Step forward/ }));
    fireEvent.click(screen.getByRole('button', { name: /Step forward/ }));
    expect(status()).toBe(`Step 3 of ${String(rename.snapshots.length)}`);
    fireEvent.click(screen.getByRole('button', { name: /Step back/ }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Step' });
    fireEvent.change(slider, { target: { value: '7' } });
    expect(onIndexChange).toHaveBeenLastCalledWith(7);
    expect(slider.getAttribute('aria-valuetext')).toBe(
      `Step 8 of ${String(rename.snapshots.length)}`,
    );
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('plays at ~4 steps/s at 1×, faster at 2×, and pauses', () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    render(<Harness timeline={rename} onIndexChange={onIndexChange} />);
    const options = within(screen.getByRole('combobox', { name: 'Speed' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['0.25×', '0.5×', '1×', '2×', '4×', '8×']);
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    act(() => vi.advanceTimersByTime(249));
    expect(onIndexChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '2' } });
    act(() => vi.advanceTimersByTime(125));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    act(() => vi.advanceTimersByTime(2000));
    expect(onIndexChange).toHaveBeenCalledTimes(2);
  });

  it('plays to the end and shows Done; Run at the end restarts', () => {
    vi.useFakeTimers();
    render(<Harness timeline={sort} />);
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    for (let i = 0; i < sort.snapshots.length + 2; i++) act(() => vi.advanceTimersByTime(250));
    expect(status()).toContain('Done');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pause/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    expect(status()).toBe(`Step 1 of ${String(sort.snapshots.length)}`);
  });

  it('announces steps politely', () => {
    const { container } = render(<Harness timeline={rename} index={7} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(
      `Step 8 of ${String(rename.snapshots.length)}: RENAME IMG_0001.JPG -> photo_001.JPG.`,
    );
  });

  it('does not announce each automatic playback step', () => {
    vi.useFakeTimers();
    render(<Harness timeline={rename} />);
    const live = screen.getByRole('region', { name: 'Playground' }).querySelector(
      '[aria-live="polite"]',
    )!;
    const initial = live.textContent;
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    act(() => vi.advanceTimersByTime(250));
    expect(live.textContent).toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    expect(live.textContent).toContain('Step 2 of');
  });
});

describe('keyboard shortcuts', () => {
  it('←/→ step, Space toggles play, Home resets — only inside the region', () => {
    vi.useFakeTimers();
    const onReset = vi.fn();
    const onIndexChange = vi.fn();
    render(<Harness timeline={rename} onReset={onReset} onIndexChange={onIndexChange} />);
    fireEvent.keyDown(region(), { key: 'ArrowRight' });
    fireEvent.keyDown(region(), { key: 'ArrowRight' });
    fireEvent.keyDown(region(), { key: 'ArrowLeft' });
    expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual([1, 2, 1]);
    fireEvent.keyDown(region(), { key: 'Home' });
    expect(onReset).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(region(), { key: ' ' });
    act(() => vi.advanceTimersByTime(250));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(region(), { key: ' ' });
    act(() => vi.advanceTimersByTime(1000));
    expect(onIndexChange).toHaveBeenCalledTimes(4);
    // Outside the region: nothing.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onIndexChange).toHaveBeenCalledTimes(4);
  });

  it('is ignored while typing in a form field, with modifiers, and Space on buttons', () => {
    const onIndexChange = vi.fn();
    render(<Harness timeline={rename} onIndexChange={onIndexChange} />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Speed' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Step' }), { key: 'ArrowRight' });
    fireEvent.keyDown(region(), { key: 'ArrowRight', ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('button', { name: /Reset/ }), { key: ' ' });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(status()).toBe(`Step 1 of ${String(rename.snapshots.length)}`);
  });
});

describe('error banner, stale overlay', () => {
  it('shows the error message and the block id', () => {
    const onShowBlock = vi.fn();
    render(<Harness timeline={error} index={1} onShowBlock={onShowBlock} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('"y.txt" already exists');
    expect(alert.textContent).toContain('at block rn');
    fireEvent.click(screen.getByRole('button', { name: 'Show block' }));
    expect(onShowBlock).toHaveBeenCalledWith('rn');
    expect(status()).toBe('Stopped with an error');
  });

  it('stale: overlay text and Run asks for a new run', () => {
    const onRun = vi.fn();
    render(<Harness timeline={rename} index={3} stale onRun={onRun} />);
    expect(screen.getByText('Program changed — run again')).toBeTruthy();
    const staleId = screen.getByText('Program changed — run again').id;
    const list = screen.getByRole('listbox');
    expect(list.parentElement?.parentElement?.getAttribute('aria-describedby')).toContain(staleId);
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe('diff labels are text, not just color', () => {
  it('renamed shows the old name', () => {
    const i = indexOf(rename, (s) => s.action?.op === 'RENAME');
    const { container } = render(<Harness timeline={rename} index={i} />);
    expect(row(container, 'photo_001.JPG').textContent).toContain('renamed, was IMG_0001.JPG');
  });

  it('created folder and moved file (auto-selects the destination folder)', () => {
    const mk = indexOf(sort, (s) => s.action?.op === 'MKDIR');
    const r1 = render(<Harness timeline={sort} index={mk} />);
    expect(row(r1.container, 'Documents').textContent).toContain('new');
    r1.unmount();
    const mv = indexOf(sort, (s) => s.action?.op === 'MOVE');
    const { container } = render(<Harness timeline={sort} index={mv} />);
    expect(screen.getByRole('region', { name: 'Files in ./Documents' })).toBeTruthy();
    expect(row(container, 'Documents/report.pdf').textContent).toContain(
      'moved, from ./report.pdf',
    );
    const tree = screen.getByRole('tree');
    const docs = within(tree).getByText('Documents').closest('[role="treeitem"]');
    expect(docs?.getAttribute('aria-selected')).toBe('true');
  });

  it('deleted ghost (struck through, from the previous state) and changed', () => {
    const del = indexOf(cleanupTl, (s) => s.action?.op === 'DELETE');
    const r1 = render(<Harness timeline={cleanupTl} index={del} />);
    const ghost = row(r1.container, 'old.tmp');
    expect(ghost.textContent).toContain('deleted');
    expect(ghost.textContent).toContain('10 B');
    // Only for that step.
    fireEvent.click(screen.getByRole('button', { name: /Step forward/ }));
    expect(r1.container.querySelector('[data-path="old.tmp"]')).toBeNull();
    expect(row(r1.container, 'notes.txt').textContent).toContain('changed');
  });
});

describe('tags, gutter, panels', () => {
  it('index tags, 0-based gutter and the end row', () => {
    const i = indexOf(bisect, (s) => s.nodeId === 'bis1/high');
    const { container } = render(<Harness timeline={bisect} index={i} />);
    const list = screen.getByRole('listbox', { name: /List items \(8 items/ });
    const opts = within(list).getAllByRole('option');
    expect(opts).toHaveLength(9);
    expect(opts[0]!.textContent).toMatch(/^position 0/);
    expect(opts[0]!.querySelector('[data-tag="low"]')).not.toBeNull();
    const end = screen.getByTestId('end-row');
    expect(end.textContent).toContain('end = 8');
    expect(end.querySelector('[data-tag="high"]')).not.toBeNull();
    expect(screen.getByText('List size')).toBeTruthy();
    expect(container.querySelector('[data-var="high"]')?.textContent).toContain('(end of items)');
    // Toggle back to the folder view.
    fireEvent.click(screen.getByRole('button', { name: 'Show folder' }));
    expect(screen.getByRole('listbox', { name: 'Files in Top folder' })).toBeTruthy();
    expect(screen.queryByText('List size')).toBeNull();
  });

  it('path tags and "(missing)" in the variables panel', () => {
    const loop = indexOf(rename, (s) => s.nodeId === 'ren1/loop');
    const r1 = render(<Harness timeline={rename} index={loop} />);
    expect(row(r1.container, 'IMG_0001.JPG').querySelector('[data-tag="item"]')).not.toBeNull();
    r1.unmount();
    const i = indexOf(rename, (s) => s.action?.op === 'RENAME');
    const { container } = render(<Harness timeline={rename} index={i} />);
    const item = container.querySelector('[data-var="item"]')!;
    expect(item.textContent).toContain('./IMG_0001.JPG');
    expect(item.textContent).toContain('(missing)');
    expect(container.querySelector('[data-var="new_name"]')?.textContent).toContain(
      '"photo_001.JPG"',
    );
  });

  it('variables: Python-style numbers and function scope; counters; output kinds', () => {
    const call = indexOf(cleanupTl, (s) => s.event === 'call');
    const { container } = render(<Harness timeline={cleanupTl} index={call} />);
    expect(container.querySelector('[data-var="total"]')?.textContent).toContain('5.0');
    expect(container.querySelector('[data-var="total"]')?.textContent).toContain('(in report)');
    expect(container.querySelector('[data-var="big"]')?.textContent).toContain('False');
    const counters = screen.getByRole('heading', { name: 'Counters' }).parentElement!;
    expect(counters.textContent).toContain('File changes5');
    const actions = container.querySelectorAll('[data-kind="action"]');
    expect(actions[0]!.textContent).toContain('action');
    expect(actions[0]!.textContent).toContain('RENAME Old -> Archive');
    fireEvent.click(screen.getByRole('button', { name: /Step forward/ }));
    const print = container.querySelector('[data-kind="print"]');
    expect(print?.textContent).toContain('print');
    expect(print?.textContent).toContain('cleaned up');
  });
});

describe('click-to-trace', () => {
  it('click and Enter emit the node ids that touched the item (following renames)', () => {
    const onTrace = vi.fn();
    const last = rename.snapshots.length - 1;
    const { container } = render(<Harness timeline={rename} index={last} onTrace={onTrace} />);
    expect(status()).toContain('Done');
    fireEvent.click(row(container, 'photo_001.JPG'));
    expect(onTrace).toHaveBeenLastCalledWith(['ren1/match', 'ren1/rename']);
    fireEvent.keyDown(row(container, 'notes.txt'), { key: 'Enter' });
    expect(onTrace).toHaveBeenLastCalledWith(['ren1/match']);
    expect(onTrace).toHaveBeenCalledTimes(2);
  });

  it('arrow keys move through the file list', () => {
    const { container } = render(<Harness timeline={rename} />);
    const first = row(container, 'IMG_0001.JPG');
    expect(first.tabIndex).toBe(0);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row(container, 'IMG_0002.JPG'));
    expect(row(container, 'IMG_0002.JPG').tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    // The list handled ↓, so the region did not step.
    expect(status()).toBe(`Step 1 of ${String(rename.snapshots.length)}`);
  });

  it('ArrowRight opens a folder row', () => {
    const mkdir = indexOf(sort, (s) => s.action?.op === 'MKDIR');
    const { container } = render(<Harness timeline={sort} index={mkdir} />);
    const folder = row(container, 'Documents');
    folder.focus();
    fireEvent.keyDown(folder, { key: 'ArrowRight' });
    expect(screen.getByRole('region', { name: 'Files in ./Documents' })).toBeTruthy();
  });
});

describe('folder tree keyboard', () => {
  it('↓ moves, Enter selects, ← collapses, → expands', () => {
    const last = sort.snapshots.length - 1;
    render(<Harness timeline={sort} index={last} />);
    const tree = screen.getByRole('tree', { name: 'Folders' });
    const items = () => within(tree).getAllByRole('treeitem');
    expect(items().map((i) => i.textContent)).toEqual([
      expect.stringContaining('Top folder'),
      expect.stringContaining('Audio'),
      expect.stringMatching(/Documents.*target/),
    ]);
    const top = items()[0]!;
    top.focus();
    fireEvent.keyDown(top, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(items()[1]!, { key: 'Enter' });
    expect(screen.getByRole('listbox', { name: 'Files in ./Audio' })).toBeTruthy();
    fireEvent.keyDown(items()[1]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0]!, { key: 'ArrowLeft' });
    expect(items()).toHaveLength(1);
    expect(items()[0]!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(items()[0]!, { key: 'ArrowRight' });
    expect(items()).toHaveLength(3);
    // Tree arrows don't step the timeline.
    expect(status()).toContain('Done');
  });
});

describe('scenario editor', () => {
  function Editor({ onChange }: { onChange: (fs: SandboxFS) => void }) {
    const [fs, setFs] = useState(rename.snapshots[0]!.state);
    return (
      <Playground
        {...baseProps(rename)}
        initial={fs}
        editingScenario
        onScenarioChange={(next) => {
          setFs(next);
          onChange(next);
        }}
      />
    );
  }

  it('add validates names and emits a sorted immutable tree', () => {
    const onChange = vi.fn<(fs: SandboxFS) => void>();
    const before = JSON.stringify(rename.snapshots[0]!.state);
    render(<Editor onChange={onChange} />);
    expect(status()).toBe('Editing the scenario');
    const add = screen.getByRole('form', { name: 'Add to Top folder' });
    const name = within(add).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'a?b' } });
    expect(within(add).getByRole('alert').textContent).toContain('not allowed');
    fireEvent.change(name, { target: { value: 'NOTES.TXT' } });
    expect(within(add).getByRole('alert').textContent).toContain('"notes.txt" already exists');
    fireEvent.submit(add);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'Album' } });
    fireEvent.change(within(add).getByRole('combobox', { name: 'Kind' }), {
      target: { value: 'folder' },
    });
    fireEvent.submit(add);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0];
    expect(next.root.children.map((c) => c.name)).toEqual([
      'Album',
      'IMG_0001.JPG',
      'IMG_0002.JPG',
      'notes.txt',
    ]);
    expect(getNode(next, 'Album')?.type).toBe('folder');
    expect(JSON.stringify(rename.snapshots[0]!.state)).toBe(before);
  });

  it('rename, edit size / content / date, delete', () => {
    const onChange = vi.fn<(fs: SandboxFS) => void>();
    const { container } = render(<Editor onChange={onChange} />);
    fireEvent.click(row(container, 'IMG_0001.JPG'));
    const edit = screen.getByRole('region', { name: 'Edit File IMG_0001.JPG' });
    fireEvent.change(within(edit).getByRole('spinbutton', { name: 'Size in bytes' }), {
      target: { value: '-3' },
    });
    expect(within(edit).getByRole('alert').textContent).toContain('0 or more');
    fireEvent.change(within(edit).getByRole('spinbutton', { name: 'Size in bytes' }), {
      target: { value: '2048' },
    });
    expect(getNode(onChange.mock.lastCall![0], 'IMG_0001.JPG')).toMatchObject({ binarySize: 2048 });
    fireEvent.change(within(edit).getByLabelText('Modified (UTC)'), {
      target: { value: '2024-01-02T03:04' },
    });
    expect(getNode(onChange.mock.lastCall![0], 'IMG_0001.JPG')?.modified).toBe(
      Date.UTC(2024, 0, 2, 3, 4) / 1000,
    );
    const nameBox = within(edit).getByRole('textbox', { name: 'Name' });
    fireEvent.change(nameBox, { target: { value: 'img_0002.jpg' } });
    expect(within(edit).getByRole('alert').textContent).toContain('already exists');
    fireEvent.change(nameBox, { target: { value: 'zebra.JPG' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Rename' }));
    expect(onChange.mock.lastCall![0].root.children.map((c) => c.name)).toEqual([
      'IMG_0002.JPG',
      'notes.txt',
      'zebra.JPG',
    ]);

    fireEvent.click(row(container, 'notes.txt'));
    const notes = screen.getByRole('region', { name: 'Edit File notes.txt' });
    fireEvent.change(within(notes).getByRole('textbox', { name: 'Text content' }), {
      target: { value: 'new text' },
    });
    expect(getNode(onChange.mock.lastCall![0], 'notes.txt')).toMatchObject({ content: 'new text' });
    fireEvent.click(within(notes).getByRole('button', { name: 'Delete notes.txt' }));
    expect(getNode(onChange.mock.lastCall![0], 'notes.txt')).toBeUndefined();
  });

  it('deletes folders recursively', () => {
    const onChange = vi.fn<(fs: SandboxFS) => void>();
    const fs = cleanupTl.snapshots[0]!.state;
    function E() {
      const [s, setS] = useState(fs);
      return (
        <Playground
          {...baseProps(null)}
          initial={s}
          editingScenario
          onScenarioChange={(n) => {
            setS(n);
            onChange(n);
          }}
        />
      );
    }
    const { container } = render(<E />);
    fireEvent.click(row(container, 'Old'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Old and everything inside' }));
    expect(getNode(onChange.mock.lastCall![0], 'Old')).toBeUndefined();
    expect(getNode(onChange.mock.lastCall![0], 'notes.txt')).toBeDefined();
  });
});
