/**
 * Immutable sandbox file system (design.md §5.3, §5.6, §7.1).
 *
 * Every function is pure. Mutations return a new `SandboxFS` that shares every subtree not on
 * the root→changed-node path. Lookups resolve each segment case-insensitively; folder children
 * stay sorted with `compareNames` and unique case-insensitively.
 *
 * Mutations that set a modified time (`writeText`, `makeFolder`) take the simulation clock
 * value `now` from the caller (see `initialClock`).
 */
import type { ErrorCode } from '../../ir/errors.ts';
import {
  checkName,
  compareNames,
  fileSize,
  getNode,
  joinPath,
  splitPath,
  type FsFile,
  type FsFolder,
  type FsNode,
  type SandboxFS,
} from './fsTypes.ts';

export type FsFail = { ok: false; code: ErrorCode; message: string };
export type FsRead<T> = { ok: true; value: T } | FsFail;
export type FsWrite<T = null> = { ok: true; fs: SandboxFS; value: T } | FsFail;

const fail = (code: ErrorCode, message: string): FsFail => ({ ok: false, code, message });
const read = <T>(value: T): FsRead<T> => ({ ok: true, value });
const wrote = <T>(fs: SandboxFS, value: T): FsWrite<T> => ({ ok: true, fs, value });

/** `.` for the root, otherwise the relative POSIX path (Python `str(path)`). */
export function displayPath(path: string): string {
  return path === '' ? '.' : path;
}

const q = (path: string) => `"${displayPath(path)}"`;

// ====================================================================== Paths

/** Last segment of a path string ('' for the root). Never touches the disk. */
export function pathName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** Parent path string ('' for top-level items). Callers must reject the root first. */
export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** pathlib `stem` of the last segment: `report.final.pdf` → `report.final`, `.bashrc` → `.bashrc`. */
export function pathStem(path: string): string {
  const name = pathName(path);
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(0, i) : name;
}

/** pathlib `suffix` of the last segment without the dot, original case; '' if none. */
export function pathExt(path: string): string {
  const name = pathName(path);
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1) : '';
}

/** Case-insensitive path equality (design.md §5.3). */
export function pathEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** `fs.join`: validates `name`, does not check existence. */
export function pathJoin(folder: string, name: string): FsRead<string> {
  const problem = checkName(name);
  if (problem) return fail('INVALID_NAME', problem);
  return read(joinPath(folder, name));
}

/** `fs.parent`: the root has no parent inside the sandbox. */
export function pathParent(path: string): FsRead<string> {
  if (path === '') return fail('OUTSIDE_ROOT', 'The chosen folder has no parent you can use.');
  return read(parentPath(path));
}

// ====================================================================== Reads

export function resolve(fs: SandboxFS, path: string): FsNode | undefined {
  return getNode(fs, path);
}

export function exists(fs: SandboxFS, path: string): boolean {
  return getNode(fs, path) !== undefined;
}

const notFound = (path: string) => fail('NOT_FOUND', `${q(path)} does not exist.`);

export function isFolder(fs: SandboxFS, path: string): FsRead<boolean> {
  const node = getNode(fs, path);
  if (!node) return notFound(path);
  return read(node.type === 'folder');
}

function folderAt(fs: SandboxFS, path: string): FsRead<FsFolder> {
  const node = getNode(fs, path);
  if (!node) return notFound(path);
  if (node.type !== 'folder') return fail('NOT_A_FOLDER', `${q(path)} is a file, not a folder.`);
  return read(node);
}

function fileAt(fs: SandboxFS, path: string): FsRead<FsFile> {
  const node = getNode(fs, path);
  if (!node) return notFound(path);
  if (node.type !== 'file') return fail('NOT_A_FILE', `${q(path)} is a folder, not a file.`);
  return read(node);
}

/** Direct children, as `path` joined with each stored name, in folder order. */
export function list(fs: SandboxFS, path: string): FsRead<string[]> {
  const r = folderAt(fs, path);
  if (!r.ok) return r;
  return read(r.value.children.map((c) => joinPath(path, c.name)));
}

/** All files below `path`, pre-order, children in `list` order. Folders are not yielded. */
export function walk(fs: SandboxFS, path: string): FsRead<string[]> {
  const r = folderAt(fs, path);
  if (!r.ok) return r;
  const out: string[] = [];
  const visit = (folder: FsFolder, at: string) => {
    for (const c of folder.children) {
      const p = joinPath(at, c.name);
      if (c.type === 'file') out.push(p);
      else visit(c, p);
    }
  };
  visit(r.value, path);
  return read(out);
}

export function size(fs: SandboxFS, path: string): FsRead<number> {
  const r = fileAt(fs, path);
  return r.ok ? read(fileSize(r.value)) : r;
}

export function modified(fs: SandboxFS, path: string): FsRead<number> {
  const node = getNode(fs, path);
  return node ? read(node.modified) : notFound(path);
}

