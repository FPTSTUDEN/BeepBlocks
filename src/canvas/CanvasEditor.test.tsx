// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { b } from '../ir/build.ts';
import { CanvasEditor } from './CanvasEditor.tsx';
import { CanvasToolbar } from './CanvasToolbar.tsx';

const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

afterEach(() => {
  cleanup();
});

afterAll(() => {
  if (originalResizeObserver) {
    Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver);
  } else {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

describe('CanvasToolbar', () => {
  it('exposes and invokes canvas actions and toggles', () => {
    const actions = {
      relayout: vi.fn(),
      fit: vi.fn(),
      reset: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      minimap: vi.fn(),
      dataFlow: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    };
    render(
      <CanvasToolbar
        onReLayout={actions.relayout}
        onFit={actions.fit}
        onZoomReset={actions.reset}
        onZoomIn={actions.zoomIn}
        onZoomOut={actions.zoomOut}
        showMinimap={false}
        showDataFlow={true}
        onToggleMinimap={actions.minimap}
        onToggleDataFlow={actions.dataFlow}
        onUndo={actions.undo}
        onRedo={actions.redo}
        canUndo
        canRedo
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Minimap' }));
    fireEvent.click(screen.getByRole('button', { name: '~ Data flow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

    expect(actions.relayout).toHaveBeenCalledOnce();
    expect(actions.fit).toHaveBeenCalledOnce();
    expect(actions.reset).toHaveBeenCalledOnce();
    expect(actions.zoomIn).toHaveBeenCalledOnce();
    expect(actions.zoomOut).toHaveBeenCalledOnce();
    expect(actions.minimap).toHaveBeenCalledOnce();
    expect(actions.dataFlow).toHaveBeenCalledOnce();
    expect(actions.undo).toHaveBeenCalledOnce();
    expect(actions.redo).toHaveBeenCalledOnce();
  });
});

describe('CanvasEditor', () => {
  it('renders the projected graph and toggles minimap and data-edge visibility', async () => {
    const program = b.program([
      b.assign('keepGoing', b.lit(true)),
      b.while(b.v('keepGoing'), [b.print(b.lit('step'))]),
      b.assign('done', b.lit(true)),
    ]);
    render(<CanvasEditor program={program} />);

    const root = screen.getByRole('application', { name: 'Flow canvas' });
    expect(root.querySelector('.react-flow__node[data-id="term-start"]')).toBeTruthy();
    expect(root.querySelector('.react-flow__node[data-id="stmt-program.1"]')).toBeTruthy();
    expect(root.classList.contains('hide-data-edges')).toBe(false);
    expect(root.querySelector('style')?.textContent).toContain('.hide-data-edges .data-edge { display: none; }');

    fireEvent.click(screen.getByRole('button', { name: '~ Data flow' }));
    expect(root.classList.contains('hide-data-edges')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Minimap' }));
    await waitFor(() => expect(root.querySelector('.react-flow__minimap')).toBeTruthy());
  });

  it('collapses loop body nodes and their edges on double click', async () => {
    const program = b.program([
      b.assign('keepGoing', b.lit(true)),
      b.while(b.v('keepGoing'), [b.print(b.lit('step'))]),
      b.assign('done', b.lit(true)),
    ]);
    render(<CanvasEditor program={program} />);

    const root = screen.getByRole('application', { name: 'Flow canvas' });
    const bodyNode = root.querySelector('.react-flow__node[data-id="stmt-program.1.body.0"]');
    const loopNode = root.querySelector('.react-flow__node[data-id="stmt-program.1"] .loop-node');
    expect(bodyNode).toBeTruthy();
    expect(loopNode).toBeTruthy();

    fireEvent.doubleClick(loopNode!);
    await waitFor(() => {
      expect(root.querySelector('.react-flow__node[data-id="stmt-program.1.body.0"]')).toBeNull();
    });
  });
});
