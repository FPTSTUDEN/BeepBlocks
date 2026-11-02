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
  const has = p.total > 0 && !p.disabled;
  const last = Math.max(0, p.total - 1);
  const blocked = p.runBlockedReason ? p.runBlockedReason : null;
  useEffect(() => {
    const active = document.activeElement;
    const wasControl = [runRef.current, pauseRef.current, backRef.current, forwardRef.current].includes(
      active as HTMLButtonElement | null,
    );
    if (!wasControl || !(active as HTMLButtonElement | null)?.disabled) return;
    const next = [runRef.current, pauseRef.current, backRef.current, forwardRef.current, resetRef.current]
      .find((button) => button !== null && !button.disabled);
    next?.focus();
  }, [p.playing, p.index, p.total, p.disabled, blocked]);
  return (
    <div className={styles.controls} role="toolbar" aria-label="Playback controls">
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
      <span className={cx(styles.status, p.done && styles.done)} data-testid="status">
        {p.done && <span aria-hidden="true">✓ </span>}
        {p.status}
      </span>
    </div>
  );
}
