/**
 * Small test programs covering every op family and every FS error, used by the golden-file
 * and the simulator-vs-Python differential tests.
 */
import { b } from '../../../ir/build.ts';
import { T, type Expr, type Program, type Stmt } from '../../../ir/types.ts';
import type { SandboxFS } from '../../../domains/fileExplorer/fsTypes.ts';
import { binary, fakeDesugar, file, folder, tree, T0 } from './python.ts';

export interface Case {
  name: string;
  /** Undesugared program (may contain composites when `desugar` is set). */
  program: Program;
  tree: SandboxFS;
  desugar?: (p: Program) => Program;
  /** Expected simulator error (sanity check of the test itself). */
  error?: { code: string; nodeId: string };
}

// ------------------------------------------------------------------ builders

const L = b.lit;
const F = b.float;
const v = b.v;
const root = (id?: string): Expr => b.op('fs.root', [], id);
const at = (base: Expr, ...names: string[]): Expr =>
  names.reduce<Expr>((p, n) => b.op('fs.join', [p, L(n)]), base);
const path = (...names: string[]): Expr => at(root(), ...names);
const str = (e: Expr): Expr => b.op('text.from', [e]);
const show = (e: Expr, id?: string): Stmt => b.print(str(e), id);
const say = (e: Expr, id?: string): Stmt => b.print(e, id);
const plus = (...parts: Expr[]): Expr => parts.reduce((x, y) => b.bin('+', x, y));
const nums = (...xs: number[]): Expr =>
  b.list(
    T.number,
    xs.map((x) => L(x)),
  );
const texts = (...xs: string[]): Expr =>
  b.list(
    T.text,
    xs.map((x) => L(x)),
  );
const each = (name: string, list: Expr, body: Stmt[]): Stmt => b.forEach(name, list, body);
const doOp = (op: Parameters<typeof b.op>[0], args: Expr[], id?: string): Stmt =>
  b.do(b.op(op, args, id));

// --------------------------------------------------------------------- trees

export const T1: SandboxFS = tree([
  file('a.txt', 'hello\r\nworld\n', T0),
  binary('B.jpg', 100, T0 - 86_400),
  file('notes.TXT', 'x', T0 - 3_600),
  file('data.bin', '\u0000abc', T0 - 7_200),
  file('.bashrc', 'alias ll=ls', T0 - 10),
  file('same1.txt', 'xx', T0 - 20),
  file('same2.txt', 'yy', T0 - 20),
  folder('docs', [
    file('readme.md', '# hi', T0 - 500),
    file('report.final.PDF', 'pdf?', T0 - 400),
    folder('sub', [file('deep.log', 'log line', T0 - 300)]),
  ]),
  folder('empty', []),
]);

const EMPTY: SandboxFS = tree([]);

// --------------------------------------------------------------------- cases

const numbers: Case = {
  name: 'numbers',
  tree: EMPTY,
  program: b.program([
    show(b.bin('//', L(7), L(2))),
    show(b.bin('//', b.neg(L(7)), L(2))),
    show(b.bin('%', L(7), b.neg(L(3)))),
    show(b.bin('%', b.neg(F(7.5)), L(2))),
    show(b.bin('%', L(5), b.neg(F(0.5)))),
    show(b.bin('/', L(7), L(2))),
    show(b.bin('/', L(1), L(3))),
    show(b.bin('*', F(2), L(3))),
    show(b.bin('//', b.neg(L(7)), F(2))),
    show(F(1e16)),
    show(L(0.00001)),
    show(L(123456.789)),
    show(b.bin('+', L(0.1), L(0.2))),
    show(b.neg(F(0))),
    show(b.neg(L(0))),
    b.assign('big', b.bin('*', F(1e308), L(10))),
    show(v('big')),
    show(b.neg(v('big'))),
    b.assign('nan', b.bin('-', v('big'), v('big'))),
    show(v('nan')),
    show(b.bin('==', v('nan'), v('nan'))),
    show(b.bin('<=', v('nan'), v('nan'))),
    show(b.op('math.floor', [L(2.7)])),
    show(b.op('math.floor', [b.neg(L(2.5))])),
    show(b.op('math.floor', [L(4)])),
    show(b.op('math.abs', [b.neg(L(3))])),
    show(b.op('math.abs', [b.neg(F(0))])),
    show(b.op('math.min', [L(1), F(1)])),
    show(b.op('math.max', [F(1), L(1)])),
    show(b.op('math.min', [L(2), b.neg(L(5))])),
    show(b.op('math.max', [v('nan'), L(1)])),
    show(b.bin('<', L('a'), L('B'))),
    show(b.bin('<', L('\u00e9'), L('z'))),
    show(b.bin('<', L('\u{1F600}'), L('\uffee'))),
    show(b.bin('==', L(1), F(1))),
    show(b.bin('!=', L('a'), L('A'))),
    show(b.bin('and', L(true), b.bin('or', L(false), L(true)))),
    show(b.not(b.bin('<', L(1), L(2)))),
    show(b.bin('==', b.bin('<', L(1), L(2)), L(true))),
    show(b.bin('-', L(10), b.bin('-', L(4), L(3)))),
    show(b.bin('*', b.bin('+', L(1), L(2)), L(3))),
    show(root()),
    show(b.date('2026-01-31')),
  ]),
};

