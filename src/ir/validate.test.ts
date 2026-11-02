import { describe, expect, it } from 'vitest';
import { b } from './build.ts';
import { T, type Program, type Stmt } from './types.ts';
import { validateProgram, validateStructure, hasErrors, isoDateToEpoch, checkIdentifier, typecheck } from './validate.ts';
import { parseProgram, serializeProgram } from './serialize.ts';
import type { ValidationCode } from './errors.ts';

const codes = (p: Program) => validateProgram(p).filter((i) => i.severity === 'error').map((i) => i.code);
const ok = (p: Program) => expect(validateProgram(p).filter((i) => i.severity === 'error')).toEqual([]);
const bad = (p: Program, code: ValidationCode) => expect(codes(p)).toContain(code);
const body = (...stmts: Stmt[]) => b.program(stmts);

describe('structure', () => {
  it('accepts the empty program', () => ok(b.program([])));

  it('rejects non-programs without throwing', () => {
    for (const junk of [null, 42, {}, { functions: 1, body: [] }, { functions: [], body: [{}] }]) {
      expect(() => validateProgram(junk as unknown as Program)).not.toThrow();
      expect(hasErrors(validateProgram(junk as unknown as Program))).toBe(true);
    }
  });

  it('rejects duplicate ids', () => {
    bad(body(b.print(b.lit('a'), 'x'), b.print(b.lit('b'), 'x')), 'DUPLICATE_ID');
  });

  it('reserves the editor run-block id', () => {
    bad(body(b.print(b.lit('a'), 'when-run')), 'DUPLICATE_ID');
  });

  it('validateStructure allows empty sockets but not malformed nodes', () => {
    const holes = body(
      b.print(null as unknown as ReturnType<typeof b.lit>, 'p'),
      b.assign('x', b.op('math.max', [b.lit(1), null as unknown as ReturnType<typeof b.lit>], 'm'), 'a'),
    );
    expect(hasErrors(validateProgram(holes))).toBe(true);
    expect(validateStructure(holes)).toEqual([]);
    expect(hasErrors(validateStructure(body(b.print({ kind: 'nope' } as never, 'p'))))).toBe(true);
    expect(hasErrors(validateStructure({ body: [] }))).toBe(true);
    expect(() => validateStructure(null)).not.toThrow();
  });

  it('rejects unknown ops', () => {
    bad(body(b.do({ id: 'o', kind: 'op', op: 'fs.nuke' as never, args: [] })), 'UNKNOWN_OP');
  });

  it('rejects composites in primitive-only mode', () => {
    const p = body(b.composite('sortByType', { inputs: { folder: b.root() } }));
    ok(p);
    expect(validateProgram(p, { primitiveOnly: true }).map((i) => i.code)).toContain('STRUCTURE');
  });

  it('accepts expression composites and rejects them in primitive-only mode', () => {
    const p = body(b.assign('n', b.compositeExpr('countFiles', { inputs: { folder: b.root() } })));
    ok(p);
    expect(validateProgram(p, { primitiveOnly: true }).map((i) => i.code)).toContain('STRUCTURE');
  });

  it('requires halving-search paths to end in a marker', () => {
    const p = body(
      b.composite('halvingSearch', {
        inputs: { line: b.list(T.path, []) },
        bodies: { decide: [b.if(b.lit(true), [b.composite('keepLeftHalf')])] },
      }),
    );
    bad(p, 'INCOMPLETE_SEARCH');
  });

  it('rejects half markers outside a halving search decision', () => {
    bad(body(b.composite('keepRightHalf')), 'MISPLACED_BLOCK');
  });
});

describe('names', () => {
  it('accepts normal identifiers', () => expect(checkIdentifier('file_count2')).toBeNull());
  it.each(['2x', 'my-var', '', 'for', 'print', 'fs', 'main', '_bp_x', 'naïve'])('rejects %j', (n) =>
    expect(checkIdentifier(n)).not.toBeNull(),
  );
  it('rejects bad variable names in programs', () => bad(body(b.assign('class', b.lit(1))), 'BAD_NAME'));
  it('rejects variables shadowing functions', () => {
    const f = b.fn('helper', [], null, []);
    bad(b.program([b.assign('helper', b.lit(1))], [f]), 'DUPLICATE_NAME');
  });
  it('rejects duplicate functions and params', () => {
    bad(b.program([], [b.fn('f', [], null, []), b.fn('f', [], null, [])]), 'DUPLICATE_NAME');
    bad(
      b.program([], [b.fn('f', [{ name: 'a', type: T.number }, { name: 'a', type: T.text }], null, [])]),
      'DUPLICATE_NAME',
    );
  });
});

