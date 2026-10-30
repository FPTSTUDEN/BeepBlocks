/**
 * Real-disk helpers for the conformance suite: materialize a SandboxFS into a folder,
 * read a folder back, and diff two trees (design.md §11).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareNames,
  type FsFolder,
  type FsNode,
  type SandboxFS,
} from '../../src/domains/fileExplorer/fsTypes.ts';

/** Returns a copy of the tree with every folder's children sorted per design.md §5.3. */
export function normalizeTree(fs: SandboxFS): SandboxFS {
  const norm = (n: FsNode): FsNode =>
    n.type === 'folder'
      ? { ...n, children: [...n.children].map(norm).sort((a, b) => compareNames(a.name, b.name)) }
      : n;
  return { root: norm(fs.root) as FsFolder };
}

export function materialize(fs: SandboxFS, dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const write = (folder: FsFolder, at: string) => {
    for (const child of folder.children) {
      const p = join(at, child.name);
      if (child.type === 'folder') {
        mkdirSync(p);
        write(child, p);
      } else {
        const bytes =
          child.content !== undefined
            ? Buffer.from(child.content, 'utf8')
            : Buffer.alloc(child.binarySize ?? 0);
        writeFileSync(p, bytes);
      }
      // Folder mtimes are set after their children are written.
      utimesSync(p, child.modified, child.modified);
    }
  };
  write(fs.root, dir);
}

const decoder = new TextDecoder('utf-8', { fatal: true });

export function readTree(dir: string): SandboxFS {
  const read = (at: string, name: string): FsNode => {
    const st = statSync(at);
    const modified = Math.floor(st.mtimeMs / 1000);
    if (st.isDirectory()) {
      const children = readdirSync(at)
        .map((n) => read(join(at, n), n))
        .sort((a, b) => compareNames(a.name, b.name));
      return { type: 'folder', name, modified, children };
    }
    const bytes = readFileSync(at);
    if (!bytes.includes(0)) {
      try {
        return { type: 'file', name, modified, content: decoder.decode(bytes) };
      } catch {
        /* not UTF-8 → opaque */
      }
    }
    return { type: 'file', name, modified, binarySize: bytes.length };
  };
  return { root: read(dir, '') as FsFolder };
}

export interface TreeDiffOptions {
  /** Compare file mtimes, except for these relative paths. Folder mtimes are never compared. */
  compareMtimes?: { except: Set<string> };
}

/** Returns human-readable differences (empty = equal). Names are compared case-sensitively. */
export function diffTrees(expected: SandboxFS, actual: SandboxFS, opts: TreeDiffOptions = {}): string[] {
  const out: string[] = [];
  const walk = (e: FsFolder, a: FsFolder, path: string) => {
    const en = e.children.map((c) => c.name);
    const an = a.children.map((c) => c.name);
    for (const n of en) if (!an.includes(n)) out.push(`missing: ${join2(path, n)}`);
    for (const n of an) if (!en.includes(n)) out.push(`unexpected: ${join2(path, n)}`);
    for (const ec of e.children) {
      const ac = a.children.find((c) => c.name === ec.name);
      if (!ac) continue;
      const p = join2(path, ec.name);
      if (ec.type !== ac.type) {
        out.push(`${p}: expected ${ec.type}, got ${ac.type}`);
        continue;
      }
      if (ec.type === 'folder' && ac.type === 'folder') {
        walk(ec, ac, p);
        continue;
      }
      if (ec.type === 'file' && ac.type === 'file') {
        if (ec.content !== undefined || ac.content !== undefined) {
          if (ec.content !== ac.content) {
            out.push(`${p}: content differs: expected ${JSON.stringify(ec.content)}, got ${JSON.stringify(ac.content)}`);
          }
        } else if ((ec.binarySize ?? 0) !== (ac.binarySize ?? 0)) {
          out.push(`${p}: size differs: expected ${ec.binarySize}, got ${ac.binarySize}`);
        }
        if (opts.compareMtimes && !opts.compareMtimes.except.has(p) && ec.modified !== ac.modified) {
          out.push(`${p}: modified time differs: expected ${ec.modified}, got ${ac.modified}`);
        }
      }
    }
  };
  walk(expected.root, actual.root, '');
  return out;
}

const join2 = (a: string, b: string) => (a === '' ? b : `${a}/${b}`);
