/**
 * Test-only mini evaluator for desugared (primitive) program bodies.
 *
 * NOT the simulator: it implements just enough of design.md §5 (the ops the composites emit,
 * path rules, list snapshots in forEach) to check desugarings behaviorally. Functions are not
 * supported. Errors are thrown as `MiniError` with the §5.5 code.
 */
import type { Expr, Program, Stmt } from '../../ir/types.ts';
import { isoDateToEpoch } from '../../ir/validate.ts';

export class MiniError extends Error {
  constructor(
    readonly code: string,
    readonly nodeId: string,
  ) {
    super(`${code} at ${nodeId}`);
  }
}

interface PathV {
  path: string;
}
type V = number | string | boolean | PathV | V[];

export interface MiniEntry {
  /** Relative POSIX path, e.g. 'docs/a.txt'. Parent folders are created automatically. */
  path: string;
  folder?: boolean;
  size?: number;
  modified?: number;
}

interface Entry {
  path: string;
  folder: boolean;
  size: number;
  modified: number;
}

const lower = (s: string) => s.toLowerCase();
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const join = (p: string, n: string) => (p === '' ? n : `${p}/${n}`);
const isPath = (v: V): v is PathV => typeof v === 'object' && !Array.isArray(v);

function splitName(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i + 1) };
}

function eq(a: V, b: V): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => eq(x, b[i]!));
  }
  if (isPath(a) && isPath(b)) return lower(a.path) === lower(b.path);
  return a === b;
}

class MiniFs {
  private readonly entries = new Map<string, Entry>();

  constructor(init: readonly MiniEntry[]) {
    for (const e of init) {
      const segs = e.path.split('/');
      for (let i = 1; i < segs.length; i++) {
        const p = segs.slice(0, i).join('/');
        if (!this.entries.has(lower(p))) {
          this.entries.set(lower(p), { path: p, folder: true, size: 0, modified: 0 });
        }
      }
      this.entries.set(lower(e.path), {
        path: e.path,
        folder: e.folder === true,
        size: e.size ?? 0,
        modified: e.modified ?? 0,
      });
    }
  }

  private entry(p: string, at: string): Entry {
    const e = this.entries.get(lower(p));
    if (!e) throw new MiniError('NOT_FOUND', at);
    return e;
  }
  exists(p: string): boolean {
    return p === '' || this.entries.has(lower(p));
  }
  isFolder(p: string, at: string): boolean {
    return p === '' || this.entry(p, at).folder;
  }
  list(p: string, at: string): string[] {
    if (!this.exists(p)) throw new MiniError('NOT_FOUND', at);
    if (!this.isFolder(p, at)) throw new MiniError('NOT_A_FOLDER', at);
    return [...this.entries.values()]
      .filter((e) => lower(parentOf(e.path)) === lower(p))
      .map((e) => nameOf(e.path))
      .sort((a, b) => (lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : a < b ? -1 : 1))
      .map((n) => join(p, n));
  }
  walk(p: string, at: string): string[] {
    return this.list(p, at).flatMap((c) => (this.isFolder(c, at) ? this.walk(c, at) : [c]));
  }
  size(p: string, at: string): number {
    const e = this.entry(p, at);
    if (e.folder) throw new MiniError('NOT_A_FILE', at);
    return e.size;
  }
  modified(p: string, at: string): number {
    return this.entry(p, at).modified;
  }
  storedName(p: string, at: string): string {
    return nameOf(this.entry(p, at).path);
  }
  private relocate(from: string, to: string, keep: boolean): void {
    const f = lower(from);
    for (const e of [...this.entries.values()]) {
      const lp = lower(e.path);
      if (lp !== f && !lp.startsWith(`${f}/`)) continue;
      const moved = { ...e, path: to + e.path.slice(from.length) };
      if (!keep) this.entries.delete(lp);
      this.entries.set(lower(moved.path), moved);
    }
  }
  rename(p: string, name: string, at: string): string {
    this.entry(p, at);
    const target = join(parentOf(p), name);
    if (this.exists(target) && lower(target) !== lower(p)) {
      throw new MiniError('ALREADY_EXISTS', at);
    }
    this.relocate(this.entry(p, at).path, target, false);
    return target;
  }
  moveOrCopy(p: string, dest: string, keep: boolean, at: string): string {
    const name = this.storedName(p, at);
    if (!this.exists(dest)) throw new MiniError('NOT_FOUND', at);
    if (!this.isFolder(dest, at)) throw new MiniError('NOT_A_FOLDER', at);
    const target = join(dest, name);
    if (this.exists(target)) throw new MiniError('ALREADY_EXISTS', at);
    this.relocate(this.entry(p, at).path, target, keep);
    return target;
  }
  delete(p: string, at: string): void {
    const e = this.entry(p, at);
    if (e.folder && this.list(p, at).length > 0) throw new MiniError('NOT_EMPTY', at);
    this.entries.delete(lower(p));
  }
  makeFolder(p: string, at: string): void {
    if (this.exists(p)) throw new MiniError('ALREADY_EXISTS', at);
    if (!this.exists(parentOf(p)) || !this.isFolder(parentOf(p), at)) {
      throw new MiniError('NOT_FOUND', at);
    }
    this.entries.set(lower(p), { path: p, folder: true, size: 0, modified: 0 });
  }
  /** Sorted stored paths; folders end with '/'. */
  snapshot(): string[] {
    return [...this.entries.values()]
      .map((e) => (e.folder ? `${e.path}/` : e.path))
      .sort((a, b) => (lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : 0));
  }
}