describe('variables and definite assignment', () => {
  it('allows use after assignment', () => ok(body(b.assign('x', b.lit(1)), b.print(b.str(b.v('x'))))));
  it('rejects use before assignment', () => bad(body(b.print(b.str(b.v('x')))), 'UNDEFINED_VARIABLE'));
  it('rejects use when assigned on only one branch', () =>
    bad(
      body(b.if(b.lit(true), [b.assign('x', b.lit(1))]), b.print(b.str(b.v('x')))),
      'UNDEFINED_VARIABLE',
    ));
  it('allows use when assigned on both branches', () =>
    ok(
      body(
        b.if(b.lit(true), [b.assign('x', b.lit(1))], [b.assign('x', b.lit(2))]),
        b.print(b.str(b.v('x'))),
      ),
    ));
  it('does not treat loop-body assignments as definite after the loop', () =>
    bad(
      body(b.while(b.lit(false), [b.assign('x', b.lit(1))]), b.print(b.str(b.v('x')))),
      'UNDEFINED_VARIABLE',
    ));
  it('binds the forEach variable inside the body only', () => {
    const list = b.list(T.number, [b.lit(1)]);
    ok(body(b.forEach('n', list, [b.print(b.str(b.v('n')))])));
    bad(body(b.forEach('n', b.list(T.number, []), []), b.print(b.str(b.v('n')))), 'UNDEFINED_VARIABLE');
  });
  it('rejects retyping a variable', () =>
    bad(body(b.assign('x', b.lit(1)), b.assign('x', b.lit('one'))), 'VARIABLE_RETYPED'));
  it('functions cannot see program variables', () => {
    const f = b.fn('f', [], null, [b.print(b.str(b.v('x')))]);
    bad(b.program([b.assign('x', b.lit(1))], [f]), 'UNDEFINED_VARIABLE');
  });
  it('functions see their parameters', () => {
    const f = b.fn('f', [{ name: 'x', type: T.number }], null, [b.print(b.str(b.v('x')))]);
    ok(b.program([b.do(b.call('f', [b.lit(1)]))], [f]));
  });
});

describe('types', () => {
  it('conditions must be yes/no', () => {
    bad(body(b.if(b.lit(1), [])), 'TYPE_MISMATCH');
    bad(body(b.while(b.lit('x'), [])), 'TYPE_MISMATCH');
    ok(body(b.if(b.bin('<', b.lit(1), b.lit(2)), [])));
  });
  it('print needs text', () => {
    bad(body(b.print(b.lit(1))), 'TYPE_MISMATCH');
    ok(body(b.print(b.str(b.lit(1)))));
  });
  it('+ works on numbers, texts and same-typed lists only', () => {
    ok(body(b.assign('a', b.bin('+', b.lit(1), b.float(2)))));
    ok(body(b.assign('a', b.bin('+', b.lit('x'), b.lit('y')))));
    ok(body(b.assign('a', b.bin('+', b.list(T.text, []), b.list(T.text, [])))));
    bad(body(b.assign('a', b.bin('+', b.lit('x'), b.lit(1)))), 'TYPE_MISMATCH');
    bad(body(b.assign('a', b.bin('+', b.list(T.text, []), b.list(T.number, [])))), 'TYPE_MISMATCH');
  });
  it('arithmetic other than + needs numbers', () =>
    bad(body(b.assign('a', b.bin('*', b.lit('x'), b.lit(3)))), 'TYPE_MISMATCH'));
  it('ordering needs two numbers or two texts; equality needs same types', () => {
    ok(body(b.assign('a', b.bin('<', b.lit('a'), b.lit('b')))));
    bad(body(b.assign('a', b.bin('<', b.lit(true), b.lit(false)))), 'TYPE_MISMATCH');
    bad(body(b.assign('a', b.bin('==', b.lit(1), b.lit('1')))), 'TYPE_MISMATCH');
    ok(body(b.assign('a', b.bin('==', b.root(), b.root()))));
  });
  it('and/or/not need yes/no', () => {
    bad(body(b.assign('a', b.bin('and', b.lit(1), b.lit(true)))), 'TYPE_MISMATCH');
    bad(body(b.assign('a', b.not(b.lit(1)))), 'TYPE_MISMATCH');
    bad(body(b.assign('a', b.neg(b.lit('x')))), 'TYPE_MISMATCH');
  });
  it('list items must match the list type', () =>
    bad(body(b.assign('a', b.list(T.number, [b.lit('x')]))), 'TYPE_MISMATCH'));
  it('rejects huge integer literals and bad dates', () => {
    bad(body(b.assign('a', b.lit(2 ** 60))), 'LARGE_INT');
    bad(body(b.assign('a', b.date('2026-02-30'))), 'BAD_LITERAL');
    ok(body(b.assign('a', b.date('2026-02-28'))));
  });
  it('records expression types', () => {
    const e = b.op('fs.list', [b.root()], 'listing');
    const res = typecheck(body(b.assign('items', e)));
    expect(res.exprTypes.get('listing')).toEqual(T.list(T.path));
    expect(res.varTypes.get(null)?.get('items')).toEqual(T.list(T.path));
  });
});

