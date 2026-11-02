/**
 * Scenario editor mode (task E.7, Req 5.4): add, rename and delete items (folders recursively),
 * edit a text file's content or a binary file's size, and edit modified dates. Every change is
 * emitted as a new, sorted, immutable `SandboxFS`; names follow `checkName` plus
 * case-insensitive uniqueness, with plain-language inline errors.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { FsNode, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import { getNode } from '../../domains/fileExplorer/fsTypes.ts';
import type { Diff } from '../lib/diff.ts';
import { canonicalPath, latestModified } from '../lib/explorer.ts';
import { fromDateTimeInput, toDateTimeInput } from '../lib/format.ts';
import { baseName, parentPath, pathKey } from '../lib/paths.ts';
import { folderRows } from '../lib/rows.ts';
import {
  addNode,
  deleteNode,
  renameNode,
  setBinarySize,
  setModified,
  setTextContent,
  validateName,
  type EditResult,
} from '../lib/treeEdit.ts';
import { Explorer, folderTitle, useExplorerState } from './Explorer.tsx';
import { cx } from './Badges.tsx';
import styles from '../Playground.module.css';

export interface ScenarioEditorProps {
  fs: SandboxFS;
  onChange: (fs: SandboxFS) => void;
}

const NO_DIFF: Diff = new Map();

export function ScenarioEditor({ fs, onChange }: ScenarioEditorProps) {
  const explorer = useExplorerState(fs, null, null);
  const [itemPath, setItemPath] = useState<string | null>(null);
  /** Tree item to focus after the next tree change (a delete unmounts the focused button). */
  const focusPathRef = useRef<string | null>(null);
  const [focusName, setFocusName] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const item = itemPath !== null ? canonicalPath(fs, itemPath) : null;
  const target = item ?? explorer.folder;
  const rows = folderRows(fs, explorer.folder, NO_DIFF, null);
  useEffect(() => {
    const focusPath = focusPathRef.current;
    if (focusPath === null) return;
    // One-shot: later edits (which also change `fs`) must not pull focus back to the tree.
    focusPathRef.current = null;
    const key = pathKey(focusPath);
    [...(editorRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])]
      .find((el) => el.dataset['rowkey'] === key)
      ?.focus();
  }, [fs]);

  const apply: Apply = (r, select) => {
    if (!r.ok) return r.error;
    onChange(r.fs);
    if (select === 'result') {
      // Renaming the open folder itself keeps it open under its new name.
      if (item === null) explorer.select(r.path);
      else setItemPath(r.path);
    }
    if (select === 'item') setItemPath(r.path);
    if (select === 'none') setItemPath(null);
    return null;
  };

  return (
    <div ref={editorRef} className={styles.editor}>
      <p className={styles.hint}>
        Editing the starting files. Choose a folder on the left, then pick an item to change it.
      </p>
      <Explorer
        fs={fs}
        state={{
          ...explorer,
          select: (p) => {
            explorer.select(p);
            setItemPath(null);
          },
        }}
        rows={rows}
        listMode={null}
        selectedKey={item !== null ? pathKey(item) : null}
        onActivate={(row) => {
          if (row.path !== null) setItemPath(row.path);
        }}
        activateHint="Press Enter or Space to edit this item. On a folder, ArrowRight opens it; ArrowLeft or Backspace goes to its parent."
      />
      <AddForm
        key={`add:${pathKey(explorer.folder)}`}
        fs={fs}
        folder={explorer.folder}
        onAdd={(node) => apply(addNode(fs, explorer.folder, node), 'item')}
      />
      <ItemForm
        key={`item:${pathKey(target)}`}
        fs={fs}
        path={target}
        apply={apply}
        onDeleteFocus={(path) => (focusPathRef.current = parentPath(path))}
        focusName={focusName}
        onFocusedName={() => setFocusName(false)}
        onRenamed={() => setFocusName(true)}
      />
    </div>
  );
}

type NewKind = 'text' | 'binary' | 'folder';
/** Applies an edit; returns the error to show, or null. select picks what to select after. */
type Apply = (r: EditResult, select?: 'result' | 'item' | 'none') => string | null;

function AddForm(props: { fs: SandboxFS; folder: string; onAdd: (node: FsNode) => string | null }) {
  const id = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NewKind>('text');
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const live = tried || name !== '' ? validateName(props.fs, props.folder, name) : null;
  const shown = error ?? live;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    const modified = latestModified(props.fs);
    const node: FsNode =
      kind === 'folder'
        ? { type: 'folder', name, modified, children: [] }
        : kind === 'text'
          ? { type: 'file', name, modified, content: '' }
          : { type: 'file', name, modified, binarySize: 0 };
    const problem = props.onAdd(node);
    setError(problem);
    if (problem === null) {
      setName('');
      setTried(false);
    }
  };

  return (
    <form className={cx(styles.surface, styles.form)} onSubmit={submit} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={styles.heading}>
        Add to {folderTitle(props.folder)}
      </h3>
      <div className={styles.field}>
        <label htmlFor={`${id}-kind`}>Kind</label>
        <select
          id={`${id}-kind`}
          className={styles.select}
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value as NewKind)}
        >
          <option value="text">Text file</option>
          <option value="binary">Binary file (e.g. a photo)</option>
          <option value="folder">Folder</option>
        </select>
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          className={styles.input}
          value={name}
          aria-invalid={shown !== null}
          aria-describedby={shown !== null ? `${id}-err` : undefined}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setError(null);
          }}
        />
        <button type="submit" className={cx(styles.button, styles.primary)}>
          Add
        </button>
      </div>
      {shown !== null && (
        <p id={`${id}-err`} className={styles.fieldError} role="alert">
          {shown}
        </p>
      )}
    </form>
  );
}