const text: Case = {
  name: 'text',
  tree: EMPTY,
  program: b.program([
    show(b.op('text.length', [L('h\u00e9llo\u{1F600}')])),
    say(b.op('text.lower', [L('\u00c0BC')])),
    say(b.op('text.upper', [L('stra\u00dfe')])),
    show(b.op('text.contains', [L('hello'), L('ell')])),
    show(b.op('text.startsWith', [L('hello'), L('he')])),
    show(b.op('text.endsWith', [L('hello'), L('LO')])),
    say(b.op('text.replace', [L('banana'), L('an'), L('AN')])),
    say(b.op('text.replace', [L('ab'), L(''), L('-')])),
    say(b.op('text.padNumber', [L(7), L(3)])),
    say(b.op('text.padNumber', [b.neg(L(5)), L(3)])),
    say(b.op('text.padNumber', [L(1234), L(2)])),
    say(b.op('text.date', [L(T0)])),
    say(b.op('text.date', [L(T0 - 0.5)])),
    show(b.op('text.wildcard', [L('IMG_0001.JPG'), L('img_*.jpg')])),
    show(b.op('text.wildcard', [L('a\nb'), L('a?b')])),
    show(b.op('text.wildcard', [L('a\nb'), L('a*')])),
    show(b.op('text.wildcard', [L('[x].txt'), L('[x]*')])),
    show(b.op('text.wildcard', [L('axb'), L('a.b')])),
    show(b.op('text.regexMatch', [L('abc123'), L('\\d+')])),
    show(b.op('text.regexMatch', [L('a\n'), L('a$')])),
    show(b.op('text.regexMatch', [L('\u00a0'), L('\\s')])),
    show(b.op('text.regexMatch', [L('\r'), L('.')])),
    show(b.op('text.regexMatch', [L('-'), L('^[\\-]$')])),
    say(b.op('text.regexReplace', [L('2024-01-05'), L('(\\d+)-(\\d+)-(\\d+)'), L('\\3.\\2.\\1')])),
    say(b.op('text.regexReplace', [L('ab'), L('(x)?b'), L('[\\1]')])),
    say(b.op('text.regexReplace', [L('a.b'), L('\\.'), L('\\\\')])),
    say(b.op('text.regexReplace', [L('abc'), L('x*'), L('-')])),
    say(b.op('text.regexReplace', [L('say "hi"'), L('"(\\w+)"'), L('<\\1>')])),
    say(b.op('text.regexReplace', [L('aaa'), L('a+?'), L('$&')])),
    show(b.bin('+', b.op('text.toNumber', [L('42')]), L(1))),
    show(b.op('text.toNumber', [L('1.5e3')])),
    show(b.op('text.toNumber', [L('-0')])),
    show(b.op('text.toNumber', [L('.5')])),
    say(L('line1\nline2\n')),
    say(L('')),
    say(L('quote " backslash \\ tab\tend')),
    say(L('bidi \u202e and nbsp \u00a0 and zero-width \u200b')),
  ]),
};

