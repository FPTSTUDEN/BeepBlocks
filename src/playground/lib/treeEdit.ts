/**
 * Immutable scenario-tree edits for the scenario editor (Req 5.4, task E.7).
 * Every edit returns a new `SandboxFS` with children sorted by `compareNames`, or a
 * plain-language error. Deleting a folder here is recursive (editor only; `fs.delete` is not).
 */
import type { FsFile, FsFolder, FsNode, SandboxFS } from '../../domains/fileExplorer/fsTypes.ts';
import {
  checkName,
  compareNames,
  getNode,
  joinPath,
  splitPath,
} from '../../domains/fileExplorer/fsTypes.ts';
import { baseName, parentPath } from './paths.ts';

export type EditResult = { ok: true; fs: SandboxFS; path: string } | { ok: false; error: string };

const fail = (error: string): EditResult => ({ ok: false, error });

function sorted(children: readonly FsNode[]): FsNode[] {
  return [...children].sort((a, b) => compareNames(a.name, b.name));
}

/** Rebuilds the folder at `folderPath` with `fn`, copying only the nodes along the path. */
function updateFolder(
  fs: SandboxFS,
  folderPath: string,
  fn: (f: FsFolder) => FsFolder,
): SandboxFS | null {
  const go = (f: FsFolder, segs: string[]): FsFolder | null => {
    if (segs.length === 0) {
      const next = fn(f);
      return { ...next, children: sorted(next.children) };
    }
    const [head, ...rest] = segs as [string, ...string[]];
    const lower = head.toLowerCase();
    const idx = f.children.findIndex((c) => c.name.toLowerCase() === lower);
    const child = f.children[idx];
    if (!child || child.type !== 'folder') return null;
    const updated = go(child, rest);
    if (!updated) return null;
    const children = [...f.children];
    children[idx] = updated;
    return { ...f, children };
  };
  const root = go(fs.root, splitPath(folderPath));
  return root ? { root } : null;
}

/**
 * Validates a new name for an item in `folderPath`. `selfPath` is the item being renamed:
 * a case-only rename of itself is allowed.
 */
export function validateName(
  fs: SandboxFS,
  folderPath: string,
  name: string,
  selfPath?: string,
): string | null {
  const problem = checkName(name);
  if (problem) return problem;
  const folder = getNode(fs, folderPath);
  if (!folder || folder.type !== 'folder') return 'That folder no longer exists.';
  const lower = name.toLowerCase();
  const selfLower = selfPath === undefined ? null : baseName(selfPath).toLowerCase();
  const clash = folder.children.find(
    (c) => c.name.toLowerCase() === lower && c.name.toLowerCase() !== selfLower,
  );
  if (clash) {
    return `"${clash.name}" already exists in this folder (names ignore upper/lower case).`;
  }
  return null;
}

/** Adds `node` (with its own name) inside the folder at `folderPath`. */
export function addNode(fs: SandboxFS, folderPath: string, node: FsNode): EditResult {
  const problem = validateName(fs, folderPath, node.name);
  if (problem) return fail(problem);
  const next = updateFolder(fs, folderPath, (f) => ({ ...f, children: [...f.children, node] }));
  return next
    ? { ok: true, fs: next, path: joinPath(folderPath, node.name) }
    : fail('That folder no longer exists.');
}

/** Renames the item at `path` (not the root). */
export function renameNode(fs: SandboxFS, path: string, newName: string): EditResult {
  if (path === '') return fail('The top folder cannot be renamed here.');
  const node = getNode(fs, path);
  if (!node) return fail('That item no longer exists.');
  const parent = parentPath(path);
  const problem = validateName(fs, parent, newName, path);
  if (problem) return fail(problem);
  const lower = node.name.toLowerCase();
  const next = updateFolder(fs, parent, (f) => ({
    ...f,
    children: f.children.map((c) => (c.name.toLowerCase() === lower ? { ...c, name: newName } : c)),
  }));
  return next
    ? { ok: true, fs: next, path: joinPath(parent, newName) }
    : fail('That item no longer exists.');
}

/** Deletes the item at `path`; folders are removed with everything inside them. */
export function deleteNode(fs: SandboxFS, path: string): EditResult {
  if (path === '') return fail('The top folder cannot be deleted.');
  if (!getNode(fs, path)) return fail('That item no longer exists.');
  const lower = baseName(path).toLowerCase();
  const next = updateFolder(fs, parentPath(path), (f) => ({
    ...f,
    children: f.children.filter((c) => c.name.toLowerCase() !== lower),
  }));
  return next ? { ok: true, fs: next, path } : fail('That item no longer exists.');
}

function replaceNode(fs: SandboxFS, path: string, fn: (n: FsNode) => FsNode): EditResult {
  if (path === '') {
    const root = fn(fs.root);
    if (root.type !== 'folder') return fail('The top folder must stay a folder.');
    return { ok: true, fs: { root }, path };
  }
  if (!getNode(fs, path)) return fail('That item no longer exists.');
  const lower = baseName(path).toLowerCase();
  const next = updateFolder(fs, parentPath(path), (f) => ({
    ...f,
    children: f.children.map((c) => (c.name.toLowerCase() === lower ? fn(c) : c)),
  }));
  return next ? { ok: true, fs: next, path } : fail('That item no longer exists.');
}

/** Sets the modified time (integer epoch seconds, UTC) of a file or folder. */
export function setModified(fs: SandboxFS, path: string, modified: number): EditResult {
  if (!Number.isInteger(modified)) return fail('Please enter a valid date and time.');
  return replaceNode(fs, path, (n) => ({ ...n, modified }));
}

/** Makes the file a text file with this content (its size becomes the UTF-8 length). */
export function setTextContent(fs: SandboxFS, path: string, content: string): EditResult {
  const node = getNode(fs, path);
  if (node?.type !== 'file') return fail('Only files have content.');
  return replaceNode(fs, path, (n): FsFile => ({
    type: 'file',
    name: n.name,
    modified: n.modified,
    content,
  }));
}

/** Makes the file an opaque (binary) file of `size` bytes. */
export function setBinarySize(fs: SandboxFS, path: string, size: number): EditResult {
  if (!Number.isSafeInteger(size) || size < 0) {
    return fail('Size must be a whole number of bytes, 0 or more.');
  }
  const node = getNode(fs, path);
  if (node?.type !== 'file') return fail('Only files have a size.');
  return replaceNode(fs, path, (n): FsFile => ({
    type: 'file',
    name: n.name,
    modified: n.modified,
    binarySize: size,
  }));
}

/** A name like "New file.txt", "New file 2.txt", … not yet used in the folder. */
export function freshName(fs: SandboxFS, folderPath: string, stem: string, ext = ''): string {
  for (let i = 1; i < 10_000; i++) {
    const name = `${stem}${i === 1 ? '' : ` ${i}`}${ext}`;
    if (validateName(fs, folderPath, name) === null) return name;
  }
  return `${stem}${ext}`;
}
