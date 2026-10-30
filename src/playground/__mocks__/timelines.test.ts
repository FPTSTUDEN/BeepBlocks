import { describe, expect, it } from 'vitest';
import { MOCK_TIMELINES } from './timelines.ts';
import { getNode } from '../../domains/fileExplorer/fsTypes.ts';

describe('mock timelines', () => {
  it('have consecutive indices and consistent output counts', () => {
    for (const t of Object.values(MOCK_TIMELINES)) {
      t.snapshots.forEach((s, i) => expect(s.index).toBe(i));
      expect(t.snapshots.at(-1)!.output).toBe(t.output.length);
    }
  });

  it('apply their actions to the state', () => {
    const sortEnd = MOCK_TIMELINES.sort.snapshots.at(-1)!.state;
    expect(getNode(sortEnd, 'documents/todo.txt')?.type).toBe('file');
    expect(getNode(sortEnd, 'report.pdf')).toBeUndefined();
    const renameEnd = MOCK_TIMELINES.rename.snapshots.at(-1)!.state;
    expect(getNode(renameEnd, 'photo_002.JPG')?.type).toBe('file');
  });

  it('end the error run with an error snapshot', () => {
    expect(MOCK_TIMELINES.error.outcome).toBe('error');
    expect(MOCK_TIMELINES.error.snapshots.at(-1)!.error?.code).toBe('ALREADY_EXISTS');
  });
});