const lists: Case = {
  name: 'lists',
  tree: tree([file('A.TXT', 'a')]),
  program: b.program([
    b.assign('a', nums(1, 2)),
    b.assign('c', v('a')),
    doOp('list.append', [v('a'), L(3)]),
    show(b.op('list.length', [v('c')])),
    show(b.op('list.get', [v('c'), L(2)])),
    each('x', v('a'), [doOp('list.append', [v('a'), b.bin('*', v('x'), L(10))])]),
    show(b.op('list.length', [v('a')])),
    each('x', b.op('list.range', [L(0), L(3)]), [show(v('x'))]),
    each('x', b.op('list.range', [L(5), L(2)]), [show(v('x'))]),
    show(b.op('list.contains', [b.list(T.number, [L(1), F(2)]), L(2)])),
    show(b.op('list.contains', [texts('a', 'b'), L('B')])),
    show(b.op('list.contains', [b.list(T.path, [path('A.TXT')]), path('a.txt')])),
    each('x', b.op('list.sort', [b.list(T.number, [L(3), F(1.5), L(2), L(1), F(2)]), L(true)]), [
      show(v('x')),
    ]),
    each('t', b.op('list.sort', [texts('b', 'B', 'a', '\u00e9', 'A'), L(false)]), [say(v('t'))]),
    show(b.op('list.length', [b.bin('+', nums(1), nums(2, 3))])),
    show(b.bin('==', b.list(T.path, [path('a.txt')]), b.list(T.path, [path('A.TXT')]))),
    show(b.bin('!=', nums(1, 2), b.list(T.number, [L(1), F(2)]))),
    b.assign('nested', b.list(T.list(T.number), [nums(1), nums()])),
    show(b.op('list.contains', [v('nested'), nums()])),
    show(b.op('list.length', [b.op('list.get', [v('nested'), L(0)])])),
  ]),
};

const fsReads: Case = {
  name: 'fs-reads',
  tree: T1,
  program: b.program([
    each('p', b.op('fs.list', [root()]), [
      say(plus(str(v('p')), L(' '), str(b.op('fs.isFolder', [v('p')])))),
    ]),
    each('p', b.op('fs.walk', [root()]), [
      say(
        plus(
          str(v('p')),
          L(' '),
          str(b.op('fs.size', [v('p')])),
          L(' '),
          str(b.op('fs.modified', [v('p')])),
        ),
      ),
    ]),
    each('p', b.op('fs.list', [path('DOCS')]), [show(v('p'))]),
    each('p', b.op('fs.walk', [path('docs', 'SUB')]), [show(v('p'))]),
    show(b.op('fs.exists', [path('A.TXT')])),
    show(b.op('fs.exists', [path('nope')])),
    show(b.op('fs.exists', [path('a.txt', 'inside')])),
    show(b.op('fs.exists', [root()])),
    show(b.op('fs.modified', [path('docs')])),
    show(b.op('text.length', [b.op('fs.readText', [path('A.TXT')])])),
    say(b.op('fs.readText', [path('docs', 'readme.md')])),
    b.assign('r', path('docs', 'report.final.PDF')),
    say(
      plus(
        b.op('fs.name', [v('r')]),
        L('|'),
        b.op('fs.stem', [v('r')]),
        L('|'),
        b.op('fs.ext', [v('r')]),
      ),
    ),
    b.assign('h', path('.bashrc')),
    say(
      plus(
        b.op('fs.name', [v('h')]),
        L('|'),
        b.op('fs.stem', [v('h')]),
        L('|'),
        b.op('fs.ext', [v('h')]),
      ),
    ),
    say(plus(L('['), b.op('fs.name', [root()]), L(']'))),
    show(b.op('fs.parent', [path('docs', 'sub')])),
    show(b.op('fs.parent', [path('docs')])),
    show(b.bin('==', path('DOCS', 'Sub'), path('docs', 'sub'))),
  ]),
};

