import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { b } from '../../ir/build.ts';
import { OPS, OP_NAMES, type OpName, type SigType } from '../../ir/ops.ts';
import { T, type Expr, type Program, type Type } from '../../ir/types.ts';
import { validateProgram } from '../../ir/validate.ts';
import { exportPython } from '../index.ts';
import { PY_OPS, RUNTIME_BODY, RUNTIME_IMPORTS } from './emit.ts';
import { renderRuntimeModule } from './runtimeModule.ts';
import { RUNTIME_PY } from './runtime.gen.ts';
import { pyCompileAll, pyCompileErrors } from './__testing__/python.ts';
import { CASES, ERROR_CASES } from './__testing__/programs.ts';
import { commentText, docstringText, pyNumber, pyString } from './pysyntax.ts';

const identity = (p: Program) => p;

function exported(program: Program, title = 'test'): string {
  const r = exportPython(program, { desugar: identity, title });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.source;
}

/** The emitted user program (between the banners). */
function programPart(source: string): string {
  const start = source.indexOf('# ======================= YOUR PROGRAM');
  const end = source.indexOf('# ============ BEEPBLOCKS RUNTIME');
  return source.slice(start, end);
}

// ------------------------------------------------------------- completeness

/** A value of the given signature type (type variables become numbers). */
function sample(t: SigType): Expr {
  switch (t.t) {
    case 'number':
    case 'T':
      return b.lit(2);
    case 'text':
      return b.lit('x');
    case 'bool':
      return b.lit(false);
    case 'path':
      return b.op('fs.root', []);
    case 'list': {
      const of: Type = t.of.t === 'path' ? T.path : t.of.t === 'text' ? T.text : T.number;
      return b.list(of, [sample(t.of.t === 'T' ? { t: 'number' } : t.of)]);
    }
  }
}

function opProgram(op: OpName): Program {
  const sig = OPS[op];
  const args = sig.args.map((a) =>
    a.oneOf
      ? b.lit(a.oneOf[1] ?? a.oneOf[0]!)
      : a.name === 'pattern'
        ? b.lit('a+')
        : sample(a.type),
  );
  const node = b.op(op, args, 'OP');
  return b.program([sig.returns === null ? b.do(node, 'S') : b.assign('result', node, 'S')]);
}

/** Ops that can raise a runtime error in the simulator or the runtime (need `at=`). */
const CAN_FAIL = new Set<OpName>([
  'text.toNumber',
  'text.padNumber',
  'text.date',
  'list.get',
  'list.range',
  'list.sortBy',
  'math.floor',
  'fs.join',
  'fs.parent',
  'fs.exists',
  'fs.isFolder',
  'fs.list',
  'fs.walk',
  'fs.size',
  'fs.modified',
  'fs.readText',
  'fs.writeText',
  'fs.makeFolder',
  'fs.rename',
  'fs.move',
  'fs.copy',
  'fs.delete',
]);

describe('op completeness', () => {
  it('has a Python emission for every op in ir/ops.ts', () => {
    expect(Object.keys(PY_OPS).sort()).toEqual([...OP_NAMES].sort());
  });

  it.each(OP_NAMES)('%s emits valid Python, with at= exactly when it can fail', (op) => {
    const program = opProgram(op);
    expect(validateProgram(program).filter((e) => e.severity === 'error')).toEqual([]);
    const code = programPart(exported(program));
    expect(code.includes('at="OP"')).toBe(CAN_FAIL.has(op));
  });

  it('emits sortBy with disk keys through fs.sort_by (with at=), name/ext through sorted()', () => {
    const mk = (key: string, desc: boolean) =>
      programPart(
        exported(
          b.program([
            b.assign(
              'xs',
              b.op(
                'list.sortBy',
                [b.op('fs.list', [b.op('fs.root', [])]), b.lit(key), b.lit(desc)],
                'SB',
              ),
            ),
          ]),
        ),
      );
    expect(mk('name', false)).toContain('xs = sorted(fs.list(fs.root(), at=');
    expect(mk('ext', true)).toContain('key=_bp_by_ext, reverse=True)');
    expect(mk('size', true)).toContain('"size", descending=True, at="SB")');
    expect(mk('modified', false)).toContain('"modified", descending=False, at="SB")');
  });

  it('every emitted script compiles with Python', () => {
    const sources = OP_NAMES.map((op) => exported(opProgram(op)));
    for (const c of [...CASES, ...ERROR_CASES]) {
      const r = exportPython(c.program, { desugar: c.desugar ?? identity, title: c.name });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      sources.push(r.source);
    }
    expect(pyCompileAll(sources).filter((e) => e !== '')).toEqual([]);
  });
});

