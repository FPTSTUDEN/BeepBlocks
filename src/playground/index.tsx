/**
 * Playground UI public API — Workstream E (design.md §10).
 *
 * Presentational: the timeline, the current index, staleness and the scenario all come from
 * props. Local state is UI-only (playing, speed, folder selection/expansion, list toggle).
 */
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { NodeId } from '../ir/types.ts';
import type { Snapshot, Timeline } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';
import { Controls } from './components/Controls.tsx';
import { Explorer, useExplorerState } from './components/Explorer.tsx';
import { CountersPanel, OutputPanel, VariablesPanel } from './components/Panels.tsx';
import { ScenarioEditor } from './components/ScenarioEditor.tsx';
import { cx } from './components/Badges.tsx';
import {
  DEFAULT_SPEED,
  announce,
  clampIndex,
  shortcutFor,
  stepDelayMs,
  type Speed,
} from './lib/controls.ts';
import { diffSnapshot, type Diff } from './lib/diff.ts';
import { activePaths, folderForSnapshot } from './lib/explorer.ts';
import { folderRows, listRows } from './lib/rows.ts';
import { computeTags, type TagModel } from './lib/tags.ts';
import { traceNodeIds } from './lib/trace.ts';
import styles from './Playground.module.css';

export interface PlaygroundProps {
  /** Starting state shown when there is no timeline, and edited in scenario mode. */
  initial: SandboxFS;
  timeline: Timeline<SandboxFS> | null;
  /** Current snapshot index (controlled). */
  index: number;
  onIndexChange: (index: number) => void;
  /** True when the program changed after this timeline was produced (Req 8.4). */
  stale: boolean;
  onRun: () => void;
  onReset: () => void;
  /** Click-to-trace (Req 7.7). */
  onTrace: (nodeIds: NodeId[]) => void;
  /** Scenario editor mode (Req 5.4). */
  editingScenario: boolean;
  onScenarioChange: (fs: SandboxFS) => void;
  /** Optional accessible name of the region (default "Playground"). */
  label?: string;
  /** When set, Run is disabled (button and Space) and this reason is shown. */
  runBlockedReason?: string | null;
  /** Optional callback for focusing the editor block that caused a runtime error. */
  onShowBlock?: (nodeId: NodeId) => void;
}

const EMPTY_DIFF: Diff = new Map();
const ZERO = { steps: 0, reads: 0, fileOps: 0, comparisons: 0 };

export function Playground(props: PlaygroundProps) {
  const { timeline, stale, editingScenario } = props;
  const total = timeline?.snapshots.length ?? 0;
  const index = clampIndex(props.index, timeline);
  const last = Math.max(0, total - 1);
  const snapshot: Snapshot<SandboxFS> | undefined = timeline?.snapshots[index];
  const prev = index > 0 ? timeline?.snapshots[index - 1] : undefined;
  const fs = editingScenario ? props.initial : (snapshot?.state ?? props.initial);

  const [playingFlag, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(DEFAULT_SPEED);
  const [showList, setShowList] = useState(true);
  /** Set when Run asked the parent for a fresh timeline; playback starts once it arrives. */
  const [pendingPlay, setPendingPlay] = useState(false);
  const [announcement, setAnnouncement] = useState(() => announce(timeline, index));
  const staleId = useId();
  const [seenTimeline, setSeenTimeline] = useState(timeline);
  if (seenTimeline !== timeline) {
    setSeenTimeline(timeline);
    const play = pendingPlay && timeline !== null && !stale;
    setPlaying(play);
    if (timeline !== null) setPendingPlay(false);
  }

  const playing = playingFlag && timeline !== null && !stale && !editingScenario && index < last;

  // Playback: one step per tick while playing (about 4 steps/s at 1×).
  const { onIndexChange } = props;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      onIndexChange(index + 1);
      if (index + 1 >= last) setPlaying(false);
    }, stepDelayMs(speed));
    return () => clearTimeout(t);
  }, [playing, index, last, speed, onIndexChange]);

  const explorer = useExplorerState(fs, snapshot, folderForSnapshot(snapshot));

  const run = () => {
    if (editingScenario || props.runBlockedReason) return;
    if (timeline === null || stale) {
      setPendingPlay(true);
      props.onRun();
      return;
    }
    if (index >= last) props.onIndexChange(0);
    setPlaying(true);
  };
  const pause = () => {
    setPlaying(false);
    if (timeline) setAnnouncement(announce(timeline, index));
  };
  const go = (i: number) => {
    setPlaying(false);
    if (timeline) {
      const next = clampIndex(i, timeline);
      props.onIndexChange(next);
      setAnnouncement(announce(timeline, next));
    }
  };
  const reset = () => {
    setPlaying(false);
    setPendingPlay(false);
    props.onReset();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (editingScenario) return;
    const s = shortcutFor(e);
    if (!s) return;
    e.preventDefault();
    if (s === 'toggle') {
      if (playing) pause();
      else run();
    } else if (s === 'back') go(index - 1);
    else if (s === 'forward') go(index + 1);
    else reset();
  };

  const done = timeline !== null && index === last && timeline.outcome === 'done';
  const error = snapshot?.error;
  useEffect(() => {
    if (!editingScenario && timeline && (done || error) && !playing) {
      const timer = setTimeout(() => setAnnouncement(announce(timeline, index)), 0);
      return () => clearTimeout(timer);
    }
  }, [done, editingScenario, error, index, playing, timeline]);
  const status = !timeline
    ? 'Not run yet'
    : done
      ? 'Done'
      : error
        ? 'Stopped with an error'
        : `Step ${String(index + 1)} of ${String(total)}`;

  return (
    <section
      role="region"
      aria-label={props.label ?? 'Playground'}
      className={cx(styles.root, stale && timeline !== null && !editingScenario && styles.stale)}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-keyshortcuts="Space ArrowLeft ArrowRight Home"
    >
      {editingScenario ? (
        <ScenarioEditor fs={props.initial} onChange={props.onScenarioChange} />
      ) : (
        <>
          <div className={styles.errorBanner} role="alert">
            {error && (
              <>
                <strong>
                  <span aria-hidden="true">⚠ </span>Error:
                </strong>{' '}
                {error.message}{' '}
                <span>
                  at block <span className={styles.blockId}>{error.nodeId}</span>
                </span>
                {props.onShowBlock && (
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => props.onShowBlock?.(error.nodeId)}
                  >
                    Show block
                  </button>
                )}
              </>
            )}
          </div>
          <RunView
            fs={fs}
            timeline={timeline}
            index={index}
            snapshot={snapshot}
            prev={prev}
            initial={props.initial}
            explorer={explorer}
            showList={showList}
            onShowList={setShowList}
            onTrace={props.onTrace}
            stale={stale}
            staleId={staleId}
          />
        </>
      )}
      <Controls
        total={total}
        index={index}
        playing={playing}
        stale={stale}
        disabled={editingScenario}
        speed={speed}
        status={editingScenario ? 'Editing the scenario' : status}
        done={done && !editingScenario}
        onRun={run}
        onPause={pause}
        onBack={() => go(index - 1)}
        onForward={() => go(index + 1)}
        onReset={reset}
        onScrub={go}
        onSpeed={setSpeed}
        runBlockedReason={editingScenario ? null : (props.runBlockedReason ?? null)}
      />
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {editingScenario ? '' : announcement}
      </p>
    </section>
  );
}