const SORT_KEYS = ['name', 'ext', 'size', 'modified'] as const;
const sortBy: Case = {
  name: 'sort-by',
  tree: T1,
  program: b.program([
    b.assign('files', b.op('fs.walk', [root()])),
    b.assign('all', b.op('fs.list', [root()])),
    ...SORT_KEYS.flatMap((key) =>
      [false, true].flatMap((desc) => [
        say(L(`-- ${key} ${desc ? 'desc' : 'asc'}`)),
        each('p', b.op('list.sortBy', [v('files'), L(key), L(desc)]), [show(v('p'))]),
      ]),
    ),
    each('p', b.op('list.sortBy', [v('all'), L('modified'), L(false)]), [show(v('p'))]),
  ]),
};

const mutations: Case = {
  name: 'mutations',
  tree: T1,
  program: b.program([
    doOp('fs.makeFolder', [path('Out')]),
    doOp('fs.writeText', [path('out', 'new.txt'), L('n1\r\nn2\u00e9')]),
    b.assign('c2', b.op('fs.copy', [path('a.txt'), path('docs', 'sub')])),
    show(v('c2')),
    doOp('fs.writeText', [path('A.TXT'), L('over')]),
    b.assign('r', b.op('fs.rename', [path('notes.TXT'), L('Notes.txt')])),
    show(v('r')),
    b.assign('r2', b.op('fs.rename', [path('same1.txt'), L('same1.txt')])),
    show(v('r2')),
    b.assign('m', b.op('fs.move', [path('B.jpg'), path('OUT')])),
    show(v('m')),
    b.assign('c', b.op('fs.copy', [path('docs'), path('out')])),
    show(v('c')),
    b.assign('m2', b.op('fs.move', [path('docs', 'sub'), root()])),
    show(v('m2')),
    doOp('fs.delete', [path('empty')]),
    doOp('fs.delete', [path('out', 'new.txt')]),
    doOp('fs.makeFolder', [path('empty')]),
    each('p', b.op('fs.walk', [root()]), [show(v('p'))]),
    say(b.op('fs.readText', [path('a.txt')])),
    say(b.op('fs.readText', [path('out', 'docs', 'readme.md')])),
  ]),
};

const functions: Case = {
  name: 'functions',
  tree: T1,
  program: b.program(
    [
      show(b.call('fact', [L(10)])),
      b.assign('xs', b.list(T.number, [])),
      b.do(b.call('add_all', [v('xs'), L(5)])),
      show(b.op('list.length', [v('xs')])),
      show(b.call('count_files', [root()])),
      say(b.call('first_name', [path('docs')])),
      say(b.call('first_name', [path('empty')])),
      b.assign('i', L(0)),
      b.while(b.bin('<', v('i'), L(3)), [b.assign('i', b.bin('+', v('i'), L(1))), show(v('i'))]),
      b.if(
        b.bin('>', v('i'), L(5)),
        [say(L('big'))],
        [b.if(b.bin('>', v('i'), L(2)), [say(L('medium'))], [say(L('small'))])],
      ),
    ],
    [
      b.fn('fact', [{ name: 'n', type: T.number }], T.number, [
        b.if(
          b.bin('<=', v('n'), L(1)),
          [b.ret(L(1))],
          [b.ret(b.bin('*', v('n'), b.call('fact', [b.bin('-', v('n'), L(1))])))],
        ),
      ]),
      b.fn(
        'add_all',
        [
          { name: 'items', type: T.list(T.number) },
          { name: 'x', type: T.number },
        ],
        null,
        [doOp('list.append', [v('items'), v('x')])],
      ),
      b.fn('count_files', [{ name: 'folder', type: T.path }], T.number, [
        b.ret(b.op('list.length', [b.op('fs.walk', [v('folder')])])),
      ]),
      b.fn('first_name', [{ name: 'folder', type: T.path }], T.text, [
        each('p', b.op('fs.list', [v('folder')]), [b.ret(b.op('fs.name', [v('p')]))]),
        b.ret(L('(none)')),
      ]),
      b.fn('nothing', [], null, []),
    ],
  ),
};

// --------------------------------------------------------- composites (fake)