describe('ops', () => {
  it('checks arity', () => bad(body(b.assign('a', b.op('text.lower', []))), 'ARITY'));
  it('checks argument types', () => bad(body(b.assign('a', b.op('text.lower', [b.lit(1)]))), 'TYPE_MISMATCH'));
  it('binds type variables consistently', () => {
    ok(body(b.assign('x', b.op('list.get', [b.list(T.text, [b.lit('a')]), b.lit(0)])), b.print(b.v('x'))));
    bad(
      body(b.do(b.op('list.append', [b.list(T.text, []), b.lit(1)]))),
      'TYPE_MISMATCH',
    );
  });
  it('enforces scalar and orderable constraints', () => {
    bad(body(b.assign('a', b.str(b.list(T.text, [])))), 'TYPE_MISMATCH');
    bad(
      body(b.assign('a', b.op('list.sort', [b.list(T.path, []), b.lit(false)]))),
      'TYPE_MISMATCH',
    );
    ok(body(b.assign('a', b.op('list.sort', [b.list(T.number, []), b.lit(false)]))));
  });
  it('enforces literal and oneOf arguments', () => {
    ok(body(b.assign('a', b.op('list.sortBy', [b.op('fs.list', [b.root()]), b.lit('size'), b.lit(true)]))));
    bad(
      body(b.assign('a', b.op('list.sortBy', [b.op('fs.list', [b.root()]), b.lit('colour'), b.lit(true)]))),
      'BAD_LITERAL',
    );
    bad(
      body(
        b.assign('k', b.lit('size')),
        b.assign('a', b.op('list.sortBy', [b.op('fs.list', [b.root()]), b.v('k'), b.lit(true)])),
      ),
      'NOT_LITERAL',
    );
  });
  it('statement-only ops cannot be values', () => {
    bad(body(b.assign('a', b.op('fs.delete', [b.root()]) as never)), 'STATEMENT_ONLY');
    ok(body(b.do(b.op('fs.delete', [b.op('fs.join', [b.root(), b.lit('x.tmp')])]))));
  });
  it('value ops may be used as steps', () =>
    ok(body(b.do(b.op('fs.rename', [b.op('fs.join', [b.root(), b.lit('a')]), b.lit('b')])))));
  it('validates regex patterns and replacements', () => {
    const m = (p: string) => body(b.assign('a', b.op('text.regexMatch', [b.lit('x'), b.lit(p)])));
    ok(m('^IMG_(\\d{4})\\.jpe?g$'));
    bad(m('(?<=a)b'), 'BAD_PATTERN');
    bad(m('\\bword'), 'BAD_PATTERN');
    bad(m('(a'), 'BAD_PATTERN');
    const r = (p: string, repl: string) =>
      body(b.assign('a', b.op('text.regexReplace', [b.lit('x'), b.lit(p), b.lit(repl)])));
    ok(r('(\\d+)-(\\d+)', '\\2-\\1'));
    bad(r('(\\d+)', '\\2'), 'BAD_PATTERN');
    bad(r('x', '$1'.replace('$', '\\q')), 'BAD_PATTERN');
  });
});