function ItemForm(props: {
  fs: SandboxFS;
  path: string;
  apply: Apply;
  onDeleteFocus?: (path: string) => void;
  /** Focus the name field on mount (set by a rename, which re-mounts the form). */
  focusName?: boolean;
  onFocusedName?: () => void;
  onRenamed?: () => void;
}) {
  const { fs, path, apply } = props;
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const node = getNode(fs, path);
  const [name, setName] = useState(node?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [date, setDate] = useState(node ? toDateTimeInput(node.modified) : '');
  const [dateError, setDateError] = useState<string | null>(null);
  const [content, setContent] = useState(node?.type === 'file' ? (node.content ?? '') : '');
  const [size, setSize] = useState(
    node?.type === 'file' && node.content === undefined ? String(node.binarySize ?? 0) : '',
  );
  const [sizeError, setSizeError] = useState<string | null>(null);
  useEffect(() => {
    // Only after a rename (the form re-mounts under the new path); never when the user is
    // just moving through the tree or the list.
    if (props.focusName) {
      nameRef.current?.focus();
      props.onFocusedName?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  if (!node) return null;

  const isRoot = path === '';
  const liveName =
    !isRoot && name !== node.name ? validateName(fs, parentPath(path), name, path) : null;
  const shownName = nameError ?? liveName;
  const title = isRoot
    ? 'Top folder'
    : `${node.type === 'folder' ? 'Folder' : 'File'} ${node.name}`;

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (name === node.name) return;
    const error = apply(renameNode(fs, path, name), 'result');
    if (error === null) props.onRenamed?.();
    setNameError(error);
  };

  return (
    <section className={cx(styles.surface, styles.form)} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={styles.heading}>
        Edit {title}
      </h3>
      {!isRoot && (
        <form className={styles.field} onSubmit={rename}>
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            ref={nameRef}
            className={styles.input}
            value={name}
            aria-invalid={shownName !== null}
            aria-describedby={shownName !== null ? `${id}-name-err` : undefined}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setNameError(null);
            }}
          />
          <button type="submit" className={styles.button} disabled={name === node.name}>
            Rename
          </button>
        </form>
      )}
      {shownName !== null && (
        <p id={`${id}-name-err`} className={styles.fieldError} role="alert">
          {shownName}
        </p>
      )}
      <div className={styles.field}>
        <label htmlFor={`${id}-date`}>Modified (UTC)</label>
        <input
          id={`${id}-date`}
          type="datetime-local"
          className={styles.input}
          value={date}
          aria-invalid={dateError !== null}
          aria-describedby={dateError !== null ? `${id}-date-err` : undefined}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setDate(v);
            const secs = fromDateTimeInput(v);
            setDateError(
              secs === null
                ? 'Please enter a valid date and time.'
                : apply(setModified(fs, path, secs)),
            );
          }}
        />
      </div>
      {dateError !== null && (
        <p id={`${id}-date-err`} className={styles.fieldError} role="alert">
          {dateError}
        </p>
      )}
      {node.type === 'file' && node.content !== undefined && (
        <div className={styles.form}>
          <label htmlFor={`${id}-content`}>Text content</label>
          <textarea
            id={`${id}-content`}
            className={styles.textarea}
            value={content}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setContent(v);
              apply(setTextContent(fs, path, v));
            }}
          />
        </div>
      )}
      {node.type === 'file' && node.content === undefined && (
        <>
          <div className={styles.field}>
            <label htmlFor={`${id}-size`}>Size in bytes</label>
            <input
              id={`${id}-size`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className={styles.input}
              value={size}
              aria-invalid={sizeError !== null}
              aria-describedby={sizeError !== null ? `${id}-size-err` : undefined}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setSize(v);
                const n = v.trim() === '' ? NaN : Number(v);
                setSizeError(apply(setBinarySize(fs, path, n)));
              }}
            />
          </div>
          {sizeError !== null && (
            <p id={`${id}-size-err`} className={styles.fieldError} role="alert">
              {sizeError}
            </p>
          )}
        </>
      )}
      {!isRoot && (
        <div className={styles.field}>
          <button
            type="button"
            className={cx(styles.button, styles.danger)}
            onClick={() => {
              props.onDeleteFocus?.(path);
              apply(deleteNode(fs, path), 'none');
            }}
          >
            {node.type === 'folder'
              ? `Delete ${baseName(path)} and everything inside`
              : `Delete ${baseName(path)}`}
          </button>
        </div>
      )}
    </section>
  );
}
