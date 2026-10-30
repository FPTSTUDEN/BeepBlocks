import { describe, expect, it } from 'vitest';
import type { Snapshot, Timeline } from '../../ir/timeline.ts';
import type { SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { MOCK_TIMELINES } from '../__mocks__/timelines.ts';
import { EXTRA_TIMELINES } from '../__mocks__/extraTimelines.ts';
import { diffSnapshot } from './diff.ts';
import { computeTags, visibleVars } from './tags.ts';
import { traceNodeIds } from './trace.ts';
import { activePaths, affectedPath, folderForSnapshot, folderItems, treeRows } from './explorer.ts';

const { rename, sort, bisect, error } = MOCK_TIMELINES;
const snap = (t: Timeline<SandboxFS>, i: number) => t.snapshots[i]!;
const findIndex = (t: Timeline<SandboxFS>, pred: (s: Snapshot<SandboxFS>) => boolean) =>
  t.snapshots.findIndex(pred);

describe('diffSnapshot', () => {
  it('no action → no diff', () => {
    expect(diffSnapshot(undefined, snap(rename, 0)).size).toBe(0);
    expect(diffSnapshot(snap(rename, 0), snap(rename, 1)).size).toBe(0);
  });

  it('rename → renamed at the new path with the old path', () => {
    const i = findIndex(rename, (s) => s.action?.op === 'RENAME');
    const d = diffSnapshot(snap(rename, i - 1), snap(rename, i));
    expect([...d.values()]).toEqual([
      { kind: 'renamed', path: 'photo_001.JPG', oldPath: 'IMG_0001.JPG' },
    ]);
    // Keys are case-insensitive.
    expect(d.get('photo_001.jpg')?.kind).toBe('renamed');
  });

  it('mkdir → created, move → moved', () => {
    const mk = findIndex(sort, (s) => s.action?.op === 'MKDIR');
    expect(diffSnapshot(snap(sort, mk - 1), snap(sort, mk)).get('documents')?.kind).toBe('created');
    const mv = findIndex(sort, (s) => s.action?.op === 'MOVE');
    const e = diffSnapshot(snap(sort, mv - 1), snap(sort, mv)).get('documents/report.pdf');
    expect(e).toEqual({ kind: 'moved', path: 'Documents/report.pdf', oldPath: 'report.pdf' });
  });

  it('delete → deleted with the ghost node from the previous state', () => {
    const t = EXTRA_TIMELINES.cleanup;
    const i = findIndex(t, (s) => s.action?.op === 'DELETE');
    const e = diffSnapshot(snap(t, i - 1), snap(t, i)).get('old.tmp');
    expect(e?.kind).toBe('deleted');
    expect(e?.node?.name).toBe('old.tmp');
  });

  it('write → changed when it existed, new otherwise; copy → new', () => {
    const t = EXTRA_TIMELINES.cleanup;
    const writes = t.snapshots.filter((s) => s.action?.op === 'WRITE');
    const kinds = writes.map(
      (s) => diffSnapshot(t.snapshots[s.index - 1], s).get(s.action!.from.toLowerCase())?.kind,
    );
    expect(kinds).toEqual(['modified', 'created']);
    const c = findIndex(t, (s) => s.action?.op === 'COPY');
    expect(diffSnapshot(snap(t, c - 1), snap(t, c)).get('backup/notes.txt')?.kind).toBe('created');
  });

  it('uses `initial` as the previous state for the first snapshot', () => {
    const t = EXTRA_TIMELINES.cleanup;
    const first = {
      ...t.snapshots[0]!,
      action: { op: 'DELETE' as const, from: 'old.tmp', destructive: true },
    };
    const initial = t.snapshots[0]!.state;
    expect(diffSnapshot(undefined, first, initial).get('old.tmp')?.node?.name).toBe('old.tmp');
  });
});

describe('computeTags', () => {
  it('path tags on items, case-insensitively keyed', () => {
    const i = findIndex(rename, (s) => s.nodeId === 'ren1/loop');
    const m = computeTags(snap(rename, i));
    expect(m.pathTags.get('img_0001.jpg')).toEqual(['item']);
    expect(m.missing.size).toBe(0);
    expect(m.list).toBeNull();
  });

  it('marks paths that no longer exist as missing', () => {
    // After the first rename, `item` still points at IMG_0001.JPG.
    const i = findIndex(rename, (s) => s.action?.op === 'RENAME');
    expect([...computeTags(snap(rename, i)).missing]).toEqual(['item']);
  });

  it('places hinted index tags on list rows and the end marker', () => {
    const i = findIndex(bisect, (s) => s.nodeId === 'bis1/high');
    const m = computeTags(snap(bisect, i));
    expect(m.list?.name).toBe('items');
    expect(m.list?.length).toBe(8);
    expect(m.list?.rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(m.list?.rows[0]!.indexTags).toEqual(['low']);
    expect(m.list?.endTags).toEqual(['high']);
    expect(m.indexStatus.get('high')).toBe('end');
    const j = findIndex(bisect, (s) => s.nodeId === 'bis1/mid');
    const m2 = computeTags(snap(bisect, j));
    expect(m2.list?.rows[4]!.indexTags).toEqual(['mid']);
    expect(m2.list?.rows[4]!.path).toBe('log_2025-10-05.txt');
  });

  it('several tags on one row, out-of-range indices', () => {
    const end = computeTags(snap(bisect, bisect.snapshots.length - 1));
    expect(end.list?.rows[5]!.indexTags.sort()).toEqual(['high', 'low', 'mid']);
    expect(end.pathTags.get('log_2025-10-06.txt')?.sort()).toEqual(['log', 'match']);
    const s = snap(bisect, 3);
    const odd = computeTags({
      ...s,
      frames: [{ fn: null, vars: { ...s.frames[0]!.vars, low: { t: 'int', v: 99 } } }],
    });
    expect(odd.indexStatus.get('low')).toBe('out of range');
  });

  it('innermost frame shadows program scope', () => {
    const s = snap(rename, 0);
    const vars = visibleVars({
      ...s,
      frames: [
        { fn: null, vars: { n: { t: 'int', v: 1 }, g: { t: 'int', v: 2 } } },
        { fn: 'helper', vars: { n: { t: 'int', v: 3 } } },
      ],
    });
    expect(vars).toEqual([
      { name: 'n', value: { t: 'int', v: 3 }, scope: 'helper' },
      { name: 'g', value: { t: 'int', v: 2 }, scope: null },
    ]);
  });
});

describe('traceNodeIds', () => {
  it('follows rename history backwards', () => {
    const last = rename.snapshots.length - 1;
    expect(traceNodeIds(rename, last, 'PHOTO_001.jpg')).toEqual(['ren1/match', 'ren1/rename']);
  });

  it('follows forward from an early index', () => {
    expect(traceNodeIds(rename, 0, 'IMG_0002.JPG')).toEqual(['ren1/match', 'ren1/rename']);
    expect(traceNodeIds(rename, 0, 'notes.txt')).toEqual(['ren1/match']);
  });

  it('root reads count for the root; moves count for the moved item', () => {
    expect(traceNodeIds(sort, 0, '')).toEqual(['srt1/list']);
    const last = sort.snapshots.length - 1;
    expect(traceNodeIds(sort, last, 'Documents/todo.txt')).toEqual(['srt1/move']);
    expect(traceNodeIds(sort, last, 'documents')).toEqual(['srt1/exists', 'srt1/mkdir']);
  });

  it('tracks items inside a renamed folder and deleted items', () => {
    const t = EXTRA_TIMELINES.cleanup;
    const last = t.snapshots.length - 1;
    expect(traceNodeIds(t, last, 'Archive/inner.txt')).toEqual(['cl/readInner']);
    const del = t.snapshots.findIndex((s) => s.action?.op === 'DELETE');
    expect(traceNodeIds(t, del, 'old.tmp')).toEqual(['cl/size', 'cl/delete']);
  });

  it('empty timeline → nothing', () => {
    expect(traceNodeIds({ snapshots: [], output: [], outcome: 'done' }, 0, 'x')).toEqual([]);
  });
});

describe('explorer helpers', () => {
  it('affected path and auto-selected folder', () => {
    const mv = findIndex(sort, (s) => s.action?.op === 'MOVE');
    expect(affectedPath(snap(sort, mv))).toBe('Documents/report.pdf');
    expect(folderForSnapshot(snap(sort, mv))).toBe('Documents');
    expect(folderForSnapshot(snap(sort, 0))).toBe('');
    expect(folderForSnapshot(snap(error, 0))).toBeNull();
    expect([...activePaths(snap(sort, mv))].sort()).toEqual(['documents/report.pdf', 'report.pdf']);
  });

  it('tree rows respect expansion', () => {
    const fs = snap(sort, sort.snapshots.length - 1).state;
    expect(treeRows(fs, new Set()).map((r) => r.path)).toEqual(['']);
    const rows = treeRows(fs, new Set(['']));
    expect(rows.map((r) => [r.path, r.level, r.posInSet, r.setSize])).toEqual([
      ['', 1, 1, 1],
      ['Audio', 2, 1, 2],
      ['Documents', 2, 2, 2],
    ]);
    expect(rows[0]!.hasSubfolders).toBe(true);
  });

  it('folder items include this step’s deleted ghost in sorted order', () => {
    const t = EXTRA_TIMELINES.cleanup;
    const del = t.snapshots.findIndex((s) => s.action?.op === 'DELETE');
    const s = snap(t, del);
    const rows = folderItems(s.state, '', diffSnapshot(snap(t, del - 1), s));
    const ghost = rows.find((r) => r.ghost);
    expect(ghost?.path).toBe('old.tmp');
    const names = rows.map((r) => r.node.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    );
  });
});