/** renameByPattern(folder=root, match="IMG_*.jpg", template="photo_{n:3}{ext}"), hand-desugared. */
const renameComposite: Case = {
  name: 'composite-rename',
  tree: tree([
    binary('IMG_0002.JPG', 10),
    binary('img_0001.jpg', 20),
    file('notes.txt', 'n'),
    folder('IMG_dir.jpg', []),
  ]),
  program: b.program([
    say(L('Renaming photos'), 's1'),
    b.composite(
      'renameByPattern',
      {
        fields: { match: 'IMG_*.jpg', template: 'photo_{n:3}{ext}' },
        inputs: { folder: root('rp_f') },
      },
      'rp',
    ),
    show(b.op('list.length', [b.op('fs.list', [root('s2r')], 's2l')], 's2n'), 's2'),
  ]),
  desugar: fakeDesugar({
    rp: [
      b.assign('folder', root('rp_f'), 'rp/folder'),
      b.assign('n', L(0, 'rp/n0'), 'rp/n'),
      b.forEach(
        'item',
        b.op('fs.list', [v('folder', 'rp/lf')], 'rp/list'),
        [
          b.if(
            b.bin(
              'and',
              b.not(b.op('fs.isFolder', [v('item', 'rp/i1')], 'rp/isdir'), 'rp/not'),
              b.op(
                'text.wildcard',
                [b.op('fs.name', [v('item', 'rp/i2')], 'rp/nm'), L('IMG_*.jpg', 'rp/pat')],
                'rp/wc',
              ),
              'rp/and',
            ),
            [
              b.assign('n', b.bin('+', v('n', 'rp/n1'), L(1, 'rp/one'), 'rp/inc'), 'rp/count'),
              b.assign('ext', b.op('fs.ext', [v('item', 'rp/i3')], 'rp/ext0'), 'rp/ext'),
              b.if(
                b.bin('!=', v('ext', 'rp/e1'), L('', 'rp/e2'), 'rp/hasext'),
                [
                  b.assign(
                    'ext',
                    b.bin('+', L('.', 'rp/dot'), v('ext', 'rp/e3'), 'rp/dext'),
                    'rp/ext2',
                  ),
                ],
                [],
                'rp/ifext',
              ),
              b.assign(
                'new_name',
                b.bin(
                  '+',
                  b.bin(
                    '+',
                    L('photo_', 'rp/l1'),
                    b.op('text.padNumber', [v('n', 'rp/n2'), L(3, 'rp/w')], 'rp/pad'),
                    'rp/c1',
                  ),
                  v('ext', 'rp/e4'),
                  'rp/c2',
                ),
                'rp/new',
              ),
              b.if(
                b.bin(
                  '!=',
                  v('new_name', 'rp/nn1'),
                  b.op('fs.name', [v('item', 'rp/i4')], 'rp/nm2'),
                  'rp/ne',
                ),
                [
                  b.do(
                    b.op('fs.rename', [v('item', 'rp/i5'), v('new_name', 'rp/nn2')], 'rp/rename'),
                    'rp/do',
                  ),
                ],
                [],
                'rp/ifne',
              ),
            ],
            [],
            'rp/match',
          ),
        ],
        'rp/loop',
      ),
    ],
  }),
};

/** findAndAct(recursive, namePattern="*.tmp", action=delete), hand-desugared; destructive. */
const deleteComposite: Case = {
  name: 'composite-delete',
  tree: tree([
    file('keep.txt', 'k'),
    file('a.TMP', 't'),
    folder('build', [file('b.tmp', 't'), folder('x', [file('c.tmp', '')])]),
  ]),
  program: b.program([
    b.composite(
      'findAndAct',
      {
        fields: { recursive: true, namePattern: '*.tmp', action: 'delete' },
        inputs: { folder: root('fa_f') },
      },
      'fa',
    ),
    b.do(b.op('fs.writeText', [path('log.txt'), L('cleaned')], 'w1'), 'w'),
  ]),
  desugar: fakeDesugar({
    fa: [
      b.assign('items', b.op('fs.walk', [root('fa_f')], 'fa/walk'), 'fa/items'),
      b.forEach(
        'item',
        v('items', 'fa/iv'),
        [
          b.if(
            b.op(
              'text.wildcard',
              [b.op('fs.name', [v('item', 'fa/i1')], 'fa/nm'), L('*.tmp', 'fa/pat')],
              'fa/wc',
            ),
            [b.do(b.op('fs.delete', [v('item', 'fa/i2')], 'fa/delete'), 'fa/do')],
            [],
            'fa/if',
          ),
        ],
        'fa/loop',
      ),
    ],
  }),
};