// ------------------------------------------------------------- expressions

describe('expressions', () => {
  const expr = (e: Expr, setup: Program['body'] = []) => {
    const code = programPart(exported(b.program([...setup, b.assign('out', e, 'A')])));
    const line = code.split('\n').find((l) => l.trimStart().startsWith('out = '));
    return line!.trim().slice('out = '.length);
  };
  const n = (x: number) => b.lit(x);

  it('parenthesizes by Python precedence', () => {
    expect(expr(b.bin('-', n(10), b.bin('-', n(4), n(3))))).toBe('10 - (4 - 3)');
    expect(expr(b.bin('-', b.bin('-', n(10), n(4)), n(3)))).toBe('10 - 4 - 3');
    expect(expr(b.bin('*', b.bin('+', n(1), n(2)), n(3)))).toBe('(1 + 2) * 3');
    expect(expr(b.bin('+', n(1), b.bin('*', n(2), n(3))))).toBe('1 + 2 * 3');
    expect(expr(b.neg(b.neg(n(1))))).toBe('-(-1)');
    expect(expr(b.neg(b.bin('+', n(1), n(2))))).toBe('-(1 + 2)');
    expect(expr(b.bin('==', b.bin('<', n(1), n(2)), b.lit(true)))).toBe('(1 < 2) == True');
    expect(expr(b.not(b.bin('and', b.lit(true), b.lit(false))))).toBe('not (True and False)');
    expect(expr(b.bin('or', b.bin('and', b.lit(true), b.lit(false)), b.lit(true)))).toBe(
      'True and False or True',
    );
    expect(expr(b.bin('and', b.lit(true), b.bin('or', b.lit(false), b.lit(true))))).toBe(
      'True and (False or True)',
    );
    expect(expr(b.op('text.lower', [b.bin('+', b.lit('a'), b.lit('B'))]))).toBe(
      '("a" + "B").lower()',
    );
    expect(expr(b.op('text.contains', [b.lit('abc'), b.lit('b')]))).toBe('"b" in "abc"');
  });

  it('uses plain Python for division only by a non-zero literal', () => {
    expect(expr(b.bin('//', n(7), n(2)))).toBe('7 // 2');
    expect(expr(b.bin('%', n(7), b.neg(n(3))))).toBe('7 % -3');
    expect(expr(b.bin('/', n(7), b.v('z'), 'D'), [b.assign('z', n(0))])).toBe(
      '_bp_div(7, z, at="D")',
    );
    expect(expr(b.bin('/', n(7), n(0), 'D'))).toBe('_bp_div(7, 0, at="D")');
    expect(expr(b.bin('%', n(7), b.float(0), 'D'))).toBe('_bp_mod(7, 0.0, at="D")');
  });

  it('writes number literals that keep their int/float kind', () => {
    expect(pyNumber(3, false)).toBe('3');
    expect(pyNumber(3, true)).toBe('3.0');
    expect(pyNumber(1e16, true)).toBe('10000000000000000.0');
    expect(pyNumber(1e21, true)).toBe('1e+21');
    expect(pyNumber(1e-7, false)).toBe('1e-7');
    expect(pyNumber(0.5, false)).toBe('0.5');
    expect(pyNumber(-0, true)).toBe('-0.0');
    expect(pyNumber(-0, false)).toBe('0');
    expect(expr(b.float(-2.5))).toBe('-2.5');
  });

  it('escapes strings safely', () => {
    expect(pyString('a"b\\c\n\r\t')).toBe('"a\\"b\\\\c\\n\\r\\t"');
    expect(pyString('\u0000\u001f\u007f\u0085')).toBe('"\\x00\\x1f\\x7f\\x85"');
    expect(pyString('\u202e\u2028\ufeff\u200b')).toBe('"\\u202e\\u2028\\ufeff\\u200b"');
    expect(pyString('\ud800x\udc00')).toBe('"\\ud800x\\udc00"');
    expect(pyString('\u{1F600}é')).toBe('"\u{1F600}é"');
    expect(commentText('a\nb\u202ec\ud800')).toBe('a b c\ufffd');
    expect(docstringText('x """ y \\" z')).toBe('x "\'" y \\ " z');
  });

  it('compares lists with _bp_eq and uses `in` only where it is exact', () => {
    const nums = b.list(T.number, [n(1)]);
    expect(expr(b.bin('==', nums, b.list(T.number, [n(1)])))).toBe('_bp_eq([1], [1])');
    expect(expr(b.bin('!=', nums, b.list(T.number, [n(1)])))).toBe('not _bp_eq([1], [1])');
    expect(expr(b.op('list.contains', [b.list(T.number, [n(1)]), n(1)]))).toBe(
      '_bp_contains([1], 1)',
    );
    expect(expr(b.op('list.contains', [b.list(T.text, [b.lit('a')]), b.lit('a')]))).toBe(
      '"a" in ["a"]',
    );
  });
});