export interface MiniResult {
  tree: string[];
  output: string[];
  vars: Map<string, V>;
}

export function runMini(program: Program, init: readonly MiniEntry[]): MiniResult {
  const fs = new MiniFs(init);
  const vars = new Map<string, V>();
  const output: string[] = [];

  const p = (v: V): string => {
    if (!isPath(v)) throw new Error('expected a path');
    return v.path;
  };
  const n = (v: V): number => {
    if (typeof v !== 'number') throw new Error('expected a number');
    return v;
  };
  const t = (v: V): string => {
    if (typeof v !== 'string') throw new Error('expected text');
    return v;
  };
  const l = (v: V): V[] => {
    if (!Array.isArray(v)) throw new Error('expected a list');
    return v;
  };
  const str = (v: V): string =>
    typeof v === 'boolean' ? (v ? 'True' : 'False') : isPath(v) ? v.path || '.' : String(v);
  const path = (s: string): PathV => ({ path: s });

  const ev = (e: Expr): V => {
    switch (e.kind) {
      case 'lit':
        return e.value;
      case 'date':
        return isoDateToEpoch(e.iso)!;
      case 'list':
        return e.items.map(ev);
      case 'var': {
        const v = vars.get(e.name);
        if (v === undefined) throw new Error(`unset variable ${e.name}`);
        return v;
      }
      case 'unary':
        return e.op === 'not' ? !ev(e.arg) : -n(ev(e.arg));
      case 'binary': {
        if (e.op === 'and') return ev(e.left) === true && ev(e.right) === true;
        if (e.op === 'or') return ev(e.left) === true || ev(e.right) === true;
        const a = ev(e.left);
        const c = ev(e.right);
        switch (e.op) {
          case '==':
            return eq(a, c);
          case '!=':
            return !eq(a, c);
          case '<':
            return (a as number) < (c as number);
          case '<=':
            return (a as number) <= (c as number);
          case '>':
            return (a as number) > (c as number);
          case '>=':
            return (a as number) >= (c as number);
          case '+':
            if (Array.isArray(a)) return [...a, ...l(c)];
            return typeof a === 'string' ? a + t(c) : n(a) + n(c);
          case '-':
            return n(a) - n(c);
          case '*':
            return n(a) * n(c);
          case '//':
            return Math.floor(n(a) / n(c));
          case '%':
            return n(a) - n(c) * Math.floor(n(a) / n(c));
          case '/':
            return n(a) / n(c);
        }
        throw new Error('unreachable');
      }
      case 'call':
        throw new Error('functions are not supported by the mini evaluator');
      case 'compositeExpr':
        throw new Error('expression composites must be desugared first');
      case 'op': {
        const a = e.args.map(ev);
        const at = e.id;
        const x = (i: number): V => a[i]!;
        switch (e.op) {
          case 'fs.root':
            return path('');
          case 'fs.join':
            return path(join(p(x(0)), t(x(1))));
          case 'fs.parent':
            if (p(x(0)) === '') throw new MiniError('OUTSIDE_ROOT', at);
            return path(parentOf(p(x(0))));
          case 'fs.name':
            return nameOf(p(x(0)));
          case 'fs.stem':
            return splitName(nameOf(p(x(0)))).stem;
          case 'fs.ext':
            return splitName(nameOf(p(x(0)))).ext;
          case 'fs.exists':
            return fs.exists(p(x(0)));
          case 'fs.isFolder':
            return fs.isFolder(p(x(0)), at);
          case 'fs.list':
            return fs.list(p(x(0)), at).map(path);
          case 'fs.walk':
            return fs.walk(p(x(0)), at).map(path);
          case 'fs.size':
            return fs.size(p(x(0)), at);
          case 'fs.modified':
            return fs.modified(p(x(0)), at);
          case 'fs.makeFolder':
            fs.makeFolder(p(x(0)), at);
            return true;
          case 'fs.rename':
            return path(fs.rename(p(x(0)), t(x(1)), at));
          case 'fs.move':
            return path(fs.moveOrCopy(p(x(0)), p(x(1)), false, at));
          case 'fs.copy':
            return path(fs.moveOrCopy(p(x(0)), p(x(1)), true, at));
          case 'fs.delete':
            fs.delete(p(x(0)), at);
            return true;
          case 'text.from':
            return str(x(0));
          case 'text.lower':
            return t(x(0)).toLowerCase();
          case 'text.padNumber': {
            const s = String(n(x(0)));
            const w = n(x(1));
            return s.startsWith('-') ? `-${s.slice(1).padStart(w - 1, '0')}` : s.padStart(w, '0');
          }
          case 'text.date':
            return new Date(n(x(0)) * 1000).toISOString().slice(0, 10);
          case 'text.wildcard': {
            const re = t(x(1))
              .toLowerCase()
              .split('')
              .map((c) =>
                c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              )
              .join('');
            return new RegExp(`^${re}$`, 'su').test(t(x(0)).toLowerCase());
          }
          case 'list.length':
            return l(x(0)).length;
          case 'list.get': {
            const list = l(x(0));
            const i = n(x(1));
            if (i < 0 || i >= list.length) throw new MiniError('INDEX_OUT_OF_RANGE', at);
            return list[i]!;
          }
          case 'list.append':
            l(x(0)).push(x(1));
            return true;
          case 'list.contains':
            return l(x(0)).some((v) => eq(v, x(1)));
          case 'list.sortBy': {
            const key = t(x(1));
            const keyOf = (v: V): [number | string, string] => {
              const s = p(v);
              if (key === 'size') return [fs.size(s, at), ''];
              if (key === 'modified') return [fs.modified(s, at), ''];
              const part = key === 'ext' ? splitName(nameOf(s)).ext : nameOf(s);
              return [part.toLowerCase(), part];
            };
            const keyed = l(x(0)).map((v) => ({ v, k: keyOf(v) }));
            const sign = x(2) === true ? -1 : 1;
            keyed.sort((u, w) => {
              for (let i = 0; i < 2; i++) {
                const ui = u.k[i]!;
                const wi = w.k[i]!;
                if (ui < wi) return -sign;
                if (ui > wi) return sign;
              }
              return 0;
            });
            return keyed.map((k) => k.v);
          }
          default:
            throw new Error(`op ${e.op} is not supported by the mini evaluator`);
        }
      }
    }
  };

  const exec = (stmts: readonly Stmt[]): void => {
    for (const s of stmts) {
      switch (s.kind) {
        case 'assign':
          vars.set(s.name, ev(s.value));
          break;
        case 'if':
          exec(ev(s.cond) === true ? s.then : s.else);
          break;
        case 'while': {
          let guard = 0;
          while (ev(s.cond) === true) {
            if (++guard > 10_000) throw new MiniError('STEP_LIMIT', s.id);
            exec(s.body);
          }
          break;
        }
        case 'forEach':
          for (const v of [...l(ev(s.list))]) {
            vars.set(s.name, v);
            exec(s.body);
          }
          break;
        case 'do':
          ev(s.expr);
          break;
        case 'print':
          output.push(t(ev(s.value)));
          break;
        case 'return':
          throw new Error('return is not supported by the mini evaluator');
        case 'composite':
          throw new Error('composites must be desugared first');
      }
    }
  };

  exec(program.body);
  return { tree: fs.snapshot(), output, vars };
}
