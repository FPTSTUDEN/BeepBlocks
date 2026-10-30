/**
 * Small relative-POSIX path helpers for the playground. Path equality is case-insensitive
 * (design.md §5.3), so every lookup key is the lowercased path.
 */

/** Lookup key for a path: case-insensitive equality. */
export function pathKey(path: string): string {
  return path.toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** True when `path` equals `ancestor` or lies inside it (case-insensitive). The root contains all. */
export function isWithin(path: string, ancestor: string): boolean {
  if (ancestor === '') return true;
  const p = pathKey(path);
  const a = pathKey(ancestor);
  return p === a || p.startsWith(`${a}/`);
}

/**
 * If `path` is `from` or inside it, returns the same location with the `from` prefix replaced
 * by `to`; otherwise null.
 */
export function rebase(path: string, from: string, to: string): string | null {
  if (!isWithin(path, from) || from === '') return null;
  return to + path.slice(from.length);
}

/** All ancestor folders of `path`, from the root ('') down to its parent. */
export function ancestorsOf(path: string): string[] {
  const out = [''];
  if (path === '') return [];
  const segs = path.split('/');
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'));
  return out;
}

/** Shown form of a path value: `.` for the root, otherwise `./rel`. */
export function displayPath(path: string): string {
  return path === '' ? '.' : `./${path}`;
}
