/**
 * File list (tasks E.1–E.3, E.6): name, type icon, human size, UTC date, diff badge and tags.
 * In list view it shows a hinted list in list order with a 0-based position gutter and a final
 * "end = <length>" row. ARIA listbox with roving focus: ↑/↓/Home/End move, Enter/Space (or click)
 * activates; in folder view → opens the focused folder and ←/Backspace goes up a folder.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fileSize } from '../../domains/fileExplorer/fsTypes.ts';
import { fileKind, formatDate, humanSize } from '../lib/format.ts';
import type { FileRow } from '../lib/rows.ts';
import { ActiveMarker, DiffBadge, Tags, cx } from './Badges.tsx';
import styles from '../Playground.module.css';

export interface ListModeInfo {
  name: string;
  length: number;
  endTags: readonly string[];
}

export interface FileListProps {
  rows: readonly FileRow[];
  /** Accessible name of the list. */
  label: string;
  /** Set while a hinted list is shown (position gutter + end row). */
  listMode: ListModeInfo | null;
  /** Row key shown as selected (scenario editor). */
  selectedKey?: string | null;
  /** Click or Enter on a row. */
  onActivate: (row: FileRow) => void;
  /** Double-click on a folder row. */
  onOpenFolder?: (path: string) => void;
  /** Describes what activating does, e.g. "Show blocks that touched this item". */
  activateHint: string;
}

const END_KEY = '__end__';