describe('functions', () => {
  it('requires a return on every path', () => {
    const f = b.fn('f', [{ name: 'x', type: T.number }], T.number, [
      b.if(b.bin('>', b.v('x'), b.lit(0)), [b.ret(b.lit(1))]),
    ]);
    bad(b.program([], [f]), 'MISSING_RETURN');
    const g = b.fn('g', [{ name: 'x', type: T.number }], T.number, [
      b.if(b.bin('>', b.v('x'), b.lit(0)), [b.ret(b.lit(1))], [b.ret(b.lit(0))]),
    ]);
    ok(b.program([], [g]));
  });
  it('checks return types and placement', () => {
    bad(b.program([], [b.fn('f', [], T.number, [b.ret(b.lit('x'))])]), 'TYPE_MISMATCH');
    bad(b.program([], [b.fn('f', [], null, [b.ret(b.lit(1))])]), 'BAD_RETURN');
    bad(body(b.ret(null)), 'RETURN_OUTSIDE_FUNCTION');
  });
  it('checks calls', () => {
    const f = b.fn('f', [{ name: 'x', type: T.number }], T.number, [b.ret(b.v('x'))]);
    ok(b.program([b.assign('y', b.call('f', [b.lit(1)]))], [f]));
    bad(b.program([b.assign('y', b.call('f', []))], [f]), 'ARITY');
    bad(b.program([b.assign('y', b.call('f', [b.lit('a')]))], [f]), 'TYPE_MISMATCH');
    bad(b.program([b.assign('y', b.call('nope', []))], [f]), 'UNKNOWN_FUNCTION');
    const g = b.fn('g', [], null, []);
    bad(b.program([b.assign('y', b.call('g', []) as never)], [g]), 'STATEMENT_ONLY');
  });
  it('allows recursion', () => {
    const walk = b.fn('countdown', [{ name: 'n', type: T.number }], null, [
      b.if(b.bin('>', b.v('n'), b.lit(0)), [b.do(b.call('countdown', [b.bin('-', b.v('n'), b.lit(1))]))]),
    ]);
    ok(b.program([b.do(b.call('countdown', [b.lit(3)]))], [walk]));
  });
});

describe('composites', () => {
  it('accepts defaults for missing fields', () =>
    ok(body(b.composite('renameByPattern', { inputs: { folder: b.root() } }))));
  it('requires non-optional inputs', () => bad(body(b.composite('sortByType')), 'MISSING_INPUT'));
  it('type-checks inputs', () =>
    bad(body(b.composite('sortByType', { inputs: { folder: b.lit('C:/') } })), 'TYPE_MISMATCH'));
  it('validates fields', () => {
    const c = (fields: Record<string, string | number | boolean | null>) =>
      body(b.composite('renameByPattern', { fields, inputs: { folder: b.root() } }));
    bad(c({ template: 'x{oops}' }), 'BAD_TEMPLATE');
    bad(c({ match: '' }), 'BAD_PATTERN');
    bad(c({ colour: 'red' }), 'BAD_FIELD');
    bad(
      body(b.composite('sortByType', { fields: { grouping: 'size' }, inputs: { folder: b.root() } })),
      'BAD_FIELD',
    );
  });
  it('enforces cross-field requirements', () => {
    bad(
      body(b.composite('findAndAct', { fields: { action: 'move' }, inputs: { folder: b.root() } })),
      'MISSING_INPUT',
    );
    bad(
      body(b.composite('findAndAct', { fields: { action: 'rename' }, inputs: { folder: b.root() } })),
      'MISSING_INPUT',
    );
    ok(body(b.composite('findAndAct', { fields: { action: 'delete' }, inputs: { folder: b.root() } })));
  });
  it('scopes bound names to their slots', () => {
    const cond = b.op('text.contains', [b.op('fs.readText', [b.v('log')]), b.lit('ERROR')]);
    const good = b.composite('findFirst', {
      inputs: { folder: b.root(), condition: cond },
      bodies: { found: [b.print(b.str(b.v('match')))] },
      binds: { candidate: 'log' },
    });
    ok(body(good));
    const leak = b.composite('findFirst', {
      inputs: { folder: b.root(), condition: b.lit(true) },
      bodies: { found: [b.print(b.str(b.v('log')))] },
      binds: { candidate: 'log' },
    });
    bad(body(leak), 'UNDEFINED_VARIABLE');
  });
  it('rejects bound names that clash with existing variable types', () => {
    const c = b.composite('findFirst', { inputs: { folder: b.root(), condition: b.lit(true) } });
    bad(body(b.assign('match', b.lit(3)), c), 'VARIABLE_RETYPED');
  });
});

describe('dates', () => {
  it('parses ISO dates at UTC midnight', () => {
    expect(isoDateToEpoch('1970-01-02')).toBe(86400);
    expect(isoDateToEpoch('2026-13-01')).toBeNull();
    expect(isoDateToEpoch('1969-12-31')).toBeNull();
  });
});

describe('serialize', () => {
  it('round-trips a program, including float literals', () => {
    const p = body(b.assign('x', b.float(3)), b.print(b.str(b.v('x'))));
    const res = parseProgram(serializeProgram(p));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.program).toEqual(p);
  });
  it('rejects wrong format, version and junk', () => {
    expect(parseProgram('{nope').ok).toBe(false);
    expect(parseProgram({ format: 'other', version: 1 }).ok).toBe(false);
    const v2 = parseProgram({ format: 'beepblocks-ir', version: 2, functions: [], body: [] });
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.program.version).toBe(2);
    const v1 = parseProgram({ format: 'beepblocks-ir', version: 1, functions: [], body: [] });
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.program.version).toBe(2);
  });
});
