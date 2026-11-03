/** Timeline controls (task E.5): Run, Pause, Step back/forward, Reset, scrubber, speed. */
import { useEffect, useId, useRef } from 'react';
import { SPEEDS, formatSpeed, isSpeed, type Speed } from '../lib/controls.ts';
import { cx } from './Badges.tsx';
import styles from '../Playground.module.css';

export interface ControlsProps {
  /** Number of snapshots (0 = no timeline). */
  total: number;
  index: number;
  playing: boolean;
  stale: boolean;
  /** Disables everything (scenario editing). */
  disabled: boolean;
  speed: Speed;
  /** Visible status text ("Step 3 of 12", "Done", …). */
  status: string;
  done: boolean;
  onRun: () => void;
  onPause: () => void;
  onBack: () => void;
  onForward: () => void;
  onReset: () => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: Speed) => void;
  stepStops?: readonly number[] | null;
  stepMode?: 'block' | 'detail';
  onStepMode?: (mode: 'block' | 'detail') => void;
  /** When set, Run is disabled and this reason is shown next to it (e.g. invalid program). */
  runBlockedReason?: string | null;
}

export function Controls(p: ControlsProps) {
  const speedId = useId();
  const blockedId = useId();
  const runRef = useRef<HTMLButtonElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const forwardRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  /** Control that should get focus as soon as it is enabled (e.g. Pause while a run starts). */
  const pendingFocus = useRef<HTMLButtonElement | null>(null);
  const has = p.total > 0 && !p.disabled;
  const last = Math.max(0, p.total - 1);
  const blocked = p.runBlockedReason ? p.runBlockedReason : null;
  // A focused button that becomes disabled would drop focus to <body>, outside the playground
  // (and its shortcuts). Move focus to its counterpart (Run ↔ Pause, Back ↔ Forward), or park
  // it on the toolbar until that counterpart is enabled (Run waits for the new timeline).
  useEffect(() => {
    const active = document.activeElement;
    const pending = pendingFocus.current;
    if (pending) {
      if (!pending.disabled) {
        pendingFocus.current = null;
        if (active === toolbarRef.current) pending.focus();
      } else if (active !== toolbarRef.current) {
        pendingFocus.current = null; // the user moved on
      }
      return;
    }
    const counterpart = new Map<Element | null, HTMLButtonElement | null>([
      [runRef.current, pauseRef.current],
      [pauseRef.current, runRef.current],
      [backRef.current, forwardRef.current],
      [forwardRef.current, backRef.current],
    ]);
    if (!counterpart.has(active) || !(active as HTMLButtonElement).disabled) return;
    const next = counterpart.get(active) ?? null;
    if (next && !next.disabled) next.focus();
    else if (active === runRef.current && next) {
      pendingFocus.current = next;
      toolbarRef.current?.focus();
    } else {
      [runRef, pauseRef, backRef, forwardRef, resetRef]
        .map((r) => r.current)
        .find((b) => b !== null && !b.disabled)
        ?.focus();
    }
  }, [p.playing, p.index, p.total, p.disabled, blocked]);
  return (
    <div
      ref={toolbarRef}
      className={styles.controls}
      role="toolbar"
      aria-label="Playback controls"
      tabIndex={-1}
    >
      <button
        ref={runRef}
        type="button"
        className={cx(styles.button, styles.primary)}
        onClick={p.onRun}
        disabled={p.disabled || p.playing || blocked !== null}
        aria-keyshortcuts="Space"
        aria-describedby={blocked !== null ? blockedId : undefined}
      >
        <span aria-hidden="true">▶ </span>Run
      </button>
      {blocked !== null && (
        <span id={blockedId} className={styles.blockedReason}>
          {blocked}
        </span>
      )}
      <button
        ref={pauseRef}
        type="button"
        className={styles.button}
        onClick={p.onPause}
        disabled={!has || !p.playing}
        aria-keyshortcuts="Space"
      >
        <span aria-hidden="true">⏸ </span>Pause
      </button>
      <button
        ref={backRef}
        type="button"
        className={styles.button}
        onClick={p.onBack}
        disabled={!has || p.index <= 0}
        aria-keyshortcuts="ArrowLeft"
      >
        <span aria-hidden="true">⏮ </span>Step back
      </button>
      <button
        ref={forwardRef}
        type="button"
        className={styles.button}
        onClick={p.onForward}
        disabled={!has || p.index >= last}
        aria-keyshortcuts="ArrowRight"
      >
        Step forward<span aria-hidden="true"> ⏭</span>
      </button>
      <button
        ref={resetRef}
        type="button"
        className={styles.button}
        onClick={p.onReset}
        disabled={p.disabled}
        aria-keyshortcuts="Home"
      >
        <span aria-hidden="true">↺ </span>Reset
      </button>
      <input
        type="range"
        className={styles.scrubber}
        aria-label="Step"
        min={0}
        max={last}
        step={1}
        value={has ? p.index : 0}
        disabled={!has}
        aria-valuetext={has ? `Step ${String(p.index + 1)} of ${String(p.total)}` : 'Not run yet'}
        onChange={(e) => p.onScrub(Number(e.currentTarget.value))}
      />
      <label htmlFor={speedId}>Speed</label>
      <select
        id={speedId}
        className={styles.select}
        value={String(p.speed)}
        disabled={p.disabled}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (isSpeed(n)) p.onSpeed(n);
        }}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={String(s)}>
            {formatSpeed(s)}
          </option>
        ))}
      </select>
      {p.stepStops && p.onStepMode && (
        <>
          <label htmlFor={`${speedId}-mode`}>Step</label>
          <select
            id={`${speedId}-mode`}
            className={styles.select}
            value={p.stepMode ?? 'block'}
            onChange={(e) => {
              if (e.target.value === 'block' || e.target.value === 'detail') p.onStepMode?.(e.target.value);
            }}
          >
            <option value="block">by block</option>
            <option value="detail">every detail</option>
          </select>
        </>
      )}
      <span className={cx(styles.status, p.done && styles.done)} data-testid="status">
        {p.done && <span aria-hidden="true">✓ </span>}
        {p.status}
      </span>
    </div>
  );
}
