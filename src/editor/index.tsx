/**
 * Block editor public API — Workstream D (design.md §9).
 *
 * `<BlockEditor>` injects Blockly into a div (StrictMode-safe: each mount injects, each unmount
 * disposes), loads `program`/`layout` on mount and whenever `program` changes from outside, and
 * reports every edit through `onChange` after a 300 ms debounce. `onChange` is also called once
 * after each (re)load so the app always has the current validation issues; the program passed
 * then is the regenerated IR (deep-equal to the prop for any representable program).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { KeyboardNavigation } from '@blockly/keyboard-navigation';
import type { NodeId, Program } from '../ir/types.ts';
import type { DesugarFully, DesugarOne } from '../ir/composites.ts';
import type { ValidationError } from '../ir/errors.ts';
import { resolveToExisting } from '../ir/ids.ts';
import type { Layout } from './layout.ts';
import { registerBlocks } from './blocks/index.ts';
import { irToWs } from './convert/irToWs.ts';
import { wsToIr } from './convert/wsToIr.ts';
import { expandComposite, setExpandHandler, setFullExpandHandler, setOneDesugarHandler } from './expand.ts';
import { attachSync } from './sync.ts';
import { buildBlocklyTheme, ensureEditorCss, readThemeVars, rebuildTheme } from './theme.ts';
import { buildToolbox, registerDynamicCategories } from './toolbox.ts';
import { LiveValidator, type ValidationResult } from './validation.ts';

export type { Layout } from './layout.ts';
export { RUN_BLOCK_ID } from './blocks/common.ts';
export { irToWs } from './convert/irToWs.ts';
export { wsToIr } from './convert/wsToIr.ts';
export { expandComposite } from './expand.ts';
export { rebuildTheme } from './theme.ts';

export interface BlockEditorProps {
  program: Program;
  layout: Layout;
  /** Called after every workspace change with the regenerated IR, layout and validation result. */
  onChange: (program: Program, layout: Layout, issues: ValidationError[]) => void;
  /** Injected by app/ for the Expand action. */
  desugarOne: DesugarOne;
  desugarFully?: DesugarFully;
  /** Whether loop/variable/list/text/math/function primitives are shown in the flyout. */
  showAdvanced?: boolean;
  /** Currently executing block(s) — already resolved to existing block ids. */
  highlightIds?: readonly NodeId[];
  /** Blocks to mark (e.g. click-to-trace results). */
  markedIds?: readonly NodeId[];
  readOnly?: boolean;
  /**
   * Change this value (e.g. a counter) after the app's CSS theme variables change to rebuild
   * the Blockly theme from them.
   */
  themeKey?: string | number;
  /** Accessible name of the editor region. */
  label?: string;
  /** Receives the workspace after injection (null on unmount); for app-level integration. */
  onWorkspace?: (ws: Blockly.WorkspaceSvg | null) => void;
}

// --------------------------------------------------------- one-time setup

/** Toolbox that leaves keyboard handling to the keyboard-navigation plugin (its README). */
class NavigationDeferringToolbox extends Blockly.Toolbox {
  protected override onKeyDown_(_e: KeyboardEvent): void {}
}

let setupDone = false;
function setupOnce(): void {
  if (setupDone) return;
  setupDone = true;
  registerBlocks();
  // Must happen before the first Blockly.inject. (The plugin's own
  // registerNavigationDeferringToolbox() recurses forever in 3.0.5, so we register an
  // equivalent toolbox class ourselves.)
  KeyboardNavigation.registerKeyboardNavigationStyles();
  KeyboardNavigation.registerFlyoutCursor();
  Blockly.registry.register(
    Blockly.registry.Type.TOOLBOX,
    Blockly.registry.DEFAULT,
    NavigationDeferringToolbox,
    true,
  );
}

