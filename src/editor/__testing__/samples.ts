/** Test programs covering every IR construct (used by editor tests). */
import { b } from '../../ir/build.ts';
import { OPS, OP_NAMES, type OpName, type SigType } from '../../ir/ops.ts';
import type { Expr, Program, Stmt } from '../../ir/types.ts';
import { T } from '../../ir/types.ts';

/** Deterministic id factory. */
export function ids(prefix = 'n') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** A well-typed sample argument for a signature type. */
function sampleArg(s: SigType, id: () => string): Expr {
  switch (s.t) {
    case 'number':
      return b.lit(2, id());
    case 'text':
      return b.lit('a', id());
    case 'bool':
      return b.lit(true, id());
    case 'path':
      return b.root(id());
    case 'T':
      return b.lit(1, id());
    case 'list':
      if (s.of.t === 'path') return b.op('fs.list', [b.root(id())], id());
      return b.list(T.number, [b.lit(1, id()), b.lit(2, id())], id());
  }
}

/** One statement per op: `do` for statement-only ops, otherwise an assignment. */
export function opStatements(id: () => string): Stmt[] {
  return OP_NAMES.map((op: OpName, i) => {
    const sig = OPS[op];
    const args = sig.args.map((a) => {
      if (a.literal) {
        if (a.oneOf) return b.lit(a.oneOf[0]!, id());
        if (a.type.t === 'bool') return b.lit(true, id());
        return b.lit(op === 'text.regexReplace' && a.name === 'replacement' ? 'x' : '^a', id());
      }
      return sampleArg(a.type, id);
    });
    const e = b.op(op, args, id());
    return sig.returns === null ? b.do(e, id()) : b.assign(`v${i}`, e, id());
  });
}

/** A program using every statement and expression kind, functions and every composite. */
export function kitchenSink(): Program {
  const id = ids();
  const fnBody: Stmt[] = [
    b.assign('total', b.bin('+', b.v('count', id()), b.lit(1, id()), id()), id()),
    b.ret(b.str(b.v('total', id()), id()), id()),
  ];
  const describe = b.fn(
    'describe',
    [
      { name: 'count', type: T.number },
      { name: 'files', type: T.list(T.path) },
    ],
    T.text,
    fnBody,
    'fn-describe',
  );
  const log = b.fn(
    'log',
    [{ name: 'message', type: T.text }],
    null,
    [b.print(b.v('message', id()), id()), b.ret(null, id())],
    'fn-log',
  );

  const arith = (['+', '-', '*', '/', '//', '%'] as const).map((op) =>
    b.assign('x', b.bin(op, b.lit(7, id()), b.lit(2, id()), id()), id()),
  );
  const compare = (['==', '!=', '<', '<=', '>', '>='] as const).map((op) =>
    b.assign('flag', b.bin(op, b.lit(1, id()), b.lit(2, id()), id()), id()),
  );

  const body: Stmt[] = [
    b.assign('x', b.lit(3, id()), id()),
    b.assign('f', b.float(3, id()), id()),
    b.assign('g', b.float(2.5, id()), id()),
    b.assign('h', b.lit(2.5, id()), id()),
    b.assign('neg', b.lit(-4, id()), id()),
    b.assign('big', b.float(1e21, id()), id()),
    b.assign('s', b.lit('hello', id()), id()),
    b.assign('empty', b.lit('', id()), id()),
    b.assign('ok', b.lit(false, id()), id()),
    b.assign('when', b.date('2026-01-31', id()), id()),
    b.assign('nums', b.list(T.number, [b.lit(1, id()), b.v('x', id())], id()), id()),
    b.assign('none', b.list(T.text, [], id()), id()),
    b.assign(
      'grid',
      b.list(T.list(T.number), [b.list(T.number, [b.lit(1, id())], id())], id()),
      id(),
    ),
    b.assign('i', b.lit(0, id()), id(), { indexInto: 'nums' }),
    ...arith,
    b.assign('joined', b.bin('+', b.lit('a', id()), b.lit('b', id()), id()), id()),
    ...compare,
    b.assign('both', b.bin('and', b.lit(true, id()), b.lit(false, id()), id()), id()),
    b.assign('either', b.bin('or', b.lit(true, id()), b.lit(false, id()), id()), id()),
    b.assign('nope', b.not(b.v('ok', id()), id()), id()),
    b.assign('minus', b.neg(b.v('x', id()), id()), id()),
    b.if(
      b.bin('<', b.v('x', id()), b.lit(10, id()), id()),
      [b.print(b.lit('small', id()), id())],
      [b.print(b.lit('big', id()), id())],
      id(),
    ),
    b.if(b.v('ok', id()), [b.print(b.lit('only then', id()), id())], [], id()),
    b.while(
      b.bin('<', b.v('x', id()), b.lit(5, id()), id()),
      [b.assign('x', b.bin('+', b.v('x', id()), b.lit(1, id()), id()), id())],
      id(),
    ),
    b.forEach(
      'file',
      b.op('fs.list', [b.root(id())], id()),
      [b.print(b.op('fs.name', [b.v('file', id())], id()), id())],
      id(),
    ),
    b.assign(
      'desc',
      b.call('describe', [b.lit(1, id()), b.op('fs.walk', [b.root(id())], id())], id()),
      id(),
    ),
    b.do(b.call('log', [b.lit('hi', id())], id()), id()),
    b.do(b.call('describe', [b.lit(2, id()), b.op('fs.list', [b.root(id())], id())], id()), id()),
    b.do(b.op('fs.rename', [b.root(id()), b.lit('x.txt', id())], id()), id()),
    ...opStatements(id),
    b.composite(
      'renameByPattern',
      {
        fields: { match: '*.jpg', template: '{n:3}{ext}' },
        inputs: { folder: b.root(id()) },
        bodies: {},
        binds: {},
      },
      'c-rename',
    ),
    b.composite(
      'sortByType',
      { fields: { grouping: 'extension' }, inputs: { folder: b.root(id()) } },
      'c-sort',
    ),
    b.composite(
      'findAndAct',
      {
        fields: {
          recursive: false,
          namePattern: 'IMG_*',
          extension: null,
          minSize: 10,
          maxSize: null,
          modifiedAfter: '2025-01-01',
          modifiedBefore: null,
          action: 'move',
          renameTemplate: null,
        },
        inputs: {
          folder: b.root(id()),
          destination: b.op('fs.join', [b.root(id()), b.lit('photos', id())], id()),
        },
      },
      'c-find',
    ),
    b.composite(
      'findFirst',
      {
        fields: { sortBy: 'modified' },
        inputs: {
          folder: b.root(id()),
          condition: b.op('fs.exists', [b.v('probe', id())], id()),
        },
        bodies: {
          found: [b.print(b.op('fs.name', [b.v('hit', id())], id()), id())],
          notFound: [b.print(b.lit('none', id()), id())],
        },
        binds: { candidate: 'probe', match: 'hit' },
      },
      'c-first',
    ),
    // Derived ids (as produced by desugaring) are kept verbatim.
    b.assign('d', b.lit(1, 'c-x/one'), 'c-x/assign'),
  ];
  return b.program(body, [describe, log]);
}

/** Every composite with minimal (default-valued) explicit fields. */
export function compositeProgram(): Program {
  return b.program([
    b.composite(
      'sortByType',
      { fields: { grouping: 'category' }, inputs: { folder: b.root('root1') } },
      'sort1',
    ),
    b.print(b.lit('done', 'lit1'), 'print1'),
  ]);
}