/** findFirst(sortBy=name), hand-desugared (bisect). User subtrees are shared, as in desugaring. */
const ffCondition = b.op(
  'text.contains',
  [b.op('fs.readText', [v('candidate', 'c1')], 'c2'), L('ERROR', 'c3')],
  'c4',
);
const ffFound = [say(plus(L('first bad: '), b.op('fs.name', [v('match')])), 'u1')];
const ffNotFound = [say(L('all good'), 'u2')];
const bisectComposite: Case = {
  name: 'composite-bisect',
  tree: tree(
    Array.from({ length: 9 }, (_, i) =>
      file(`day${i + 1}.log`, i + 1 >= 6 ? 'status: ERROR' : 'status: OK', T0 + i),
    ),
  ),
  program: b.program([
    b.composite(
      'findFirst',
      {
        fields: { sortBy: 'name' },
        inputs: { folder: root('ff_f'), condition: ffCondition },
        bodies: { found: ffFound, notFound: ffNotFound },
        binds: {},
      },
      'ff',
    ),
  ]),
  desugar: fakeDesugar({
    ff: [
      b.assign('folder', root('ff_f'), 'ff/folder'),
      b.assign('files', b.list(T.path, [], 'ff/empty'), 'ff/files'),
      b.forEach(
        'item',
        b.op('fs.list', [v('folder', 'ff/f1')], 'ff/list'),
        [
          b.if(
            b.not(b.op('fs.isFolder', [v('item', 'ff/i1')], 'ff/isdir'), 'ff/not'),
            [
              b.do(
                b.op('list.append', [v('files', 'ff/f2'), v('item', 'ff/i2')], 'ff/app'),
                'ff/doapp',
              ),
            ],
            [],
            'ff/iffile',
          ),
        ],
        'ff/collect',
      ),
      b.assign(
        'items',
        b.op('list.sortBy', [v('files', 'ff/f3'), L('name', 'ff/k'), L(false, 'ff/d')], 'ff/sort'),
        'ff/items',
      ),
      b.assign('low', L(0, 'ff/z'), 'ff/low', { indexInto: 'items' }),
      b.assign('high', b.op('list.length', [v('items', 'ff/it1')], 'ff/len'), 'ff/high', {
        indexInto: 'items',
      }),
      b.while(
        b.bin('<', v('low', 'ff/l1'), v('high', 'ff/h1'), 'ff/lt'),
        [
          b.assign(
            'mid',
            b.bin(
              '//',
              b.bin('+', v('low', 'ff/l2'), v('high', 'ff/h2'), 'ff/sum'),
              L(2, 'ff/two'),
              'ff/half',
            ),
            'ff/mid',
            { indexInto: 'items' },
          ),
          b.assign(
            'candidate',
            b.op('list.get', [v('items', 'ff/it2'), v('mid', 'ff/m1')], 'ff/get'),
            'ff/cand',
          ),
          b.if(
            ffCondition,
            [b.assign('high', v('mid', 'ff/m2'), 'ff/sethigh')],
            [b.assign('low', b.bin('+', v('mid', 'ff/m3'), L(1, 'ff/one'), 'ff/inc'), 'ff/setlow')],
            'ff/test',
          ),
        ],
        'ff/loop',
      ),
      b.if(
        b.bin(
          '<',
          v('low', 'ff/l3'),
          b.op('list.length', [v('items', 'ff/it3')], 'ff/len2'),
          'ff/found?',
        ),
        [
          b.assign(
            'match',
            b.op('list.get', [v('items', 'ff/it4'), v('low', 'ff/l4')], 'ff/get2'),
            'ff/match',
          ),
          ...ffFound,
        ],
        ffNotFound,
        'ff/result',
      ),
    ],
  }),
};