// A NUL byte or a lone surrogate (which has no UTF-8 encoding) makes content non-text.
const NOT_TEXT_RE = /\0|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function readText(fs: SandboxFS, path: string): FsRead<string> {
  const r = fileAt(fs, path);
  if (!r.ok) return r;
  const content = r.value.content;
  if (content === undefined || NOT_TEXT_RE.test(content)) {
    return fail('NOT_TEXT', `${q(path)} is not a text file.`);
  }
  return read(content);
}

// ================================================================== Mutation

/** Inserts or replaces `child` (matched case-insensitively), keeping children sorted. */
function putChild(folder: FsFolder, child: FsNode, replacing?: FsNode): FsFolder {
  const lower = child.name.toLowerCase();
  const kept = folder.children.filter((c) =>
    replacing ? c !== replacing : c.name.toLowerCase() !== lower,
  );
  const children = [...kept, child].sort((a, b) => compareNames(a.name, b.name));
  return { ...folder, children };
}

function dropChild(folder: FsFolder, child: FsNode): FsFolder {
  return { ...folder, children: folder.children.filter((c) => c !== child) };
}

/** Replaces the folder at `path` (which must exist) by `fn(folder)`, copying only the spine. */
function updateFolder(fs: SandboxFS, path: string, fn: (f: FsFolder) => FsFolder): SandboxFS {
  const go = (folder: FsFolder, segs: string[]): FsFolder => {
    if (segs.length === 0) return fn(folder);
    const [head, ...rest] = segs;
    const lower = head!.toLowerCase();
    const child = folder.children.find((c) => c.name.toLowerCase() === lower);
    if (!child || child.type !== 'folder') throw new Error(`updateFolder: no folder at ${path}`);
    const next = go(child, rest);
    return { ...folder, children: folder.children.map((c) => (c === child ? next : c)) };
  };
  return { root: go(fs.root, splitPath(path)) };
}

/** Parent of `path` as an existing folder, or NOT_FOUND. */
function parentFolder(fs: SandboxFS, path: string): FsRead<FsFolder> {
  const parent = getNode(fs, parentPath(path));
  if (!parent || parent.type !== 'folder') {
    return fail('NOT_FOUND', `The folder for ${q(path)} does not exist.`);
  }
  return read(parent);
}

/** Create or overwrite a text file. An existing file keeps its stored name. */
export function writeText(fs: SandboxFS, path: string, text: string, now: number): FsWrite {
  if (path === '') return fail('ROOT_PROTECTED', 'The chosen folder itself cannot be written to.');
  const parent = parentFolder(fs, path);
  if (!parent.ok) return parent;
  const existing = getNode(fs, path);
  if (existing?.type === 'folder') {
    return fail('NOT_A_FILE', `${q(path)} is a folder, so text cannot be written into it.`);
  }
  const file: FsFile = {
    type: 'file',
    name: existing?.name ?? pathName(path),
    modified: now,
    content: text,
  };
  return wrote(
    updateFolder(fs, parentPath(path), (f) => putChild(f, file, existing)),
    null,
  );
}

export function makeFolder(fs: SandboxFS, path: string, now: number): FsWrite {
  if (path === '') return fail('ALREADY_EXISTS', 'The chosen folder already exists.');
  const parent = parentFolder(fs, path);
  if (!parent.ok) return parent;
  if (getNode(fs, path)) return fail('ALREADY_EXISTS', `${q(path)} already exists.`);
  const folder: FsFolder = { type: 'folder', name: pathName(path), modified: now, children: [] };
  return wrote(
    updateFolder(fs, parentPath(path), (f) => putChild(f, folder)),
    null,
  );
}

/** Rename within the same folder. Returns the parent of `path` joined with `newName`. */
export function rename(fs: SandboxFS, path: string, newName: string): FsWrite<string> {
  const problem = checkName(newName);
  if (problem) return fail('INVALID_NAME', problem);
  const node = getNode(fs, path);
  if (!node) return notFound(path);
  if (path === '') return fail('ROOT_PROTECTED', 'The chosen folder itself cannot be renamed.');
  const parent = getNode(fs, parentPath(path)) as FsFolder;
  const lower = newName.toLowerCase();
  const clash = parent.children.find((c) => c !== node && c.name.toLowerCase() === lower);
  if (clash) {
    return fail('ALREADY_EXISTS', `There is already an item named "${clash.name}" there.`);
  }
  const renamed: FsNode = { ...node, name: newName };
  return wrote(
    updateFolder(fs, parentPath(path), (f) => putChild(f, renamed, node)),
    joinPath(parentPath(path), newName),
  );
}

type Transfer = { node: FsNode; dest: FsFolder };

