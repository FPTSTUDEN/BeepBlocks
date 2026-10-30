/** Explorer view (task E.1): folder tree + file list, and its selection/expansion state. */
import { useState, type ReactNode } from 'react';
import type { SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import type { Diff } from '../lib/diff.ts';
import { existingFolder, foldersToExpand } from '../lib/explorer.ts';
import { displayPath, pathKey } from '../lib/paths.ts';
import type { FileRow } from '../lib/rows.ts';
import { FileList, type ListModeInfo } from './FileList.tsx';
import { FolderTree } from './FolderTree.tsx';
import styles from '../Playground.module.css';

export interface ExplorerState {
  /** Selected folder, in stored case, guaranteed to exist in `fs`. */
  folder: string;
  expanded: ReadonlySet<string>;
  select: (path: string) => void;
  toggle: (path: string, open: boolean) => void;
}

/**
 * Selection + expansion of the folder tree. Whenever `trigger` changes (a new snapshot) and
 * `autoFolder` is set, that folder is selected and its ancestors expanded (task E.1).
 */
export function useExplorerState(
  fs: SandboxFS,
  trigger: unknown,
  autoFolder: string | null,
): ExplorerState {
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['']));
  const [seen, setSeen] = useState<{ trigger: unknown } | null>(null);
  if (seen === null || seen.trigger !== trigger) {
    setSeen({ trigger });
    if (autoFolder !== null) {
      setSelected(autoFolder);
      setExpanded((prev) => new Set([...prev, ...foldersToExpand(autoFolder)]));
    }
  }
  return {
    folder: existingFolder(fs, selected),
    expanded,
    select: (path) => {
      setSelected(path);
      setExpanded((prev) => new Set([...prev, ...foldersToExpand(path)]));
    },
    toggle: (path, open) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(pathKey(path));
        else next.delete(pathKey(path));
        return next;
      }),
  };
}

export interface ExplorerProps {
  fs: SandboxFS;
  state: ExplorerState;
  rows: readonly FileRow[];
  listMode: ListModeInfo | null;
  onActivate: (row: FileRow) => void;
  activateHint: string;
  diff?: Diff;
  pathTags?: ReadonlyMap<string, string[]>;
  active?: ReadonlySet<string>;
  selectedKey?: string | null;
  /** Extra controls shown above the file list (list/folder toggle, editor buttons). */
  toolbar?: ReactNode;
}

export function folderTitle(folder: string): string {
  return folder === '' ? 'Top folder' : displayPath(folder);
}

export function Explorer(p: ExplorerProps) {
  const title = p.listMode
    ? `List ${p.listMode.name} (${String(p.listMode.length)} items, in list order)`
    : `Files in ${folderTitle(p.state.folder)}`;
  const treeProps = {
    fs: p.fs,
    expanded: p.state.expanded,
    selected: p.state.folder,
    onSelect: p.state.select,
    onToggle: p.state.toggle,
    ...(p.diff ? { diff: p.diff } : {}),
    ...(p.pathTags ? { pathTags: p.pathTags } : {}),
    ...(p.active ? { active: p.active } : {}),
  };
  return (
    <div className={styles.explorer}>
      <nav aria-label="Folder tree" className={styles.surface}>
        <FolderTree {...treeProps} />
      </nav>
      <section aria-label={title} className={styles.surface}>
        <div className={styles.listToolbar}>
          <h3 className={styles.heading}>{title}</h3>
          {p.toolbar}
        </div>
        <FileList
          rows={p.rows}
          label={title}
          listMode={p.listMode}
          selectedKey={p.selectedKey ?? null}
          onActivate={p.onActivate}
          onOpenFolder={p.state.select}
          activateHint={p.activateHint}
        />
      </section>
    </div>
  );
}
