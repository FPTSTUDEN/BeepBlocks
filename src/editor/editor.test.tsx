// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Blockly from 'blockly/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { b } from '../ir/build.ts';
import type { DesugarOne } from '../ir/composites.ts';
import type { ValidationError } from '../ir/errors.ts';
import type { Program } from '../ir/types.ts';
import { BlockEditor, RUN_BLOCK_ID, type BlockEditorProps, type Layout } from './index.tsx';
import { kitchenSink } from './__testing__/samples.ts';

afterEach(cleanup);

type OnChange = BlockEditorProps['onChange'];

function sample(): Program {
  return b.program([
    b.assign('x', b.lit(1, 'one'), 'a1'),
    b.assign('x', b.lit('oops', 'txt'), 'a2'),
    b.composite(
      'sortByType',
      { fields: { grouping: 'category' }, inputs: { folder: b.root('r') } },
      'c',
    ),
    b.print(b.lit('hi', 'hi'), 'p'),
  ]);
}

const fakeDesugar: DesugarOne = (_p, id) => [
  b.print(b.lit('expanded', `${id}/msg`), `${id}/print`),
];

function setup(overrides: Partial<BlockEditorProps> = {}, strict = true) {
  let ws: Blockly.WorkspaceSvg | null = null;
  const onChange = vi.fn<OnChange>();
  const props: BlockEditorProps = {
    program: sample(),
    layout: {},
    onChange,
    desugarOne: fakeDesugar,
    onWorkspace: (w) => {
      if (w) ws = w;
    },
    ...overrides,
  };
  const view = render(
    strict ? (
      <StrictMode>
        <BlockEditor {...props} />
      </StrictMode>
    ) : (
      <BlockEditor {...props} />
    ),
  );
  const rerender = (next: Partial<BlockEditorProps>) =>
    view.rerender(
      <StrictMode>
        <BlockEditor {...props} {...next} />
      </StrictMode>,
    );
  return { onChange, view, rerender, props, getWs: () => ws! };
}

const hasWarning = (ws: Blockly.WorkspaceSvg, id: string) =>
  ws.getBlockById(id)?.getIcon(Blockly.icons.IconType.WARNING) !== undefined;

