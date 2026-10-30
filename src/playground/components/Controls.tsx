/** Timeline controls (task E.5): Run, Pause, Step back/forward, Reset, scrubber, speed. */
import { useId } from 'react';
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
}

export function Controls(p: ControlsProps) {
  const speedId = useId();
  const has = p.total > 0 && !p.disabled;
  const last = Math.max(0, p.total - 1);
  return (
    <div className={styles.controls} role="toolbar" aria-label="Playback controls">
      <button
        type="button"
        className={cx(styles.button, styles.primary)}
        onClick={p.onRun}
        disabled={p.disabled || p.playing}
        aria-keyshortcuts="Space"
      >
        <span aria-hidden="true">▶ </span>Run
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={p.onPause}
        disabled={!has || !p.playing}
        aria-keyshortcuts="Space"
      >
        <span aria-hidden="true">⏸ </span>Pause
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={p.onBack}
        disabled={!has || p.index <= 0}
        aria-keyshortcuts="ArrowLeft"
      >
        <span aria-hidden="true">⏮ </span>Step back
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={p.onForward}
        disabled={!has || p.index >= last}
        aria-keyshortcuts="ArrowRight"
      >
        Step forward<span aria-hidden="true"> ⏭</span>
      </button>
      <button
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