/** Parent of a relative path ("a/b" → "a", "a" → ""), or null for the root itself. */
function parentOf(path: string): string | null {
  if (path === '') return null;
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** The `data-rowkey` of the row containing the event target, if any. */
export function keyOfTarget(target: EventTarget | null): string | null {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>('[data-rowkey]')?.dataset['rowkey'] ?? null;
}

export function FileList(props: FileListProps) {
  const { rows, listMode } = props;
  const keys = useMemo(
    () => [...rows.map((r) => r.key), ...(listMode ? [END_KEY] : [])],
    [rows, listMode],
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const previousKeys = useRef(keys);
  const listRef = useRef<HTMLUListElement>(null);
  const hintId = useId();
  const current =
    focusKey !== null && keys.includes(focusKey)
      ? focusKey
      : props.selectedKey && keys.includes(props.selectedKey)
        ? props.selectedKey
        : (keys[0] ?? null);

  const focusRow = (list: HTMLElement, key: string) => {
    setFocusKey(key);
    const items = list.querySelectorAll<HTMLElement>('[data-rowkey]');
    [...items].find((el) => el.dataset['rowkey'] === key)?.focus();
  };
  useEffect(() => {
    if (focusKey !== null && !keys.includes(focusKey) && keys.length > 0) {
      const oldIndex = previousKeys.current.indexOf(focusKey);
      const next = keys[Math.min(Math.max(oldIndex, 0), keys.length - 1)]!;
      setFocusKey(next);
      [...(listRef.current?.querySelectorAll<HTMLElement>('[data-rowkey]') ?? [])]
        .find((el) => el.dataset['rowkey'] === next)
        ?.focus();
    }
    previousKeys.current = keys;
  }, [focusKey, keys]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const own = keyOfTarget(e.target);
    const from = own !== null && keys.includes(own) ? own : current;
    const i = from === null ? -1 : keys.indexOf(from);
    switch (e.key) {
      case 'ArrowDown':
        if (i + 1 < keys.length) focusRow(e.currentTarget, keys[i + 1]!);
        break;
      case 'ArrowUp':
        if (i > 0) focusRow(e.currentTarget, keys[i - 1]!);
        break;
      case 'Home':
        focusRow(e.currentTarget, keys[0]!);
        break;
      case 'End':
        focusRow(e.currentTarget, keys.at(-1)!);
        break;
      case 'Enter': {
        const row = rows.find((r) => r.key === from);
        if (row) props.onActivate(row);
        break;
      }
      case ' ':
      case 'Spacebar': {
        const row = rows.find((r) => r.key === from);
        if (row) props.onActivate(row);
        break;
      }
      case 'ArrowRight': {
        // Folder view only: open the focused folder. In list view ←/→ stay timeline shortcuts.
        if (listMode) return;
        const row = rows.find((r) => r.key === from);
        if (row?.node?.type === 'folder' && !row.ghost && row.path !== null) {
          props.onOpenFolder?.(row.path);
        }
        break;
      }
      case 'ArrowLeft':
      case 'Backspace': {
        // Folder view only: go up from the folder being shown (the parent of any of its rows).
        if (listMode) return;
        const row = rows.find((r) => r.key === from);
        if (row?.path) {
          const shown = parentOf(row.path);
          if (shown !== null) {
            const up = parentOf(shown);
            if (up !== null) props.onOpenFolder?.(up);
          }
        }
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  if (keys.length === 0) {
    return <p className={styles.empty}>This folder is empty.</p>;
  }

  return (
    <>
      <div className={styles.listHeader} aria-hidden="true">
        <span>{listMode ? 'Pos' : ''}</span>
        <span>Name</span>
        <span>Size</span>
        <span>Modified (UTC)</span>
      </div>
      <p id={hintId} className={styles.srOnly}>
        {props.activateHint}
      </p>
      <ul
        ref={listRef}
        role="listbox"
        aria-label={props.label}
        aria-describedby={hintId}
        className={styles.fileList}
        onKeyDown={onKeyDown}
      >
        {rows.map((r) => (
          <Row
            key={r.key}
            row={r}
            listMode={listMode !== null}
            focusable={r.key === current}
            selected={props.selectedKey === r.key}
            onFocus={() => setFocusKey(r.key)}
            onActivate={() => {
              setFocusKey(r.key);
              props.onActivate(r);
            }}
            onOpen={
              r.node?.type === 'folder' && !r.ghost && r.path !== null && props.onOpenFolder
                ? () => props.onOpenFolder!(r.path!)
                : undefined
            }
          />
        ))}
        {listMode && (
          <li
            data-rowkey={END_KEY}
            role="option"
            aria-selected={false}
            aria-disabled="true"
            tabIndex={current === END_KEY ? 0 : -1}
            className={cx(styles.fileRow, styles.endRow)}
            onFocus={() => setFocusKey(END_KEY)}
            data-testid="end-row"
          >
            <span className={styles.gutter} aria-hidden="true">
              ⇥
            </span>
            <span className={styles.nameCell}>
              <span>{`end = ${String(listMode.length)}`}</span>
              <Tags tags={[]} indexTags={listMode.endTags} />
            </span>
            <span />
            <span />
          </li>
        )}
      </ul>
    </>
  );
}

interface RowProps {
  row: FileRow;
  listMode: boolean;
  focusable: boolean;
  selected: boolean;
  onFocus: () => void;
  onActivate: () => void;
  onOpen: (() => void) | undefined;
}

function Row({ row, listMode, focusable, selected, onFocus, onActivate, onOpen }: RowProps) {
  const node = row.node;
  const kind = node ? fileKind(node) : null;
  const name =
    listMode && row.path !== null ? row.path : (node?.name ?? row.path ?? row.text ?? '');
  return (
    <li
      data-rowkey={row.key}
      role="option"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      className={cx(styles.fileRow, row.active && styles.active, row.ghost && styles.ghost)}
      data-path={row.path ?? undefined}
      onFocus={onFocus}
      onClick={onActivate}
      onDoubleClick={onOpen}
    >
      <span className={styles.gutter}>
        {listMode && row.position !== undefined ? (
          <>
            <span className={styles.srOnly}>position </span>
            {row.position}
          </>
        ) : null}
      </span>
      <span className={styles.nameCell}>
        {kind && (
          <span role="img" aria-label={kind.label}>
            {kind.icon}
          </span>
        )}
        <span className={styles.name}>{name}</span>
        {row.path !== null && !node && <span className={styles.missing}>(missing)</span>}
        {row.active && <ActiveMarker />}
        {row.diff && <DiffBadge diff={row.diff} />}
        <Tags tags={row.tags} indexTags={row.indexTags} />
      </span>
      {/* The column header is aria-hidden, so each cell carries its own label for screen
          readers; the option's name is its text content, badges and tags included. */}
      <span className={styles.size}>
        {node?.type === 'file' && <span className={styles.srOnly}>, size </span>}
        {node?.type === 'file' ? humanSize(fileSize(node)) : node ? '—' : ''}
      </span>
      <span className={styles.date}>
        {node && <span className={styles.srOnly}>, modified </span>}
        {node ? formatDate(node.modified) : ''}
      </span>
    </li>
  );
}