/** Shared precondition checks of move and copy (design.md §5.6 check order). */
function checkTransfer(
  fs: SandboxFS,
  src: string,
  dest: string,
  verb: 'moved' | 'copied',
): FsRead<Transfer> {
  const node = getNode(fs, src);
  if (!node) return notFound(src);
  if (src === '') return fail('ROOT_PROTECTED', `The chosen folder itself cannot be ${verb}.`);
  const target = getNode(fs, dest);
  if (!target) return notFound(dest);
  if (target.type !== 'folder') return fail('NOT_A_FOLDER', `${q(dest)} is a file, not a folder.`);
  const ls = src.toLowerCase();
  const ld = dest.toLowerCase();
  if (ld === ls || ld.startsWith(`${ls}/`)) {
    return fail('INVALID_MOVE', `A folder cannot be ${verb} into itself.`);
  }
  const lower = node.name.toLowerCase();
  if (target.children.some((c) => c.name.toLowerCase() === lower)) {
    return fail('ALREADY_EXISTS', `${q(joinPath(dest, node.name))} already exists.`);
  }
  return read({ node, dest: target });
}

/** Move into folder `dest`. Returns `dest` joined with the item's stored name. Keeps mtimes. */
export function move(fs: SandboxFS, src: string, dest: string): FsWrite<string> {
  const r = checkTransfer(fs, src, dest, 'moved');
  if (!r.ok) return r;
  const { node } = r.value;
  const removed = updateFolder(fs, parentPath(src), (f) => dropChild(f, node));
  return wrote(
    updateFolder(removed, dest, (f) => putChild(f, node)),
    joinPath(dest, node.name),
  );
}

/**
 * Deep copy into folder `dest`, preserving every modified time (`shutil.copy2`/`copytree`).
 * Nodes are immutable, so the copied subtree can be shared structurally.
 */
export function copy(fs: SandboxFS, src: string, dest: string): FsWrite<string> {
  const r = checkTransfer(fs, src, dest, 'copied');
  if (!r.ok) return r;
  const { node } = r.value;
  return wrote(
    updateFolder(fs, dest, (f) => putChild(f, node)),
    joinPath(dest, node.name),
  );
}

/** Delete a file or an empty folder. */
export function remove(fs: SandboxFS, path: string): FsWrite {
  const node = getNode(fs, path);
  if (!node) return notFound(path);
  if (path === '') return fail('ROOT_PROTECTED', 'The chosen folder itself cannot be deleted.');
  if (node.type === 'folder' && node.children.length > 0) {
    return fail('NOT_EMPTY', `${q(path)} is not empty; only empty folders can be deleted.`);
  }
  return wrote(
    updateFolder(fs, parentPath(path), (f) => dropChild(f, node)),
    null,
  );
}

// ================================================================== Helpers

/** Simulation clock start: the latest modified time in the tree plus 60 seconds. */
export function initialClock(fs: SandboxFS): number {
  let max = fs.root.modified;
  const visit = (n: FsNode) => {
    if (n.modified > max) max = n.modified;
    if (n.type === 'folder') n.children.forEach(visit);
  };
  visit(fs.root);
  return max + 60;
}

/** Returns a copy with every folder's children sorted (for loading user-provided trees). */
export function sortTree(fs: SandboxFS): SandboxFS {
  const norm = (n: FsNode): FsNode =>
    n.type === 'folder'
      ? { ...n, children: n.children.map(norm).sort((a, b) => compareNames(a.name, b.name)) }
      : n;
  return { root: norm(fs.root) as FsFolder };
}

/**
 * Checks the tree invariants: valid names, case-insensitive unique and sorted children,
 * integer mtimes, and exactly one of `content` / `binarySize` per file.
 * Returns plain-language problems (empty = valid).
 */
export function checkTree(fs: SandboxFS): string[] {
  const problems: string[] = [];
  const visit = (n: FsNode, at: string, isRoot: boolean) => {
    const where = isRoot ? 'the root folder' : q(at);
    if (!isRoot) {
      const problem = checkName(n.name);
      if (problem) problems.push(`${where}: ${problem}`);
    }
    if (!Number.isSafeInteger(n.modified)) {
      problems.push(`${where}: modified time must be whole epoch seconds.`);
    }
    if (n.type === 'file') {
      const hasContent = n.content !== undefined;
      const hasBinary = n.binarySize !== undefined;
      if (hasContent === hasBinary) {
        problems.push(`${where}: a file needs exactly one of content or binarySize.`);
      }
      if (hasBinary && !(Number.isSafeInteger(n.binarySize) && n.binarySize! >= 0)) {
        problems.push(`${where}: binarySize must be a whole number of bytes.`);
      }
      return;
    }
    const seen = new Set<string>();
    n.children.forEach((c, i) => {
      const lower = c.name.toLowerCase();
      if (seen.has(lower)) problems.push(`${where}: two items are named "${c.name}".`);
      seen.add(lower);
      const prev = n.children[i - 1];
      if (prev && compareNames(prev.name, c.name) >= 0) {
        problems.push(`${where}: children are not sorted ("${prev.name}" before "${c.name}").`);
      }
      visit(c, joinPath(at, c.name), false);
    });
  };
  visit(fs.root, '', true);
  return problems;
}
