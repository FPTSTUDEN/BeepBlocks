// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { ConditionNode } from './ConditionNode.tsx';
import { FrameNode } from './FrameNode.tsx';
import { LoopNode } from './LoopNode.tsx';
import { MergeNode } from './MergeNode.tsx';
import { SequenceNode } from './SequenceNode.tsx';
import { SwitchNode } from './SwitchNode.tsx';
import { TerminalNode } from './TerminalNode.tsx';
import type { CanvasNodeRenderData, CanvasNodeRenderProps } from './shared.ts';

function renderNode(
  NodeRenderer: ComponentType<CanvasNodeRenderProps>,
  id: string,
  data: CanvasNodeRenderData,
) {
  const props = {
    id,
    data,
    selected: false,
    isConnectable: true,
    type: 'custom',
    dragging: false,
    zIndex: 1,
    xPos: 0,
    yPos: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  } as CanvasNodeRenderProps;

  return render(
    <ReactFlowProvider>
      <NodeRenderer {...props} />
    </ReactFlowProvider>,
  );
}

function expectHandleIds(container: HTMLElement, ids: string[]) {
  const actual = Array.from(container.querySelectorAll<HTMLElement>('.react-flow__handle'))
    .map((handle) => handle.dataset.handleid);
  for (const id of ids) expect(actual).toContain(id);
}

describe('canvas node renderers', () => {
  it('renders sequence labels and bind names with execution handles', () => {
    const { container } = renderNode(SequenceNode, 'assign-1', {
      label: 'Assign score',
      binds: ['score'],
      category: 'math',
    });

    const node = screen.getByRole('group', { name: 'Assign score' });
    expect(within(node).getByText('score')).toBeTruthy();
    expect(node.className).toContain('sequence-node--math');
    expectHandleIds(container, ['in', 'out']);
  });

  it('renders condition and switch branch handles accessibly', () => {
    const condition = renderNode(ConditionNode, 'condition-1', { label: 'is ready' });
    expect(screen.getByRole('group', { name: 'Condition: is ready' })).toBeTruthy();
    expectHandleIds(condition.container, ['in', 'true', 'false']);

    condition.unmount();
    const switched = renderNode(SwitchNode, 'switch-1', {
      label: 'choose mode',
      branches: ['fast', 'safe', 'default'],
    });
    expect(screen.getByRole('group', { name: 'Condition: choose mode' })).toBeTruthy();
    expect(screen.getByText('fast')).toBeTruthy();
    expectHandleIds(switched.container, ['in', 'false', 'branch-0', 'branch-1', 'branch-2']);
  });

  it('toggles loop collapse and renders its loop handles', () => {
    const { container } = renderNode(LoopNode, 'loop-1', { label: 'while ready', bodyCount: 3 });
    const node = screen.getByRole('group', { name: 'Loop: while ready' });

    expect(node.getAttribute('aria-expanded')).toBe('true');
    fireEvent.doubleClick(node);
    expect(node.getAttribute('aria-expanded')).toBe('false');
    expect(within(node).getByText('⟳ 3 steps inside')).toBeTruthy();
    expectHandleIds(container, ['in', 'body', 'done', 'back-in']);
  });

  it('renders recursive frames, terminals, and dynamically sized merge handles', () => {
    const frame = renderNode(FrameNode, 'frame-recursive', { label: 'repeat', recursive: true });
    expect(screen.getByRole('group', { name: 'Function: repeat (frame-recursive)' })).toBeTruthy();
    expect(screen.getByText('(calls itself)')).toBeTruthy();

    frame.unmount();
    const terminal = renderNode(TerminalNode, 'return-1', { label: 'Return' });
    expect(screen.getByRole('group', { name: 'Return' })).toBeTruthy();
    expectHandleIds(terminal.container, ['in', 'out']);

    terminal.unmount();
    const merge = renderNode(MergeNode, 'merge-1', { inputCount: 3 });
    expect(screen.getByRole('group', { name: 'Merge point (merge-1)' })).toBeTruthy();
    expectHandleIds(merge.container, ['in-0', 'in-1', 'in-2', 'out']);
  });
});
