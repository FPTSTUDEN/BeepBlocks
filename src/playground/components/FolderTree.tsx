/**
 * Folder tree (task E.1): ARIA tree with roving focus. ↑/↓ move, → expands or enters,
 * ← collapses or goes to the parent, Enter/Space selects the folder.
 */
import { useState, type KeyboardEvent } from 'react';
import type { SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import type { Diff } from '../lib/diff.ts';
import { treeRows } from '../lib/explorer.ts';
import { parentPath, pathKey } from '../lib/paths.ts';
import { ActiveMarker, DiffBadge, Tags, cx } from './Badges.tsx';
import { keyOfTarget } from './FileList.tsx';
import styles from '../Playground.module.css';

export interface FolderTreeProps {
  fs: SandboxFS;
  /** Path keys of expanded folders. */
  expanded: ReadonlySet<string>;
  selected: string;
  onSelect: (path: string) => void;
  onToggle: (path: string, open: boolean) => void;
  diff?: Diff;
  pathTags?: ReadonlyMap<string, string[]>;
  active?: ReadonlySet<string>;
}

const NO_TAGS: ReadonlyMap<string, string[]> = new Map();

export function FolderTree(props: FolderTreeProps) {
  const { fs, expanded, selected, onSelect, onToggle } = props;
  const rows = treeRows(fs, expanded);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const keys = rows.map((r) => pathKey(r.path));
  const current =
    focusKey !== null && keys.includes(focusKey)
      ? focusKey
      : keys.includes(pathKey(selected))
        ? pathKey(selected)
        : (keys[0] ?? '');

  const focusRow = (tree: HTMLElement, key: string) => {
    setFocusKey(key);
    const items = tree.querySelectorAll<HTMLElement>('[data-rowkey]');
    [...items].find((el) => el.dataset['rowkey'] === key)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const own = keyOfTarget(e.target);
    const i = keys.indexOf(own !== null && keys.includes(own) ? own : current);
    const row = rows[i];
    if (!row) return;
    switch (e.key) {
      case 'ArrowDown':
        if (i + 1 < rows.length) focusRow(e.currentTarget, keys[i + 1]!);
        break;
      case 'ArrowUp':
        if (i > 0) focusRow(e.currentTarget, keys[i - 1]!);
        break;
      case 'ArrowRight':
        if (row.hasSubfolders && !row.expanded) onToggle(row.path, true);
        else if (row.expanded && rows[i + 1]?.level === row.level + 1) {
          focusRow(e.currentTarget, keys[i + 1]!);
        }
        break;
      case 'ArrowLeft':
        if (row.expanded && row.hasSubfolders) onToggle(row.path, false);
        else if (row.path !== '') focusRow(e.currentTarget, pathKey(parentPath(row.path)));
        break;
      case 'Enter':
      case ' ':
        onSelect(row.path);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <ul role="tree" aria-label="Folders" className={styles.tree} onKeyDown={onKeyDown}>
      {rows.map((r) => {
        const key = pathKey(r.path);
        const d = props.diff?.get(key);
        const isSelected = key === pathKey(selected);
        return (
          <li
            key={key}
            data-rowkey={key}
            role="treeitem"
            className={styles.treeItem}
            aria-level={r.level}
            aria-posinset={r.posInSet}
            aria-setsize={r.setSize}
            aria-selected={isSelected}
            aria-expanded={r.hasSubfolders ? r.expanded : undefined}
            tabIndex={key === current ? 0 : -1}
            onFocus={() => setFocusKey(key)}
            onClick={() => {
              setFocusKey(key);
              onSelect(r.path);
            }}
          >
            <span
              className={cx(styles.treeLabel, props.active?.has(key) && styles.active)}
              style={{ paddingLeft: `${String((r.level - 1) * 0.875 + 0.25)}rem` }}
            >
              <span
                className={styles.twisty}
                aria-hidden="true"
                onClick={(e) => {
                  if (!r.hasSubfolders) return;
                  e.stopPropagation();
                  onToggle(r.path, !r.expanded);
                }}
              >
                {r.hasSubfolders ? (r.expanded ? '▾' : '▸') : ''}
              </span>
              <span aria-hidden="true">📁</span>
              <span>{r.path === '' ? 'Top folder' : r.node.name}</span>
              {props.active?.has(key) && <ActiveMarker />}
              {d && d.kind !== 'deleted' && <DiffBadge diff={d} />}
              <Tags tags={(props.pathTags ?? NO_TAGS).get(key) ?? []} indexTags={[]} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