describe('<BlockEditor>', () => {
  test('renders an accessible region and loads the program with the same ids', async () => {
    const { onChange, getWs } = setup();
    expect(screen.getByRole('region', { name: 'Block editor' })).toBeTruthy();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [program, layout, issues] = onChange.mock.calls.at(-1)!;
    expect(program).toEqual(sample());
    expect(layout[RUN_BLOCK_ID]).toBeDefined();
    const ws = getWs();
    for (const id of ['a1', 'one', 'a2', 'txt', 'c', 'r', 'p', 'hi'])
      expect(ws.getBlockById(id)).not.toBeNull();
    // Live validation: the retyped variable is an error on a2, shown as a warning icon.
    expect(issues).toContainEqual(
      expect.objectContaining({ nodeId: 'a2', code: 'VARIABLE_RETYPED' }),
    );
    expect(hasWarning(ws, 'a2')).toBe(true);
    expect(hasWarning(ws, 'a1')).toBe(false);
  });

  test('edits are debounced, regenerate the IR, and do not trigger a reload loop', async () => {
    const { onChange, getWs, rerender } = setup();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const ws = getWs();
    const before = onChange.mock.calls.length;
    ws.getBlockById('hi')!.setFieldValue('changed', 'TEXT');
    ws.getBlockById('txt')!.setFieldValue('changed again', 'TEXT');
    await new Promise((r) => setTimeout(r, 120));
    expect(onChange.mock.calls.length).toBe(before);
    await waitFor(() => expect(onChange.mock.calls.length).toBe(before + 1), { timeout: 2000 });
    const emitted = onChange.mock.calls.at(-1)![0];
    expect(JSON.stringify(emitted)).toContain('changed again');
    // Feeding the emitted program back in must not rebuild the workspace.
    const blockBefore = ws.getBlockById('hi');
    rerender({ program: emitted });
    expect(ws.getBlockById('hi')).toBe(blockBefore);
    // An equal-but-new object from outside is not a reload either.
    rerender({ program: structuredClone(emitted) });
    expect(ws.getBlockById('hi')).toBe(blockBefore);
  });

  test('reloads when the program changes from outside', async () => {
    const { onChange, getWs, rerender } = setup();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = b.program([b.print(b.lit('new', 'new-lit'), 'new-print')]);
    const layout: Layout = { [RUN_BLOCK_ID]: { x: 40, y: 50 } };
    rerender({ program: next, layout });
    const ws = getWs();
    expect(ws.getBlockById('new-print')).not.toBeNull();
    expect(ws.getBlockById('a1')).toBeNull();
    await waitFor(() => expect(onChange.mock.calls.at(-1)![0]).toEqual(next));
    expect(onChange.mock.calls.at(-1)![1][RUN_BLOCK_ID]).toEqual({ x: 40, y: 50 });
  });

  test('highlights and marks blocks (derived ids resolve to the composite)', async () => {
    const { onChange, getWs, rerender } = setup({ highlightIds: ['c/loop/3'], markedIds: ['p'] });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const ws = getWs();
    const cls = (id: string) => ws.getBlockById(id)!.getSvgRoot().classList;
    expect(cls('c').contains('bp-running')).toBe(true);
    expect(cls('p').contains('bp-marked')).toBe(true);
    rerender({ highlightIds: ['a1'], markedIds: [] });
    expect(cls('c').contains('bp-running')).toBe(false);
    expect(cls('a1').contains('bp-running')).toBe(true);
    expect(cls('p').contains('bp-marked')).toBe(false);
  });

  test('readOnly makes the workspace read-only', async () => {
    const { onChange, getWs, rerender } = setup({ readOnly: true });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getWs().isReadOnly()).toBe(true);
    rerender({ readOnly: false });
    expect(getWs().isReadOnly()).toBe(false);
  });

  test('Expand context-menu item replaces a composite; Undo button restores it', async () => {
    const { onChange, getWs } = setup();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const ws = getWs();
    const item = Blockly.ContextMenuRegistry.registry.getItem('bp_expand_composite');
    expect(item).not.toBeNull();
    if (!item || item.separator) return;
    const composite = ws.getBlockById('c')!;
    const event = new Event('contextmenu');
    expect(item.preconditionFn({ block: composite }, event)).toBe('enabled');
    expect(item.preconditionFn({ block: ws.getBlockById('p')! }, event)).toBe('hidden');
    act(() =>
      item.callback({ block: composite }, event, event, new Blockly.utils.Coordinate(0, 0)),
    );
    expect(ws.getBlockById('c')).toBeNull();
    expect(ws.getBlockById('c/print')).not.toBeNull();
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)![0].body.map((s) => s.id)).toEqual([
        'a1',
        'a2',
        'c/print',
        'p',
      ]),
    );
    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(undo);
    await waitFor(() => expect(ws.getBlockById('c')).not.toBeNull());
    await waitFor(() => expect(onChange.mock.calls.at(-1)![0]).toEqual(sample()));
  });

  test('keyboard navigation is enabled and the workspace is disposed on unmount', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { onChange, getWs, view } = setup();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(warn).not.toHaveBeenCalledWith(
      'Block editor: keyboard navigation unavailable',
      expect.anything(),
    );
    const shortcuts = Object.keys(Blockly.ShortcutRegistry.registry.getRegistry());
    expect(shortcuts.length).toBeGreaterThan(10);
    const host = screen.getByTestId('bp-editor-workspace');
    expect(host.querySelector('.injectionDiv')).not.toBeNull();
    const ws = getWs();
    view.unmount();
    expect(host.querySelector('.injectionDiv')).toBeNull();
    expect(ws.getTopBlocks(false).length).toBe(0);
    warn.mockRestore();
  });

  // Rendering ~330 blocks is slow under jsdom (Blockly's own serialization takes as long).
  test(
    'renders the kitchen-sink program (every block type) in a real workspace',
    { timeout: 90_000 },
    async () => {
      const p = kitchenSink();
      const { onChange } = setup({ program: p }, false);
      await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 60_000 });
      const [program, , issues] = onChange.mock.calls.at(-1)! as [
        Program,
        Layout,
        ValidationError[],
      ];
      expect(program).toEqual(p);
      expect(issues.filter((i) => i.code === 'STRUCTURE')).toEqual([]);
    },
  );
});
