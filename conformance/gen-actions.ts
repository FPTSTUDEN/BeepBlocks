/**
 * Generates conformance fixtures for the v1.1 action blocks (design.md v1.1 §5, §11), with
 * HAND-DERIVED expected results. `pnpm gen:actions` writes program.json, tree.json and
 * expected.json for each. The runner independently checks simulator == Python, so a wrong
 * golden here is caught, not hidden.
 *
 * Every tree uses `modified` epoch seconds. Action output lines follow src/ir/timeline.ts:
 *   MKDIR  <dir>/            MOVE/COPY <from> -> <parent>/      RENAME <from> -> <newBase>
 *   DELETE <path>
 * Folder children are shown sorted by lowercase name then code point (design.md §5.3).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { b } from '../src/ir/build.ts';
import type { Program, Stmt } from '../src/ir/types.ts';
import { T } from '../src/ir/types.ts';
import type { FsNode, SandboxFS } from '../src/domains/fileExplorer/fsTypes.ts';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

// ---------------------------------------------------------------- tree helpers

const f = (name: string, content: string, modified = 0): FsNode => ({ type: 'file', name, modified, content });
const bin = (name: string, binarySize: number, modified = 0): FsNode => ({ type: 'file', name, modified, binarySize });
const dir = (name: string, children: FsNode[], modified = 0): FsNode => ({ type: 'folder', name, modified, children });
const tree = (children: FsNode[]): SandboxFS => ({ root: { type: 'folder', name: '', modified: 0, children } });

const prog = (body: Stmt[]): Program => ({ format: 'beepblocks-ir', version: 2, functions: [], body });
const rootIn = (name: string) => b.op('fs.join', [b.root(), b.lit(name)]);

interface Expected {
  output: string[];
  error: null | { code: string; nodeId: string };
  tree: SandboxFS;
}
interface Fixture {
  name: string;
  program: Program;
  tree: SandboxFS;
  expected: Expected;
}

const fixtures: Fixture[] = [];
const add = (name: string, program: Program, t: SandboxFS, expected: Expected) =>
  fixtures.push({ name, program, tree: t, expected });

// A small folder reused by several fixtures: 3 files + 1 subfolder with 1 file.
//   a.txt (1 byte, t=10), big.txt (10 bytes, t=40), mid.TXT (3 bytes, t=20), sub/ (t=5) { deep.txt (5 bytes, t=30) }
const mixed = (): FsNode[] => [
  f('a.txt', 'x', 10),
  bin('big.txt', 10, 40),
  f('mid.TXT', 'xyz', 20),
  dir('sub', [f('deep.txt', 'hello', 30)], 5),
];

// ============================================================ everyFile

// move every .txt (non-recursive) into dest, making it. Only top-level files; "sub" is a folder (skipped).
// Listing order of root: a.txt, big.txt, dest? (created first), mid.TXT, sub. dest is created before the loop body
// runs? No — makeFolder happens inside the loop on the first matching file. Order of matches = fs.list order of the
// ORIGINAL listing captured once: [a.txt, big.txt, mid.TXT, sub]. So: a.txt -> mkdir dest, move; big.txt move; mid.TXT move.
add(
  'act-everyfile-move',
  prog([
    b.composite('everyFile', {
      fields: { action: 'move', includeSubfolders: false, makeFolder: true },
      inputs: { folder: b.root(), destination: rootIn('dest') },
      binds: { file: 'file' },
    }),
  ]),
  tree(mixed()),
  {
    output: ['MKDIR  dest/', 'MOVE   a.txt -> dest/', 'MOVE   big.txt -> dest/', 'MOVE   mid.TXT -> dest/'],
    error: null,
    tree: tree([
      dir('dest', [f('a.txt', 'x', 10), bin('big.txt', 10, 40), f('mid.TXT', 'xyz', 20)]),
      dir('sub', [f('deep.txt', 'hello', 30)], 5),
    ]),
  },
);

// copy every file recursively into dest (pre-existing, makeFolder=false). Recursive walk order (fs.walk, files only,
// children in fs.list order, depth-first): a.txt, big.txt, mid.TXT, sub/deep.txt. dest already exists so it is NOT
// walked? fs.walk is computed once at the start over the original tree, which has no dest. We pre-create dest in the
// tree. walk(root) yields files under root incl. dest's (none) — order: a.txt, big.txt, mid.TXT, sub/deep.txt.
// Each file whose parent != dest is copied into dest. deep.txt's parent is sub, so it is copied too.
add(
  'act-everyfile-copy',
  prog([
    b.composite('everyFile', {
      fields: { action: 'copy', includeSubfolders: true, makeFolder: false },
      inputs: { folder: b.root(), destination: rootIn('dest') },
      binds: { file: 'file' },
    }),
  ]),
  tree([...mixed(), dir('dest', [], 1)]),
  {
    output: [
      'COPY   a.txt -> dest/',
      'COPY   big.txt -> dest/',
      'COPY   mid.TXT -> dest/',
      'COPY   sub/deep.txt -> dest/',
    ],
    error: null,
    tree: tree([
      f('a.txt', 'x', 10),
      bin('big.txt', 10, 40),
      dir('dest', [f('a.txt', 'x', 10), bin('big.txt', 10, 40), f('deep.txt', 'hello', 30), f('mid.TXT', 'xyz', 20)], 1),
      f('mid.TXT', 'xyz', 20),
      dir('sub', [f('deep.txt', 'hello', 30)], 5),
    ]),
  },
);

// delete every file whose name matches *.txt (lowercase wildcard, case-insensitive) non-recursively.
// Matches top-level files a.txt, big.txt, mid.TXT (wildcard is case-insensitive). sub is a folder → skipped.
add(
  'act-everyfile-delete',
  prog([
    b.composite('everyFile', {
      fields: { action: 'delete', includeSubfolders: false, makeFolder: false },
      inputs: {
        folder: b.root(),
        condition: b.op('text.wildcard', [b.op('fs.name', [b.v('file')]), b.lit('*.txt')]),
      },
      binds: { file: 'file' },
    }),
  ]),
  tree(mixed()),
  {
    output: ['DELETE a.txt', 'DELETE big.txt', 'DELETE mid.TXT'],
    error: null,
    tree: tree([dir('sub', [f('deep.txt', 'hello', 30)], 5)]),
  },
);

// rename every file recursively to "renamed-{n}<ext>". {n} counts matched files in walk order.
// walk order: a.txt (n=1), big.txt (n=2), mid.TXT (n=3), sub/deep.txt (n=4). ext keeps original case.
add(
  'act-everyfile-rename',
  prog([
    b.composite('everyFile', {
      fields: { action: 'rename', includeSubfolders: true, makeFolder: false, renameTemplate: 'renamed-{n}{ext}' },
      inputs: { folder: b.root() },
      binds: { file: 'file' },
    }),
  ]),
  tree(mixed()),
  {
    output: [
      'RENAME a.txt -> renamed-1.txt',
      'RENAME big.txt -> renamed-2.txt',
      'RENAME mid.TXT -> renamed-3.TXT',
      'RENAME sub/deep.txt -> renamed-4.txt',
    ],
    error: null,
    tree: tree([
      f('renamed-1.txt', 'x', 10),
      bin('renamed-2.txt', 10, 40), // big.txt stays binary across a rename
      f('renamed-3.TXT', 'xyz', 20),
      dir('sub', [f('renamed-4.txt', 'hello', 30)], 5),
    ]),
  },
);

// ============================================================ makeFolderIfMissing

// Missing → created. Exists → nothing. Two blocks in one program cover both variants.
add(
  'act-makefolder',
  prog([
    b.composite('makeFolderIfMissing', { inputs: { path: rootIn('new') } }),
    b.composite('makeFolderIfMissing', { inputs: { path: rootIn('old') } }),
  ]),
  tree([dir('old', [], 1)]),
  {
    output: ['MKDIR  new/'],
    error: null,
    tree: tree([dir('new', []), dir('old', [], 1)]),
  },
);

// ============================================================ goThrough

// Go through files one by one (recursive) and print each name. Covers goThrough includeSubfolders=true.
add(
  'act-gothrough-recursive',
  prog([
    b.composite('goThrough', {
      fields: { includeSubfolders: true },
      inputs: { folder: b.root() },
      bodies: { body: [b.print(b.op('fs.name', [b.v('file')]))] },
      binds: { file: 'file' },
    }),
  ]),
  tree(mixed()),
  { output: ['a.txt', 'big.txt', 'mid.TXT', 'deep.txt'], error: null, tree: tree(mixed()) },
);

// Non-recursive: only top-level files, in fs.list order (folders skipped by goThrough).
add(
  'act-gothrough-flat',
  prog([
    b.composite('goThrough', {
      fields: { includeSubfolders: false },
      inputs: { folder: b.root() },
      bodies: { body: [b.print(b.op('fs.name', [b.v('file')]))] },
      binds: { file: 'file' },
    }),
  ]),
  tree(mixed()),
  { output: ['a.txt', 'big.txt', 'mid.TXT'], error: null, tree: tree(mixed()) },
);

// ============================================================ repeatTimes / keepDoingUntil

// repeat 3 times: print a counter-free line. Covers repeatTimes.
add(
  'act-repeat',
  prog([b.composite('repeatTimes', { inputs: { n: b.lit(3) }, bodies: { body: [b.print(b.lit('tick'))] } })]),
  tree([]),
  { output: ['tick', 'tick', 'tick'], error: null, tree: tree([]) },
);

// keep doing until: count up from 0, stop when count == 3. Checks before each round, so body runs 3 times.
add(
  'act-keepuntil',
  prog([
    b.assign('k', b.lit(0), 'k0'),
    b.composite('keepDoingUntil', {
      inputs: { condition: b.bin('==', b.v('k'), b.lit(3)) },
      bodies: {
        body: [b.print(b.str(b.v('k'))), b.assign('k', b.bin('+', b.v('k'), b.lit(1)), 'kinc')],
      },
    }),
  ]),
  tree([]),
  { output: ['0', '1', '2'], error: null, tree: tree([]) },
);

// ============================================================ findFile (5 kinds + ties + notFound)

// Files: a.txt(size1,t10), big.txt(size10,t40), mid.TXT(size3,t20), tie.txt(size10,t40).
// listing order (lowercase name): a.txt, big.txt, mid.txt, tie.txt.
//   biggest: size10 first seen = big.txt (tie.txt not strictly greater) → big.txt
//   smallest: size1 → a.txt
//   newest: t40 first seen = big.txt
//   oldest: t10 = a.txt
//   first: a.txt (first non-folder in listing order)
const findTree = (): FsNode[] => [
  f('a.txt', 'x', 10),
  bin('big.txt', 10, 40),
  f('mid.TXT', 'xyz', 20),
  bin('tie.txt', 10, 40),
];
const findFile = (which: string, found: string) =>
  add(
    `act-findfile-${which}`,
    prog([
      b.composite('findFile', {
        fields: { which, includeSubfolders: false },
        inputs: { folder: b.root() },
        bodies: { found: [b.print(b.op('fs.name', [b.v('found')]))], notFound: [b.print(b.lit('none'))] },
        binds: { file: 'file', found: 'found' },
      }),
    ]),
    tree(findTree()),
    { output: [found], error: null, tree: tree(findTree()) },
  );
findFile('first', 'a.txt');
findFile('biggest', 'big.txt');
findFile('smallest', 'a.txt');
findFile('newest', 'big.txt');
findFile('oldest', 'a.txt');

// notFound: a condition no file meets.
add(
  'act-findfile-notfound',
  prog([
    b.composite('findFile', {
      fields: { which: 'first', includeSubfolders: false },
      inputs: {
        folder: b.root(),
        condition: b.op('text.wildcard', [b.op('fs.name', [b.v('file')]), b.lit('*.zip')]),
      },
      bodies: { found: [b.print(b.op('fs.name', [b.v('found')]))], notFound: [b.print(b.lit('none'))] },
      binds: { file: 'file', found: 'found' },
    }),
  ]),
  tree(findTree()),
  { output: ['none'], error: null, tree: tree(findTree()) },
);

// ============================================================ expression actions: filesIn / countFiles / typeOf

// filesIn lined up by name (ascending), printed one per line. order=name.
// files: c.txt, a.txt, b.txt → sorted by name: a.txt, b.txt, c.txt
const abc = (): FsNode[] => [f('c.txt', 'c', 30), f('a.txt', 'a', 10), f('b.txt', 'b', 20)];
const printList = (listExpr: ReturnType<typeof b.compositeExpr>): Stmt[] => [
  b.assign('files', listExpr, 'files'),
  b.forEach('p', b.v('files'), [b.print(b.op('fs.name', [b.v('p')]))], 'loop'),
];
add(
  'expr-filesin-name',
  prog(printList(b.compositeExpr('filesIn', { fields: { includeSubfolders: false, order: 'name' }, inputs: { folder: b.root() } }))),
  tree(abc()),
  { output: ['a.txt', 'b.txt', 'c.txt'], error: null, tree: tree(abc()) },
);
// order=listing: fs.list order (already lowercase-name sorted): a.txt, b.txt, c.txt (same set, but no sortBy op).
add(
  'expr-filesin-listing',
  prog(printList(b.compositeExpr('filesIn', { fields: { includeSubfolders: false, order: 'listing' }, inputs: { folder: b.root() } }))),
  tree(abc()),
  { output: ['a.txt', 'b.txt', 'c.txt'], error: null, tree: tree(abc()) },
);
// order=size descending: sizes a=1,b=1,c=1 equal → stable, keeps listing order a,b,c. Use distinct sizes instead.
const sized = (): FsNode[] => [bin('a.txt', 1, 10), bin('b.txt', 9, 20), bin('c.txt', 5, 30)];
add(
  'expr-filesin-size',
  prog(printList(b.compositeExpr('filesIn', { fields: { includeSubfolders: false, order: 'size' }, inputs: { folder: b.root() } }))),
  tree(sized()),
  { output: ['b.txt', 'c.txt', 'a.txt'], error: null, tree: tree(sized()) }, // 9,5,1 descending
);
// order=date descending: newest first. t: a=10,b=20,c=30 → c,b,a
add(
  'expr-filesin-date',
  prog(printList(b.compositeExpr('filesIn', { fields: { includeSubfolders: false, order: 'date' }, inputs: { folder: b.root() } }))),
  tree(abc()),
  { output: ['c.txt', 'b.txt', 'a.txt'], error: null, tree: tree(abc()) },
);

// countFiles: count .txt files recursively. mixed(): a.txt, big.txt, mid.TXT, sub/deep.txt = 4 files; all count.
add(
  'expr-countfiles',
  prog([b.assign('n', b.compositeExpr('countFiles', { fields: { includeSubfolders: true }, inputs: { folder: b.root() } }), 'n'), b.print(b.str(b.v('n')))]),
  tree(mixed()),
  { output: ['4'], error: null, tree: tree(mixed()) },
);

// typeOf by category and by extension on a single file.
add(
  'expr-typeof-category',
  prog([b.assign('t', b.compositeExpr('typeOf', { fields: { by: 'category' }, inputs: { file: rootIn('photo.JPG') } }), 't'), b.print(b.v('t'))]),
  tree([bin('photo.JPG', 100, 10)]),
  { output: ['Images'], error: null, tree: tree([bin('photo.JPG', 100, 10)]) },
);
add(
  'expr-typeof-extension',
  prog([b.assign('t', b.compositeExpr('typeOf', { fields: { by: 'extension' }, inputs: { file: rootIn('data.CSV') } }), 't'), b.print(b.v('t'))]),
  tree([f('data.CSV', 'x', 10)]),
  { output: ['csv'], error: null, tree: tree([f('data.CSV', 'x', 10)]) },
);

// ============================================================ halvingSearch

// Binary search by name for the first file whose name >= "d". Sorted names: a,b,c,d,e,f,g.
// Answer = d.txt. Covers halvingSearch (found).
const seven = (): FsNode[] => 'abcdefg'.split('').map((c, i) => f(`${c}.txt`, c, 10 + i));
add(
  'expr-halving-found',
  prog([
    b.assign('line', b.compositeExpr('filesIn', { fields: { includeSubfolders: false, order: 'name' }, inputs: { folder: b.root() } }), 'line'),
    b.composite('halvingSearch', {
      inputs: { line: b.v('line') },
      bodies: {
        decide: [
          b.if(
            b.bin('>=', b.op('fs.name', [b.v('middle')]), b.lit('d.txt'), 'cmp'),
            [b.composite('keepLeftHalf')],
            [b.composite('keepRightHalf')],
            'decide-if',
          ),
        ],
        found: [b.print(b.op('fs.name', [b.v('answer')]))],
        notFound: [b.print(b.lit('none'))],
      },
      binds: { middle: 'middle', answer: 'answer' },
    }),
  ]),
  tree(seven()),
  { output: ['d.txt'], error: null, tree: tree(seven()) },
);
// notFound: condition false for every file → low ends at length → notFound.
add(
  'expr-halving-notfound',
  prog([
    b.assign('line', b.compositeExpr('filesIn', { fields: { includeSubfolders: false, order: 'name' }, inputs: { folder: b.root() } }), 'line'),
    b.composite('halvingSearch', {
      inputs: { line: b.v('line') },
      bodies: {
        decide: [
          b.if(
            b.bin('>', b.op('fs.name', [b.v('middle')]), b.lit('zzz'), 'cmp'),
            [b.composite('keepLeftHalf')],
            [b.composite('keepRightHalf')],
            'decide-if',
          ),
        ],
        found: [b.print(b.op('fs.name', [b.v('answer')]))],
        notFound: [b.print(b.lit('none'))],
      },
      binds: { middle: 'middle', answer: 'answer' },
    }),
  ]),
  tree(seven()),
  { output: ['none'], error: null, tree: tree(seven()) },
);

// ============================================================ hoisting positions

// hoist statement: countFiles used in an assign value (already covered by expr-countfiles, but make the dedicated
// "hoist statement" variant explicit in an if condition).
add(
  'hoist-if',
  prog([
    b.if(
      b.bin('>', b.compositeExpr('countFiles', { fields: { includeSubfolders: false }, inputs: { folder: b.root() } }), b.lit(1), 'cmp'),
      [b.print(b.lit('many'))],
      [b.print(b.lit('few'))],
      'if',
    ),
  ]),
  tree([f('a.txt', 'a', 10), f('b.txt', 'b', 20)]),
  { output: ['many'], error: null, tree: tree([f('a.txt', 'a', 10), f('b.txt', 'b', 20)]) },
);

// hoist while condition: loop while countFiles(root) > 0, deleting one file per round. Re-evaluated each round.
// 2 files → round1 count=2>0 delete a.txt; round2 count=1>0 delete b.txt; round3 count=0 stop.
add(
  'hoist-while',
  prog([
    b.assign('names', b.op('fs.list', [b.root()]), 'names0'),
    b.while(
      b.bin('>', b.compositeExpr('countFiles', { fields: { includeSubfolders: false }, inputs: { folder: b.root() } }), b.lit(0), 'cmp'),
      [
        b.assign('first', b.op('list.get', [b.op('fs.list', [b.root()]), b.lit(0)]), 'first'),
        b.do(b.op('fs.delete', [b.v('first')]), 'del'),
      ],
      'while',
    ),
  ]),
  tree([f('a.txt', 'a', 10), f('b.txt', 'b', 20)]),
  { output: ['DELETE a.txt', 'DELETE b.txt'], error: null, tree: tree([]) },
);

// hoist short circuit: false and countFiles(...) > 0. The right side (with the expression action) must NOT run.
// If it did run it would still be harmless here, but the point is short-circuit placement; we assert "no".
add(
  'hoist-shortcircuit',
  prog([
    b.if(
      b.bin(
        'and',
        b.lit(false),
        b.bin('>', b.compositeExpr('countFiles', { fields: { includeSubfolders: false }, inputs: { folder: b.root() } }), b.lit(0), 'cmp'),
        'and',
      ),
      [b.print(b.lit('yes'))],
      [b.print(b.lit('no'))],
      'if',
    ),
  ]),
  tree([f('a.txt', 'a', 10)]),
  { output: ['no'], error: null, tree: tree([f('a.txt', 'a', 10)]) },
);

// ---------------------------------------------------------------- write

// Remove the placeholder mega-fixture if present.
rmSync(join(FIXTURES, 'phase2-coverage'), { recursive: true, force: true });

for (const fx of fixtures) {
  const d = join(FIXTURES, fx.name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'program.json'), JSON.stringify(fx.program, null, 2) + '\n', 'utf8');
  writeFileSync(join(d, 'tree.json'), JSON.stringify(fx.tree, null, 2) + '\n', 'utf8');
  writeFileSync(join(d, 'expected.json'), JSON.stringify(fx.expected) + '\n', 'utf8');
}
console.log(`wrote ${fixtures.length} action fixtures; removed phase2-coverage`);