// -------------------------------------------------------------- statements

describe('statements and layout', () => {
  it('copies lists in for loops unless the list is new', () => {
    const code = programPart(
      exported(
        b.program([
          b.assign('xs', b.list(T.number, [b.lit(1)])),
          b.forEach('x', b.v('xs'), []),
          b.forEach('x', b.op('list.range', [b.lit(0), b.lit(2)]), []),
        ]),
      ),
    );
    expect(code).toContain('for x in list(xs):\n        pass');
    expect(code).toMatch(/for x in _bp_range\(0, 2, at="[^"]+"\):/);
  });

  it('turns else-if into elif and keeps the formatting rules', () => {
    for (const c of CASES) {
      const r = exportPython(c.program, { desugar: c.desugar ?? identity, title: c.name });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      const lines = programPart(r.source).split('\n');
      expect(r.source.endsWith('\n') && !r.source.endsWith('\n\n')).toBe(true);
      expect(r.source).not.toMatch(/[ \t]+\n/);
      for (const l of lines) {
        expect(l).toBe(l.replace(/\s+$/, ''));
        expect(l.match(/^ */)![0].length % 4).toBe(0);
        expect(l).not.toContain('\t');
      }
    }
    const functions = CASES.find((c) => c.name === 'functions')!;
    expect(exported(functions.program)).toContain('    elif i > 2:\n');
  });

  it('comments every top-level block once, and each composite once', () => {
    const bisect = CASES.find((c) => c.name === 'composite-bisect')!;
    const r = exportPython(bisect.program, { desugar: bisect.desugar!, title: 'x' });
    if (!r.ok) throw new Error('export failed');
    const comments = programPart(r.source)
      .split('\n')
      .filter((l) => l.includes('# [block'));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatch(/^ {4}# \[block ff\] Find the first file in the chosen folder/);
  });

  it('puts the parts in order: header, imports, program, runtime, entry', () => {
    const s = exported(b.program([b.print(b.lit('hi'))]));
    const order = [
      '#!/usr/bin/env python3',
      'r"""',
      'import argparse',
      'def main(fs):',
      '_BPError',
      '_bp_entry(main)',
    ];
    const at = order.map((x) => s.indexOf(x));
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(s.trimEnd().endsWith('if __name__ == "__main__":\n    _bp_entry(main)')).toBe(true);
  });
});

// ----------------------------------------------------------------- header

describe('header', () => {
  it('lists destructive blocks with their ids, and only when there are some', () => {
    const del = CASES.find((c) => c.name === 'composite-delete')!;
    const r = exportPython(del.program, { desugar: del.desugar!, title: 'Clean up' });
    if (!r.ok) throw new Error('export failed');
    expect(r.source).toContain('Clean up \u2014 exported from BeepBlocks');
    expect(r.source).toContain('\u26a0 This script can DELETE or OVERWRITE files:');
    expect(r.source).toContain(
      'Delete files in the chosen folder and its subfolders matching "*.tmp" (block fa)',
    );
    expect(r.source).toContain('(block w1)');
    expect(exported(b.program([b.print(b.lit('hi'))]))).not.toContain('DELETE or OVERWRITE');
  });

  it('explains how to run, the dry run, partial failure and case rules', () => {
    const s = exported(b.program([]));
    expect(s).toContain('python script.py "C:\\path\\to\\folder"            # preview only');
    expect(s).toContain('--apply    # actually make the changes');
    expect(s).toContain('nothing is rolled back');
    expect(s).toContain('upper/lower case');
    expect(s).toContain('(nothing yet: the program is empty)');
  });

  it('cannot be broken out of by user text', () => {
    const s = exported(b.program([b.print(b.lit('end """ \\'))]), 'T"""\\');
    expect(pyCompileErrors(s)).toBe('');
  });
});

// ----------------------------------------------------------------- runtime

describe('runtime embedding', () => {
  it('runtime.gen.ts is up to date with runtime.py (run `pnpm gen:runtime`)', () => {
    const py = readFileSync(join(import.meta.dirname, 'runtime.py'), 'utf8');
    // Compares the value, so reformatting the generated file (prettier) does not matter.
    expect(RUNTIME_PY).toBe(py.replace(/\r\n/g, '\n'));
    expect(renderRuntimeModule(py)).toContain(JSON.stringify(RUNTIME_PY));
  });

  it('embeds the import block and the runtime body', () => {
    expect(RUNTIME_IMPORTS.startsWith('import argparse')).toBe(true);
    expect(RUNTIME_BODY).toContain('class _RealFS(_BPFileSystem):');
    expect(RUNTIME_BODY).toContain('class _PlanFS(_BPFileSystem):');
    expect(RUNTIME_BODY).not.toContain('@bp-');
  });
});

// ------------------------------------------------------------------ goldens

/**
 * Test programs use generated ids (`n1a`…) for blocks they never refer to; renumber them in
 * order of appearance so the goldens do not depend on the global id counter.
 */
function stableIds(source: string): string {
  const seen = new Map<string, string>();
  return source.replace(/(?<=at="|\[block )n[0-9a-z]+(?=["\]])/g, (id) => {
    if (!seen.has(id)) seen.set(id, `id${seen.size + 1}`);
    return seen.get(id)!;
  });
}

describe('golden files', () => {
  const GOLDEN = [
    'numbers',
    'text',
    'functions',
    'mutations',
    'composite-rename',
    'composite-delete',
    'composite-bisect',
  ];
  it.each(GOLDEN)('%s', async (name) => {
    const c = CASES.find((x) => x.name === name)!;
    const r = exportPython(c.program, { desugar: c.desugar ?? identity, title: name });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    await expect(stableIds(r.source)).toMatchFileSnapshot(`./__golden__/${name}.py`);
  });

  it.each(['basic-arith-print', 'mkdir-move', 'rename-collision-error'])(
    'fixture %s',
    async (name) => {
      const dir = join(import.meta.dirname, '../../../conformance/fixtures', name);
      const program = JSON.parse(readFileSync(join(dir, 'program.json'), 'utf8')) as Program;
      await expect(exported(program, name)).toMatchFileSnapshot(`./__golden__/${name}.py`);
    },
  );
});
