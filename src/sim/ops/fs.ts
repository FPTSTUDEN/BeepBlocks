/** File-system ops over the immutable sandbox FS (design.md §5.3, §5.6). */
import * as sfs from '../../domains/fileExplorer/fs.ts';
import { pyBool, pyInt, pyList, pyPath, pyText } from '../pyvalues.ts';
import { path, text, unwrap, type OpImpl } from './types.ts';

const paths = (ps: string[]) => pyList(ps.map(pyPath));

export const FS_OPS = {
  'fs.root': () => ({ value: pyPath('') }),
  'fs.join': (_c, a) => ({ value: pyPath(unwrap(sfs.pathJoin(path(a, 0), text(a, 1))).value) }),
  'fs.parent': (_c, a) => ({ value: pyPath(unwrap(sfs.pathParent(path(a, 0))).value) }),
  'fs.name': (_c, a) => ({ value: pyText(sfs.pathName(path(a, 0))) }),
  'fs.stem': (_c, a) => ({ value: pyText(sfs.pathStem(path(a, 0))) }),
  'fs.ext': (_c, a) => ({ value: pyText(sfs.pathExt(path(a, 0))) }),

  // ------------------------------------------------------------------ reads
  'fs.exists': (c, a) => {
    const p = path(a, 0);
    return { value: pyBool(sfs.exists(c.fs, p)), readPaths: [p] };
  },
  'fs.isFolder': (c, a) => {
    const p = path(a, 0);
    return { value: pyBool(unwrap(sfs.isFolder(c.fs, p)).value), readPaths: [p] };
  },
  'fs.list': (c, a) => {
    const p = path(a, 0);
    return { value: paths(unwrap(sfs.list(c.fs, p)).value), readPaths: [p] };
  },
  'fs.walk': (c, a) => {
    const p = path(a, 0);
    return { value: paths(unwrap(sfs.walk(c.fs, p)).value), readPaths: [p] };
  },
  'fs.size': (c, a) => {
    const p = path(a, 0);
    return { value: pyInt(unwrap(sfs.size(c.fs, p)).value), readPaths: [p] };
  },
  'fs.modified': (c, a) => {
    const p = path(a, 0);
    return { value: pyInt(unwrap(sfs.modified(c.fs, p)).value), readPaths: [p] };
  },
  'fs.readText': (c, a) => {
    const p = path(a, 0);
    return { value: pyText(unwrap(sfs.readText(c.fs, p)).value), readPaths: [p] };
  },

  // -------------------------------------------------------------- mutations
  'fs.writeText': (c, a) => {
    const p = path(a, 0);
    const r = unwrap(sfs.writeText(c.fs, p, text(a, 1), c.now));
    return { value: null, fs: r.fs, action: { op: 'WRITE', from: p, destructive: true } };
  },
  'fs.makeFolder': (c, a) => {
    const p = path(a, 0);
    const r = unwrap(sfs.makeFolder(c.fs, p, c.now));
    return { value: null, fs: r.fs, action: { op: 'MKDIR', from: p, destructive: false } };
  },
  'fs.rename': (c, a) => {
    const p = path(a, 0);
    const r = unwrap(sfs.rename(c.fs, p, text(a, 1)));
    return {
      value: pyPath(r.value),
      fs: r.fs,
      action: { op: 'RENAME', from: p, to: r.value, destructive: false },
    };
  },
  'fs.move': (c, a) => {
    const p = path(a, 0);
    const r = unwrap(sfs.move(c.fs, p, path(a, 1)));
    return {
      value: pyPath(r.value),
      fs: r.fs,
      action: { op: 'MOVE', from: p, to: r.value, destructive: false },
    };
  },
  'fs.copy': (c, a) => {
    const p = path(a, 0);
    const r = unwrap(sfs.copy(c.fs, p, path(a, 1)));
    return {
      value: pyPath(r.value),
      fs: r.fs,
      action: { op: 'COPY', from: p, to: r.value, destructive: false },
    };
  },
  'fs.delete': (c, a) => {
    const p = path(a, 0);
    const r = unwrap(sfs.remove(c.fs, p));
    return { value: null, fs: r.fs, action: { op: 'DELETE', from: p, destructive: true } };
  },
} satisfies Record<string, OpImpl>;