interface RunViewProps {
  fs: SandboxFS;
  timeline: Timeline<SandboxFS> | null;
  index: number;
  snapshot: Snapshot<SandboxFS> | undefined;
  prev: Snapshot<SandboxFS> | undefined;
  initial: SandboxFS;
  explorer: ReturnType<typeof useExplorerState>;
  showList: boolean;
  onShowList: (show: boolean) => void;
  onTrace: (nodeIds: NodeId[]) => void;
  stale: boolean;
  staleId: string;
}

function RunView(p: RunViewProps) {
  const { snapshot, timeline } = p;
  const diff = snapshot ? diffSnapshot(p.prev, snapshot, p.initial) : EMPTY_DIFF;
  const tags: TagModel | null = snapshot ? computeTags(snapshot) : null;
  const active = activePaths(snapshot);
  const list = tags?.list ?? null;
  const listShown = list !== null && p.showList;
  const rows = listShown
    ? listRows(list, p.fs, diff, tags?.pathTags ?? new Map(), active)
    : folderRows(p.fs, p.explorer.folder, diff, tags, active);
  const output = timeline && snapshot ? timeline.output.slice(0, snapshot.output) : [];

  return (
    <>
      <div className={styles.main}>
        <div className={styles.staleOverlay}>
          <p id={p.staleId} className={styles.staleMessage} role="status">
            {p.stale && timeline !== null && (
              <>
                <span aria-hidden="true">⟳ </span>Program changed — run again
              </>
            )}
          </p>
        </div>
        <Explorer
          fs={p.fs}
          state={p.explorer}
          rows={rows}
          listMode={
            listShown ? { name: list.name, length: list.length, endTags: list.endTags } : null
          }
          onActivate={(row) => {
            if (row.path === null) return;
            p.onTrace(timeline ? traceNodeIds(timeline, p.index, row.path) : []);
          }}
          activateHint="Press Enter or Space to highlight the blocks that touched this item. On a folder, ArrowRight opens it; ArrowLeft or Backspace goes to its parent."
          describedBy={p.staleId}
          diff={diff}
          active={active}
          {...(tags ? { pathTags: tags.pathTags } : {})}
          toolbar={
            list !== null ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => p.onShowList(!p.showList)}
              >
                {p.showList ? 'Show folder' : `Show list ${list.name}`}
              </button>
            ) : null
          }
        />
      </div>
      <div className={styles.panels} aria-describedby={p.staleId}>
        <VariablesPanel
          vars={tags?.vars ?? []}
          missing={tags?.missing ?? new Set()}
          indexStatus={tags?.indexStatus ?? new Map()}
          listName={list?.name ?? null}
        />
        <CountersPanel
          counters={snapshot?.counters ?? ZERO}
          listSize={listShown ? list.length : null}
        />
        <OutputPanel lines={output} />
      </div>
    </>
  );
}