function sameProgram(a: Program, b: Program): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setClass(
  ws: Blockly.WorkspaceSvg,
  ids: readonly NodeId[] | undefined,
  previous: Set<string>,
  className: string,
): Set<string> {
  for (const id of previous) ws.getBlockById(id)?.removeClass(className);
  const next = new Set<string>();
  for (const id of ids ?? []) {
    const resolved = resolveToExisting(id, (x) => ws.getBlockById(x) !== null);
    if (!resolved) continue;
    ws.getBlockById(resolved)?.addClass(className);
    next.add(resolved);
  }
  return next;
}

function scrollBlockIntoView(ws: Blockly.WorkspaceSvg, id: string, onlyIfOutside = false): void {
  const block = ws.getBlockById(id);
  if (!block) return;
  const bounds = block.getBoundingRectangle();
  if (onlyIfOutside) {
    const view = ws.getMetricsManager().getViewMetrics(true);
    const visible =
      bounds.left >= view.left &&
      bounds.top >= view.top &&
      bounds.right <= view.left + view.width &&
      bounds.bottom <= view.top + view.height;
    if (visible) return;
  }
  ws.scrollBoundsIntoView(bounds, 20);
}

function ensureShortcutHost(doc: Document): void {
  if (doc.getElementById('shortcuts')) return;
  const host = doc.createElement('div');
  host.id = 'shortcuts';
  doc.body.appendChild(host);
}

// -------------------------------------------------------------- component

