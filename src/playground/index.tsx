/**
 * Playground UI public API — Workstream E (design.md §10). Stub until Phase 1.
 * Develop against ./__mocks__/timelines.ts.
 */
import type { NodeId } from '../ir/types.ts';
import type { Timeline } from '../ir/timeline.ts';
import type { SandboxFS } from '../domains/fileExplorer/fsTypes.ts';

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
}

export function Playground(_props: PlaygroundProps) {
  return <div role="region" aria-label="Playground">Playground (Workstream E)</div>;
}
