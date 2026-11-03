import type { Timeline } from '../ir/timeline.ts';

/** Snapshot indices used by the app's "by block" playback mode. */
export function computeStepStops<S>(
  timeline: Timeline<S> | null,
  visibleIds?: ReadonlySet<string>,
): number[] | null {
  if (!timeline || timeline.snapshots.length === 0) return null;
  const snapshots = timeline.snapshots;
  const stops = new Set<number>([0, snapshots.length - 1]);
  let previousNode = '';
  for (const snapshot of snapshots) {
    const nodeChanged = snapshot.nodeId !== previousNode;
    const visible = !visibleIds || visibleIds.has(snapshot.nodeId);
    if (nodeChanged && visible) stops.add(snapshot.index);
    if (snapshot.event === 'fsOp' || snapshot.event === 'error' || snapshot.event === 'done') {
      stops.add(snapshot.index);
    }
    previousNode = snapshot.nodeId;
  }
  return [...stops].sort((a, b) => a - b);
}
