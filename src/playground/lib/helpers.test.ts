import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../ir/timeline.ts';
import type { SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { MOCK_TIMELINES } from '../__mocks__/timelines.ts';
import { EXTRA_TIMELINES } from '../__mocks__/extraTimelines.ts';
import {
  announce,
  clampIndex,
  describeEvent,
  formatSpeed,
  isSpeed,
  shortcutFor,
  stepDelayMs,
  SPEEDS,
} from './controls.ts';
import { diffSnapshot } from './diff.ts';
import { canonicalPath, existingFolder, latestModified } from './explorer.ts';
import { folderRows, indexTagsByPath, listRows } from './rows.ts';
import { computeTags } from './tags.ts';

const { rename, bisect } = MOCK_TIMELINES;
const key = (k: string, extra: Partial<Parameters<typeof shortcutFor>[0]> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  defaultPrevented: false,
  target: null,
  ...extra,
});

describe('controls helpers', () => {
  it('speeds and delays (~4 steps/s at 1×)', () => {
    expect(SPEEDS).toEqual([0.25, 0.5, 1, 2, 4, 8]);
    expect(stepDelayMs(1)).toBe(250);
    expect(stepDelayMs(0.25)).toBe(1000);
    expect(stepDelayMs(8)).toBe(31.25);
    expect(formatSpeed(0.5)).toBe('0.5×');
    expect(isSpeed(2)).toBe(true);
    expect(isSpeed(3)).toBe(false);
  });

  it('clampIndex', () => {
    expect(clampIndex(5, null)).toBe(0);
    expect(clampIndex(-1, rename)).toBe(0);
    expect(clampIndex(999, rename)).toBe(rename.snapshots.length - 1);
    expect(clampIndex(2.7, rename)).toBe(2);
    expect(clampIndex(NaN, rename)).toBe(0);
  });

  it('shortcutFor maps keys and respects modifiers / handled keys', () => {
    expect(shortcutFor(key(' '))).toBe('toggle');
    expect(shortcutFor(key('ArrowLeft'))).toBe('back');
    expect(shortcutFor(key('ArrowRight'))).toBe('forward');
    expect(shortcutFor(key('Home'))).toBe('reset');
    expect(shortcutFor(key('x'))).toBeNull();
    expect(shortcutFor(key('ArrowLeft', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key('ArrowLeft', { defaultPrevented: true }))).toBeNull();
  });

  it('describes events and announces steps', () => {
    const i = rename.snapshots.findIndex((s) => s.action?.op === 'RENAME');
    expect(describeEvent(rename.snapshots[i]!)).toBe('RENAME IMG_0001.JPG -> photo_001.JPG');
    expect(describeEvent(rename.snapshots[1]!)).toBe('looked at .');
    expect(describeEvent(rename.snapshots[3]!)).toBe('checked a condition');
    const err = MOCK_TIMELINES.error.snapshots[1]!;
    expect(describeEvent(err)).toMatch(/^stopped with an error: /);
    const call = EXTRA_TIMELINES.cleanup.snapshots.find((s) => s.event === 'call')!;
    expect(describeEvent(call)).toBe('called report');
    expect(announce(null, 0)).toBe('Not run yet.');
    expect(announce(rename, 0)).toBe(`Step 1 of ${String(rename.snapshots.length)}: ran a block.`);
  });
});

describe('explorer path helpers', () => {
  const fs = MOCK_TIMELINES.sort.snapshots.at(-1)!.state;
  it('canonicalPath / existingFolder / latestModified', () => {
    expect(canonicalPath(fs, 'documents/TODO.txt')).toBe('Documents/todo.txt');
    expect(canonicalPath(fs, 'nope')).toBeNull();
    expect(existingFolder(fs, 'documents')).toBe('Documents');
    expect(existingFolder(fs, 'documents/gone/deeper')).toBe('Documents');
    expect(existingFolder(fs, 'documents/todo.txt')).toBe('Documents');
    expect(existingFolder(fs, 'x')).toBe('');
    expect(latestModified(fs)).toBeGreaterThanOrEqual(fs.root.modified);
  });
});

describe('rows', () => {
  const at = (s: Snapshot<SandboxFS>[], pred: (s: Snapshot<SandboxFS>) => boolean) =>
    s.findIndex(pred);

  it('list rows keep list order, positions, tags, and missing items', () => {
    const i = at(bisect.snapshots, (s) => s.nodeId === 'bis1/candidate');
    const s = bisect.snapshots[i]!;
    const tags = computeTags(s);
    const rows = listRows(tags.list!, s.state, new Map(), tags.pathTags);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rows[4]!.indexTags).toEqual(['mid']);
    expect(rows[4]!.tags).toEqual(['log']);
    expect(rows.every((r) => r.node !== null)).toBe(true);
    const gone = listRows(
      {
        name: 'xs',
        rows: [
          {
            position: 0,
            value: { t: 'path', v: 'zzz' },
            path: 'zzz',
            exists: false,
            indexTags: [],
          },
        ],
        length: 1,
        endTags: [],
      },
      s.state,
      new Map(),
      new Map(),
    );
    expect(gone[0]!.node).toBeNull();
    const nums = listRows(
      {
        name: 'ns',
        rows: [{ position: 0, value: { t: 'float', v: 2 }, exists: true, indexTags: ['i'] }],
        length: 1,
        endTags: [],
      },
      s.state,
      new Map(),
      new Map(),
    );
    expect(nums[0]).toMatchObject({ path: null, text: '2.0', indexTags: ['i'] });
  });

  it('folder rows carry index tags from the hinted list and active state', () => {
    const i = at(bisect.snapshots, (s) => s.nodeId === 'bis1/check');
    const s = bisect.snapshots[i]!;
    const tags = computeTags(s);
    expect(indexTagsByPath(tags.list).get('log_2025-10-05.txt')).toEqual(['mid']);
    const rows = folderRows(s.state, '', new Map(), tags, new Set(['log_2025-10-05.txt']));
    const r = rows.find((x) => x.path === 'log_2025-10-05.txt')!;
    expect(r.indexTags).toEqual(['mid']);
    expect(r.active).toBe(true);
    expect(rows.filter((x) => x.active)).toHaveLength(1);
  });

  it('folder rows include the deleted ghost with its diff', () => {
    const t = EXTRA_TIMELINES.cleanup;
    const del = t.snapshots.findIndex((s) => s.action?.op === 'DELETE');
    const s = t.snapshots[del]!;
    const rows = folderRows(s.state, '', diffSnapshot(t.snapshots[del - 1], s), null);
    const ghost = rows.find((r) => r.ghost)!;
    expect(ghost.key).toBe('ghost:old.tmp');
    expect(ghost.diff?.kind).toBe('deleted');
  });
});