export function BlockEditor(props: BlockEditorProps) {
  const { program, layout, highlightIds, markedIds, readOnly, themeKey } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const validatorRef = useRef<LiveValidator | null>(null);
  const propsRef = useRef(props);
  /** Programs we produced (onChange) or loaded: seeing them again as a prop is not a reload. */
  const knownRef = useRef<Program | null>(null);
  const highlightedRef = useRef(new Set<string>());
  const markedRef = useRef(new Set<string>());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [status, setStatus] = useState('');
  const problemStatusRef = useRef('');
  const hintId = useId();

  useEffect(() => {
    propsRef.current = props;
  });

  const decorate = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const p = propsRef.current;
    highlightedRef.current = setClass(ws, p.highlightIds, highlightedRef.current, 'bp-running');
    markedRef.current = setClass(ws, p.markedIds, markedRef.current, 'bp-marked');
  }, []);

  const emit = useCallback((r: ValidationResult) => {
    knownRef.current = r.program;
    const ws = wsRef.current;
    if (ws) {
      setCanUndo(ws.getUndoStack().length > 0);
      setCanRedo(ws.getRedoStack().length > 0);
    }
    const errors = r.issues.filter((i) => i.severity === 'error').length;
    const problemStatus =
      errors === 0 ? 'No problems found.' : `${errors} problem${errors === 1 ? '' : 's'} found.`;
    problemStatusRef.current = problemStatus;
    setStatus(problemStatus);
    propsRef.current.onChange(r.program, r.layout, r.issues);
  }, []);

  const load = useCallback(
    (p: Program, l: Layout) => {
      const ws = wsRef.current;
      if (!ws) return;
      const { warnings } = irToWs(p, l, ws);
      if (warnings.length > 0)
        console.warn('Block editor: some blocks could not be loaded', warnings);
      knownRef.current = p;
      highlightedRef.current = new Set();
      markedRef.current = new Set();
      decorate();
      validatorRef.current?.flush();
    },
    [decorate],
  );

  // Inject / dispose.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setupOnce();
    ensureEditorCss(host.ownerDocument);
    ensureShortcutHost(host.ownerDocument);
    const ws = Blockly.inject(host, {
      toolbox: buildToolbox(propsRef.current.showAdvanced ?? true),
      theme: buildBlocklyTheme(readThemeVars(host)),
      renderer: 'geras',
      trashcan: true,
      sounds: false,
      zoom: { controls: true, wheel: false, startScale: 0.9 },
      move: { scrollbars: true, drag: true, wheel: true },
      readOnly: false,
    });
    wsRef.current = ws;
    registerDynamicCategories(ws);
    let keyboardNav: KeyboardNavigation | null = null;
    try {
      keyboardNav = new KeyboardNavigation(ws);
    } catch (err) {
      console.warn('Block editor: keyboard navigation unavailable', err);
    }
    const detachSync = attachSync(ws);
    const validator = new LiveValidator(ws, emit);
    validatorRef.current = validator;
    setExpandHandler(ws, (id) => {
      const res = expandComposite(ws, id, propsRef.current.desugarOne);
      if (!res.ok) Blockly.dialog.alert(res.error);
    });
    setOneDesugarHandler(ws, propsRef.current.desugarOne);
    setFullExpandHandler(ws, propsRef.current.desugarFully ?? null);
    const p = propsRef.current;
    ws.setIsReadOnly(p.readOnly === true);
    load(p.program, p.layout);
    propsRef.current.onWorkspace?.(ws);
    return () => {
      propsRef.current.onWorkspace?.(null);
      validator.dispose();
      validatorRef.current = null;
      detachSync();
      setExpandHandler(ws, null);
      setOneDesugarHandler(ws, null);
      setFullExpandHandler(ws, null);
      keyboardNav?.dispose();
      wsRef.current = null;
      ws.dispose();
    };
  }, [emit, load]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.updateToolbox(buildToolbox(props.showAdvanced ?? true));
  }, [props.showAdvanced]);

  // Reload when the program changes from outside.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || program === knownRef.current) return;
    if (sameProgram(program, wsToIr(ws).program)) {
      knownRef.current = program;
      return;
    }
    load(program, layout);
    // `layout` alone changing does not reload: positions are owned by the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, load]);

  useEffect(decorate, [decorate, highlightIds, markedIds]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const resolved = (markedIds ?? [])
      .map((id) => resolveToExisting(id, (x) => ws.getBlockById(x) !== null))
      .filter((id): id is string => id !== null);
    if (resolved.length === 0) return;
    scrollBlockIntoView(ws, resolved[0]!);
    setStatus(
      `${resolved.length === 1 ? 'Showing the block.' : `Showing ${resolved.length} blocks.`} ${
        problemStatusRef.current
      }`,
    );
  }, [markedIds]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const resolved = (highlightIds ?? [])
      .map((id) => resolveToExisting(id, (x) => ws.getBlockById(x) !== null))
      .filter((id): id is string => id !== null);
    if (resolved.length > 0) scrollBlockIntoView(ws, resolved[0]!, true);
  }, [highlightIds]);

  useEffect(() => {
    wsRef.current?.setIsReadOnly(readOnly === true);
  }, [readOnly]);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws && themeKey !== undefined) rebuildTheme(ws, hostRef.current ?? undefined);
  }, [themeKey]);

  // Blockly 12 and the keyboard-navigation plugin bind keydown on the injection div (and the
  // dropdown div), not on document, so keys pressed outside the workspace never reach editor
  // shortcuts; the tests pin this. No global key guard is needed (one would also swallow the
  // playground's and dialogs' own keys).

  const undo = (redo: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.isReadOnly()) return;
    ws.undo(redo);
  };

  return (
    <div
      className="bp-editor"
      role="region"
      aria-label={props.label ?? 'Block editor'}
      aria-describedby={hintId}
    >
      <div className="bp-editor-toolbar" role="toolbar" aria-label="Editor actions">
        <button type="button" onClick={() => undo(false)} disabled={readOnly || !canUndo}>
          Undo
        </button>
        <button type="button" onClick={() => undo(true)} disabled={readOnly || !canRedo}>
          Redo
        </button>
        <span className="bp-editor-status" role="status" aria-live="polite">
          {status}
        </span>
        <span className="bp-editor-hint" id={hintId}>
          Tab into the workspace, then use the arrow keys; press T for the palette and / for all
          keyboard shortcuts. Enter edits the field under the cursor; Ctrl+Enter opens the block’s
          menu (Expand, Duplicate, Delete…).
        </span>
      </div>
      <div ref={hostRef} className="bp-editor-workspace" data-testid="bp-editor-workspace" />
    </div>
  );
}