export const CASES: Case[] = [
  numbers,
  text,
  lists,
  fsReads,
  sortBy,
  mutations,
  functions,
  renameComposite,
  deleteComposite,
  bisectComposite,
];

// --------------------------------------------------------------- error cases

const err = (
  name: string,
  code: string,
  nodeId: string,
  stmts: Stmt[],
  fns = [] as Program['functions'],
): Case => ({
  name: `error-${name}`,
  tree: T1,
  program: b.program([say(L('start')), ...stmts, say(L('never'))], fns),
  error: { code, nodeId },
});

export const ERROR_CASES: Case[] = [
  err('div-zero', 'DIVISION_BY_ZERO', 'E', [
    b.assign('z', L(0)),
    show(b.bin('/', L(1), v('z'), 'E')),
  ]),
  err('floordiv-zero', 'DIVISION_BY_ZERO', 'E', [
    b.assign('z', F(0)),
    show(b.bin('//', L(1), v('z'), 'E')),
  ]),
  err('mod-zero', 'DIVISION_BY_ZERO', 'E', [show(b.bin('%', L(5), F(0), 'E'))]),
  err('index', 'INDEX_OUT_OF_RANGE', 'E', [show(b.op('list.get', [nums(1, 2), L(2)], 'E'))]),
  err('index-negative', 'INDEX_OUT_OF_RANGE', 'E', [
    show(b.op('list.get', [nums(1, 2), b.neg(L(1))], 'E')),
  ]),
  err('index-float', 'INVALID_NUMBER', 'E', [show(b.op('list.get', [nums(1, 2), F(1)], 'E'))]),
  err('to-number', 'INVALID_NUMBER', 'E', [show(b.op('text.toNumber', [L('12a')], 'E'))]),
  err('pad-float', 'INVALID_NUMBER', 'E', [say(b.op('text.padNumber', [F(2), L(3)], 'E'))]),
  err('range-float', 'INVALID_NUMBER', 'E', [
    show(b.op('list.length', [b.op('list.range', [L(0), F(2)], 'E')])),
  ]),
  err('date-huge', 'INVALID_NUMBER', 'E', [say(b.op('text.date', [F(1e20)], 'E'))]),
  err('floor-inf', 'INT_OVERFLOW', 'E', [
    show(b.op('math.floor', [b.bin('*', F(1e308), L(10))], 'E')),
  ]),
  err('read-missing', 'NOT_FOUND', 'E', [say(b.op('fs.readText', [path('missing.txt')], 'E'))]),
  err('is-folder-missing', 'NOT_FOUND', 'E', [show(b.op('fs.isFolder', [path('nope')], 'E'))]),
  err('modified-missing', 'NOT_FOUND', 'E', [show(b.op('fs.modified', [path('nope')], 'E'))]),
  err('mkdir-exists', 'ALREADY_EXISTS', 'E', [doOp('fs.makeFolder', [path('DOCS')], 'E')]),
  err('mkdir-root', 'ALREADY_EXISTS', 'E', [doOp('fs.makeFolder', [root()], 'E')]),
  err('mkdir-no-parent', 'NOT_FOUND', 'E', [doOp('fs.makeFolder', [path('nope', 'x')], 'E')]),
  err('delete-not-empty', 'NOT_EMPTY', 'E', [doOp('fs.delete', [path('docs')], 'E')]),
  err('delete-root', 'ROOT_PROTECTED', 'E', [doOp('fs.delete', [root()], 'E')]),
  err('delete-missing', 'NOT_FOUND', 'E', [doOp('fs.delete', [path('nope')], 'E')]),
  err('join-invalid', 'INVALID_NAME', 'E', [show(b.op('fs.join', [root(), L('a:b')], 'E'))]),
  err('rename-invalid', 'INVALID_NAME', 'E', [
    show(b.op('fs.rename', [path('nope'), L('CON')], 'E')),
  ]),
  err('rename-root', 'ROOT_PROTECTED', 'E', [show(b.op('fs.rename', [root(), L('x')], 'E'))]),
  err('rename-clash', 'ALREADY_EXISTS', 'E', [
    show(b.op('fs.rename', [path('a.txt'), L('NOTES.txt')], 'E')),
  ]),
  err('list-file', 'NOT_A_FOLDER', 'E', [
    show(b.op('list.length', [b.op('fs.list', [path('a.txt')], 'E')])),
  ]),
  err('walk-missing', 'NOT_FOUND', 'E', [
    show(b.op('list.length', [b.op('fs.walk', [path('nope')], 'E')])),
  ]),
  err('size-folder', 'NOT_A_FILE', 'E', [show(b.op('fs.size', [path('docs')], 'E'))]),
  err('read-binary', 'NOT_TEXT', 'E', [say(b.op('fs.readText', [path('B.jpg')], 'E'))]),
  err('read-nul', 'NOT_TEXT', 'E', [say(b.op('fs.readText', [path('data.bin')], 'E'))]),
  err('read-folder', 'NOT_A_FILE', 'E', [say(b.op('fs.readText', [path('docs')], 'E'))]),
  err('move-into-self', 'INVALID_MOVE', 'E', [
    show(b.op('fs.move', [path('docs'), path('DOCS', 'sub')], 'E')),
  ]),
  err('copy-into-self', 'INVALID_MOVE', 'E', [
    show(b.op('fs.copy', [path('docs'), path('docs')], 'E')),
  ]),
  err('move-dest-file', 'NOT_A_FOLDER', 'E', [
    show(b.op('fs.move', [path('docs'), path('a.txt')], 'E')),
  ]),
  err('move-dest-missing', 'NOT_FOUND', 'E', [
    show(b.op('fs.move', [path('a.txt'), path('nope')], 'E')),
  ]),
  err('move-root', 'ROOT_PROTECTED', 'E', [show(b.op('fs.move', [root(), path('docs')], 'E'))]),
  err('copy-clash', 'ALREADY_EXISTS', 'E', [show(b.op('fs.copy', [path('a.txt'), root()], 'E'))]),
  err('copy-missing', 'NOT_FOUND', 'E', [
    show(b.op('fs.copy', [path('nope'), path('nope2')], 'E')),
  ]),
  err('write-root', 'ROOT_PROTECTED', 'E', [doOp('fs.writeText', [root(), L('x')], 'E')]),
  err('write-no-parent', 'NOT_FOUND', 'E', [
    doOp('fs.writeText', [path('a.txt', 'x.txt'), L('x')], 'E'),
  ]),
  err('write-folder', 'NOT_A_FILE', 'E', [doOp('fs.writeText', [path('Docs'), L('x')], 'E')]),
  err('parent-root', 'OUTSIDE_ROOT', 'E', [show(b.op('fs.parent', [root()], 'E'))]),
  err('sort-by-size-folder', 'NOT_A_FILE', 'E', [
    show(
      b.op('list.length', [
        b.op('list.sortBy', [b.op('fs.list', [root()]), L('size'), L(false)], 'E'),
      ]),
    ),
  ]),
  err('sort-by-modified-missing', 'NOT_FOUND', 'E', [
    show(
      b.op('list.length', [
        b.op(
          'list.sortBy',
          [b.list(T.path, [path('a.txt'), path('gone')]), L('modified'), L(true)],
          'E',
        ),
      ]),
    ),
  ]),
  err(
    'in-function',
    'NOT_FOUND',
    'E',
    [say(b.call('read_it', [path('nope')], 'callsite'))],
    [
      b.fn('read_it', [{ name: 'p', type: T.path }], T.text, [
        b.ret(b.op('fs.readText', [v('p')], 'E')),
      ]),
    ],
  ),
  err('partial-failure', 'NOT_FOUND', 'E', [
    doOp('fs.makeFolder', [path('new')]),
    show(b.op('fs.move', [path('a.txt'), path('new')])),
    doOp('fs.writeText', [path('new', 'w.txt'), L('w')]),
    show(b.op('fs.move', [path('B.jpg'), path('missing-dir')], 'E')),
  ]),
];
