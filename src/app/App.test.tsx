// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import { desugarOne, desugarProgram } from '../composites/index.ts';
import { simulateSync } from '../sim/index.ts';
import { App } from './App.tsx';
import { createAppStore, type AppStore } from './store.ts';
import { newProject, PROJECT_KEY } from './project.ts';
import { STARTERS } from './starters.ts';

afterEach(cleanup);

beforeAll(() => {
  // jsdom lacks the modal dialog API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function renderApp(program = b.program([b.print(b.lit('hello'), 'p1')])): AppStore {
  const project = { ...newProject(), title: 'Demo project', program };
  const store = createAppStore({
    simulate: (p, fs, o) => Promise.resolve(simulateSync(p, fs, o)),
    desugarProgram,
    desugarOne,
    storage: memoryStorage({ [PROJECT_KEY]: JSON.stringify(project) }),
  });
  render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
  return store;
}

describe('App shell', () => {
  it('wires editor, playground and run', async () => {
    const store = renderApp();
    expect(screen.getByRole('region', { name: 'Block editor' })).toBeTruthy();
    expect(screen.getByRole('region', { name: /^Playground/ })).toBeTruthy();
    const run = screen.getByRole('button', { name: /Run/ });
    await act(async () => {
      fireEvent.click(run);
      await Promise.resolve();
    });
    await waitFor(() => expect(store.getState().timeline?.outcome).toBe('done'));
    expect(store.getState().runProblem).toBeNull();
  });

  it('applies the theme variables to the document', () => {
    const store = renderApp();
    expect(document.documentElement.style.getPropertyValue('--bp-bg')).toBe('#ffffff');
    act(() => store.getState().setSettings({ mode: 'dark' }));
    expect(document.documentElement.style.getPropertyValue('--bp-bg')).toBe('#111827');
    expect(document.documentElement.dataset.bpMode).toBe('dark');
  });

  it('opens the export dialog with the generated script', async () => {
    renderApp();
    // Wait for the editor's first validation pass so Export is enabled.
    const exportBtn = screen.getByRole('button', { name: 'Export Python' });
    fireEvent.click(exportBtn);
    const dialog = await screen.findByRole('dialog', { name: 'Export to Python' });
    const script = within(dialog).getByLabelText('Python script');
    expect(script.textContent).toContain('hello');
    expect(script.textContent).toContain('--apply');
    expect(within(dialog).getByRole('button', { name: /Download demo_project\.py/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks Run and Export with an explanation while the program has problems', async () => {
    renderApp(b.program([b.print(b.v('missing', 'v'), 'p1')]));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Run/ }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect((screen.getByRole('button', { name: 'Export Python' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/problem.* to fix before running/)).toBeTruthy();
    expect(screen.getByText('Fix the problems marked in the editor to run.')).toBeTruthy();
  });

  it('opens a starter project from the New dialog in one click', async () => {
    const store = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'New…' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    const open = within(dialog).getAllByRole('button', { name: /^Open example/ });
    expect(open).toHaveLength(STARTERS.length);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open example “Find the first failing night”' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const { project } = store.getState();
    expect(project.title).toBe('Find the first failing night');
    expect(project.scenario.id).toBe('nightly-logs');
    expect(project.program.body[0]).toMatchObject({ kind: 'composite', name: 'findFirst' });
  });

  it('starts a blank project on the current scenario', async () => {
    const store = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'New…' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Blank project/ }));
    expect(store.getState().project.program.body).toEqual([]);
    expect(store.getState().project.title).toBe('Untitled project');
  });
});

describe('App shell keyboard access', () => {
  it('offers skip links to both panes', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Skip links' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#bp-editor-pane', '#bp-playground-pane']);
    for (const a of links) {
      const target = document.querySelector(a.getAttribute('href')!) as HTMLElement | null;
      expect(target?.tabIndex).toBe(-1);
    }
  });

  it('closes the settings popover with Escape and returns focus to its button', () => {
    renderApp();
    const summary = screen.getByText('Settings');
    const details = summary.closest('details')!;
    details.open = true;
    const dark = screen.getByRole('radio', { name: 'Dark' });
    dark.focus();
    fireEvent.keyDown(dark, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('keeps focus in the settings panel after Reset disables itself', () => {
    const store = renderApp();
    act(() => store.getState().setSettings({ accent: '#ff0000' }));
    const details = screen.getByText('Settings').closest('details')!;
    details.open = true;
    const reset = within(details).getByRole('button', { name: 'Reset' });
    reset.focus();
    fireEvent.click(reset);
    expect(store.getState().settings.accent).toBe('#2563eb');
    expect(document.activeElement).toBe(screen.getByLabelText('Accent colour'));
  });

  it('labels the scenario editing toggle by its action only', () => {
    renderApp();
    const btn = screen.getByRole('button', { name: 'Edit scenario' });
    expect(btn.getAttribute('aria-pressed')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Done editing' })).toBeTruthy();
  });
});
