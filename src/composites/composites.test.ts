import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import type { CompositeName, CompositeStmt, FieldValue } from '../ir/composites.ts';
import { COMPOSITE_NAMES, COMPOSITE_SCHEMAS } from '../ir/composites.ts';
import { T, type Expr, type Program, type Stmt } from '../ir/types.ts';
import { validateProgram } from '../ir/validate.ts';
import { COMPOSITES, categoryOf, desugarOne, desugarProgram } from './index.ts';
import { makeCtx } from './ctx.ts';
import { show } from './__testing__/pretty.ts';
import { runMini, type MiniEntry } from './__testing__/miniEval.ts';

// ================================================================== helpers

const errors = (p: Program, primitiveOnly = false) =>
  validateProgram(p, { primitiveOnly }).filter((i) => i.severity === 'error');

/** Checks the input is a valid program, desugars it, and checks the result is valid primitive IR. */
function desugarOk(p: Program): Program {
  expect(errors(p)).toEqual([]);
  const d = desugarProgram(p);
  expect(errors(d, true)).toEqual([]);
  return d;
}

type Parts = {
  fields?: Record<string, FieldValue>;
  inputs?: Record<string, Expr>;
  bodies?: Record<string, Stmt[]>;
  binds?: Record<string, string>;
};
const comp = (name: CompositeName, parts: Parts, id = 'c1'): CompositeStmt =>
  b.composite(name, parts, id);
const root = (id = 'in.folder') => b.root(id);
const single = (name: CompositeName, parts: Parts) => b.program([comp(name, parts)]);

/** Every node id in a statement list (statements and expressions). */
function ids(stmts: readonly Stmt[]): string[] {
  const out: string[] = [];
  const ex = (e: Expr): void => {
    out.push(e.id);
    if (e.kind === 'list') e.items.forEach(ex);
    if (e.kind === 'binary') [e.left, e.right].forEach(ex);
    if (e.kind === 'unary') ex(e.arg);
    if (e.kind === 'op' || e.kind === 'call') e.args.forEach(ex);
  };
  const st = (s: Stmt): void => {
    out.push(s.id);
    switch (s.kind) {
      case 'assign':
        return ex(s.value);
      case 'if':
        ex(s.cond);
        s.then.forEach(st);
        return s.else.forEach(st);
      case 'while':
        ex(s.cond);
        return s.body.forEach(st);
      case 'forEach':
        ex(s.list);
        return s.body.forEach(st);
      case 'return':
        return s.value ? ex(s.value) : undefined;
      case 'do':
        return ex(s.expr);
      case 'print':
        return ex(s.value);
      case 'composite':
        Object.values(s.inputs).forEach(ex);
        return Object.values(s.bodies).forEach((body) => body.forEach(st));
    }
  };
  stmts.forEach(st);
  return out;
}

/** Variable names assigned or looped over (declared) in a statement list. */
function declared(stmts: readonly Stmt[]): string[] {
  const out = new Set<string>();
  const st = (s: Stmt): void => {
    if (s.kind === 'assign' || s.kind === 'forEach') out.add(s.name);
    if (s.kind === 'if') [...s.then, ...s.else].forEach(st);
    if (s.kind === 'while' || s.kind === 'forEach') s.body.forEach(st);
  };
  stmts.forEach(st);
  return [...out];
}

const hasComposite = (stmts: readonly Stmt[]): boolean =>
  JSON.stringify(stmts).includes('"kind":"composite"');

// ================================================================= registry

describe('registry', () => {
  it('registers all four composites with their contract schema', () => {
    for (const name of COMPOSITE_NAMES) {
      const def = COMPOSITES[name];
      expect(def).toBeDefined();
      const { desugar, ...schema } = def!;
      expect(typeof desugar).toBe('function');
      expect(schema).toEqual(COMPOSITE_SCHEMAS[name]);
    }
  });
});

// ====================================================================== ctx

describe('DesugarCtx', () => {
  it('freshName is deterministic and avoids used and invalid names', () => {
    const ctx = makeCtx('c', new Set(['item', 'item_2']));
    expect(ctx.freshName('item')).toBe('item_3');
    expect(ctx.freshName('item')).toBe('item_4');
    expect(ctx.freshName('n')).toBe('n');
    expect(ctx.freshName('n')).toBe('n_2');
    expect(ctx.freshName('list')).toBe('list_2'); // 'list' is reserved
  });

  it('id derives from the composite id and rejects reuse', () => {
    const ctx = makeCtx('abc12', new Set());
    expect(ctx.id('loop')).toBe('abc12/loop');
    expect(() => ctx.id('loop')).toThrow(/reused/);
  });
});

// ========================================================== renameByPattern

describe('renameByPattern', () => {
  const rename = (template: string, match = '*') =>
    single('renameByPattern', { fields: { match, template }, inputs: { folder: root() } });

  it.each([
    '{name}{ext}',
    '{name}',
    '{ext}',
    '{n}',
    '{n:3}',
    '{date}',
    'photo',
    '{{x}}',
    '{date}_{n:2}_{name}{ext}',
    '{ext}{ext}{n}{n:4}',
  ])('template %j desugars to valid primitive IR', (template) => {
    desugarOk(rename(template));
  });

  it('golden: {date}_{n:3}{ext}', () => {
    const d = desugarOk(rename('{date}_{n:3}{ext}', '*.jpg'));
    expect(show(d.body)).toBe(
      [
        'n = 0',
        'for item in fs.list(fs.root()):',
        "  if not fs.isFolder(item) and text.wildcard(fs.name(item), '*.jpg'):",
        '    n = n + 1',
        '    ext = fs.ext(item)',
        "    if ext != '':",
        "      ext = '.' + ext",
        "    new_name = ((text.date(fs.modified(item)) + '_') + text.padNumber(n, 3)) + ext",
        '    if new_name != fs.name(item):',
        '      fs.rename(item, new_name)',
      ].join('\n'),
    );
  });

  it('golden: {name} only — no counter and no extension temp', () => {
    const d = desugarOk(rename('{name}'));
    expect(show(d.body)).toBe(
      [
        'for item in fs.list(fs.root()):',
        "  if not fs.isFolder(item) and text.wildcard(fs.name(item), '*'):",
        '    new_name = fs.stem(item)',
        '    if new_name != fs.name(item):',
        '      fs.rename(item, new_name)',
      ].join('\n'),
    );
  });

  it('literal braces and plain {n}', () => {
    const d = desugarOk(rename('{{{n}}}'));
    expect(show(d.body)).toContain("new_name = ('{' + text.from(n)) + '}'");
  });

  it('behaves as specified', () => {
    const tree: MiniEntry[] = [
      { path: 'b.JPG', modified: 86400 },
      { path: 'a.jpg', modified: 0 },
      { path: 'notes.txt' },
      { path: '.bashrc' },
      { path: 'pics.jpg', folder: true },
    ];
    const r = runMini(desugarProgram(rename('{date}_{n:2}{ext}', '*.jpg')), tree);
    expect(r.tree).toEqual([
      '.bashrc',
      '1970-01-01_01.jpg',
      '1970-01-02_02.JPG',
      'notes.txt',
      'pics.jpg/',
    ]);
    // {name}{ext} on '.bashrc' (stem '.bashrc', no ext) is unchanged → skipped, no error.
    const same = runMini(desugarProgram(rename('{name}{ext}')), tree);
    expect(same.tree).toEqual(['.bashrc', 'a.jpg', 'b.JPG', 'notes.txt', 'pics.jpg/']);
  });
});

// =============================================================== sortByType

describe('sortByType', () => {
  const sort = (grouping: string, folder: Expr = root()) =>
    single('sortByType', { fields: { grouping }, inputs: { folder } });

  it('golden: extension grouping', () => {
    const d = desugarOk(sort('extension'));
    expect(show(d.body)).toBe(
      [
        'folder = fs.root()',
        'for item in fs.list(folder):',
        '  if not fs.isFolder(item):',
        '    ext = text.lower(fs.ext(item))',
        "    if ext == '':",
        "      group = 'No extension'",
        '    else:',
        '      group = ext',
        '    target = fs.join(folder, group)',
        '    if not fs.exists(target):',
        '      fs.makeFolder(target)',
        '    fs.move(item, target)',
      ].join('\n'),
    );
  });

  it('category grouping is an if/else chain over list.contains ending in Other', () => {
    const d = desugarOk(sort('category'));
    const text = show(d.body);
    const chain = ['Images', 'Documents', 'Audio', 'Video', 'Archives', 'Code', 'Other'];
    let last = -1;
    for (const name of chain) {
      const at = text.indexOf(`group = '${name}'`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(text).toMatch(/if list\.contains\(\['jpg', 'jpeg', 'png'.*\], ext\):/);
    expect(text.match(/list\.contains/g)).toHaveLength(6);
  });

  it('category table', () => {
    expect(categoryOf('jpg')).toBe('Images');
    expect(categoryOf('pdf')).toBe('Documents');
    expect(categoryOf('mp3')).toBe('Audio');
    expect(categoryOf('mkv')).toBe('Video');
    expect(categoryOf('zip')).toBe('Archives');
    expect(categoryOf('py')).toBe('Code');
    expect(categoryOf('')).toBe('Other');
    expect(categoryOf('xyz')).toBe('Other');
  });

  it('evaluates the folder input exactly once', () => {
    const folder = b.op('fs.join', [b.root('in.r'), b.lit('inbox', 'in.n')], 'in.folder');
    const d = desugarOk(b.program([comp('sortByType', { inputs: { folder } })]));
    expect(ids(d.body).filter((i) => i === 'in.folder')).toHaveLength(1);
  });

  const tree: MiniEntry[] = [
    { path: 'a.JPG' },
    { path: 'b.pdf' },
    { path: 'README' },
    { path: 'd.xyz' },
    { path: 'Images', folder: true },
  ];

  it('behaves as specified: category', () => {
    expect(runMini(desugarProgram(sort('category')), tree).tree).toEqual([
      'Documents/',
      'Documents/b.pdf',
      'Images/',
      'Images/a.JPG',
      'Other/',
      'Other/d.xyz',
      'Other/README',
    ]);
  });

  it('behaves as specified: extension', () => {
    expect(runMini(desugarProgram(sort('extension')), tree).tree).toEqual([
      'Images/',
      'jpg/',
      'jpg/a.JPG',
      'No extension/',
      'No extension/README',
      'pdf/',
      'pdf/b.pdf',
      'xyz/',
      'xyz/d.xyz',
    ]);
  });
});

// =============================================================== findAndAct

describe('findAndAct', () => {
  const dest = () => b.op('fs.join', [b.root('in.d.r'), b.lit('out', 'in.d.n')], 'in.dest');
  const find = (fields: Record<string, FieldValue>, withDest = true) =>
    single('findAndAct', {
      fields,
      inputs: withDest ? { folder: root(), destination: dest() } : { folder: root() },
    });

  const criteria: Record<string, FieldValue>[] = [
    {},
    { namePattern: 'IMG_*' },
    { extension: '.JPG' },
    { extension: 'txt' },
    { minSize: 10 },
    { maxSize: 100 },
    { modifiedAfter: '2024-01-01' },
    { modifiedBefore: '2024-06-30' },
    {
      namePattern: '*',
      extension: 'jpg',
      minSize: 1,
      maxSize: 2,
      modifiedAfter: '2024-01-01',
      modifiedBefore: '2025-01-01',
    },
  ];
  const actions: Record<string, FieldValue>[] = [
    { action: 'move' },
    { action: 'copy' },
    { action: 'delete' },
    { action: 'rename', renameTemplate: '{n:3}_{name}{ext}' },
    { action: 'rename', renameTemplate: '{date}{ext}' },
  ];
  const cases: Record<string, FieldValue>[] = criteria.flatMap((c) =>
    actions.flatMap((a) => [true, false].map((recursive) => ({ ...c, ...a, recursive }))),
  );

  it.each(cases)('%j desugars to valid primitive IR', (fields) => {
    const needsDest = fields.action === 'move' || fields.action === 'copy';
    desugarOk(find(fields, needsDest));
  });

  it('golden: recursive move with every criterion', () => {
    const d = desugarOk(
      find({
        recursive: true,
        action: 'move',
        namePattern: 'IMG_*',
        extension: '.JPG',
        minSize: 10,
        maxSize: 100,
        modifiedAfter: '2024-01-01',
        modifiedBefore: '2024-06-30',
      }),
    );
    expect(show(d.body)).toBe(
      [
        'items = fs.walk(fs.root())',
        "destination = fs.join(fs.root(), 'out')",
        'for item in items:',
        "  if ((((text.wildcard(fs.name(item), 'IMG_*') and (text.lower(fs.ext(item)) == 'jpg')) " +
          'and (fs.size(item) >= 10)) and (fs.size(item) <= 100)) ' +
          "and (fs.modified(item) >= date('2024-01-01'))) and (fs.modified(item) < date('2024-06-30')):",
        '    if fs.parent(item) != destination:',
        '      fs.move(item, destination)',
      ].join('\n'),
    );
    expect(ids(d.body).filter((i) => i === 'in.dest')).toHaveLength(1);
  });

  it('golden: non-recursive rename with {n}', () => {
    const d = desugarOk(
      find({ recursive: false, action: 'rename', renameTemplate: '{n}{ext}' }, false),
    );
    expect(show(d.body)).toBe(
      [
        'items = fs.list(fs.root())',
        'n = 0',
        'for item in items:',
        '  if not fs.isFolder(item):',
        '    n = n + 1',
        '    ext = fs.ext(item)',
        "    if ext != '':",
        "      ext = '.' + ext",
        '    new_name = text.from(n) + ext',
        '    if new_name != fs.name(item):',
        '      fs.rename(item, new_name)',
      ].join('\n'),
    );
  });

  it('golden: recursive delete without criteria has no if', () => {
    const d = desugarOk(find({ recursive: true, action: 'delete' }, false));
    expect(show(d.body)).toBe(
      ['items = fs.walk(fs.root())', 'for item in items:', '  fs.delete(item)'].join('\n'),
    );
  });

  it('copy uses fs.copy with the parent guard', () => {
    const d = desugarOk(find({ recursive: true, action: 'copy' }));
    expect(show(d.body)).toContain(
      '  if fs.parent(item) != destination:\n    fs.copy(item, destination)',
    );
  });

  const tree: MiniEntry[] = [
    { path: 'IMG_1.JPG', size: 10, modified: 1704067200 }, // 2024-01-01 00:00 UTC
    { path: 'img_2.jpg', size: 100, modified: 1719705600 }, // 2024-06-30 00:00 UTC
    { path: 'img_3.png', size: 50, modified: 1710000000 },
    { path: 'big.jpg', size: 101, modified: 1710000000 },
    { path: 'sub/IMG_4.jpg', size: 9, modified: 1710000000 },
    { path: 'out/IMG_5.jpg', size: 20, modified: 1710000000 },
  ];
  const run = (fields: Record<string, FieldValue>, withDest = true) =>
    runMini(desugarProgram(find(fields, withDest)), tree).tree;

  it('behaves as specified: criteria are inclusive / exclusive as documented', () => {
    // size 10..100 inclusive, after 2024-01-01 inclusive, before 2024-06-30 exclusive.
    expect(
      run({
        recursive: true,
        action: 'move',
        namePattern: 'img_*',
        extension: '.JpG',
        minSize: 10,
        maxSize: 100,
        modifiedAfter: '2024-01-01',
        modifiedBefore: '2024-06-30',
      }),
    ).toEqual([
      'big.jpg',
      'img_2.jpg',
      'img_3.png',
      'out/',
      'out/IMG_1.JPG',
      'out/IMG_5.jpg',
      'sub/',
      'sub/IMG_4.jpg',
    ]);
  });

  it('behaves as specified: recursive move skips files already in the destination', () => {
    expect(run({ recursive: true, action: 'move', extension: 'jpg' })).toEqual([
      'img_3.png',
      'out/',
      'out/big.jpg',
      'out/IMG_1.JPG',
      'out/img_2.jpg',
      'out/IMG_4.jpg',
      'out/IMG_5.jpg',
      'sub/',
    ]);
  });

  it('behaves as specified: non-recursive acts on files only', () => {
    expect(run({ recursive: false, action: 'delete' }, false)).toEqual([
      'out/',
      'out/IMG_5.jpg',
      'sub/',
      'sub/IMG_4.jpg',
    ]);
  });

  it('behaves as specified: copy and rename counting matched files', () => {
    expect(run({ recursive: false, action: 'copy', minSize: 101 })).toContain('out/big.jpg');
    expect(run({ recursive: false, action: 'copy', minSize: 101 })).toContain('big.jpg');
    expect(
      run(
        { recursive: true, action: 'rename', extension: 'png', renameTemplate: 'x{n:2}{ext}' },
        false,
      ),
    ).toContain('x01.png');
    expect(
      run(
        {
          recursive: true,
          action: 'rename',
          namePattern: 'IMG_?.jpg',
          renameTemplate: '{n}_{name}{ext}',
        },
        false,
      ),
    ).toEqual([
      '1_IMG_1.JPG',
      '2_img_2.jpg',
      'big.jpg',
      'img_3.png',
      'out/',
      'out/3_IMG_5.jpg',
      'sub/',
      'sub/4_IMG_4.jpg',
    ]);
  });
});

// ================================================================ findFirst

describe('findFirst', () => {
  const cond = () =>
    b.bin(
      '>=',
      b.op('fs.size', [b.v('candidate', 'in.c.v')], 'in.c.size'),
      b.lit(100, 'in.c.n'),
      'in.cond',
    );
  const first = (sortBy: string, extra: Partial<Parts> = {}) =>
    single('findFirst', {
      fields: { sortBy },
      inputs: { folder: root(), condition: cond() },
      bodies: {
        found: [b.print(b.op('fs.name', [b.v('match', 'in.f.v')], 'in.f.name'), 'in.found')],
        notFound: [b.print(b.lit('none', 'in.nf.v'), 'in.notFound')],
      },
      ...extra,
    });

  it.each(['name', 'modified', 'size'])('sortBy %s desugars to valid primitive IR', (key) => {
    const d = desugarOk(first(key));
    expect(show(d.body)).toContain(`items = list.sortBy(files, '${key}', False)`);
  });

  it('golden: sorted by size', () => {
    const d = desugarOk(first('size'));
    expect(show(d.body)).toBe(
      [
        'files = []',
        'for item in fs.list(fs.root()):',
        '  if not fs.isFolder(item):',
        '    list.append(files, item)',
        "items = list.sortBy(files, 'size', False)",
        'low = 0  # -> items',
        'high = list.length(items)  # -> items',
        'while low < high:',
        '  mid = (low + high) // 2  # -> items',
        '  candidate = list.get(items, mid)',
        '  if fs.size(candidate) >= 100:',
        '    high = mid  # -> items',
        '  else:',
        '    low = mid + 1  # -> items',
        'if low < list.length(items):',
        '  match = list.get(items, low)',
        '  print(fs.name(match))',
        'else:',
        "  print('none')",
      ].join('\n'),
    );
    // Condition and bodies are placed exactly once, keeping their ids.
    const all = ids(d.body);
    for (const id of ['in.cond', 'in.found', 'in.notFound', 'in.folder']) {
      expect(all.filter((i) => i === id)).toHaveLength(1);
    }
  });

  it('uses the user-chosen bind names', () => {
    const p = single('findFirst', {
      fields: { sortBy: 'name' },
      inputs: {
        folder: root(),
        condition: b.op('text.startsWith', [b.op('fs.name', [b.v('f')]), b.lit('m')]),
      },
      bodies: { found: [b.print(b.op('fs.name', [b.v('hit')]))], notFound: [] },
      binds: { candidate: 'f', match: 'hit' },
    });
    const text = show(desugarOk(p).body);
    expect(text).toContain('  f = list.get(items, mid)');
    expect(text).toContain('  hit = list.get(items, low)');
  });

  const tree: MiniEntry[] = [
    { path: 'a.log', size: 300 },
    { path: 'b.log', size: 5 },
    { path: 'c.log', size: 120 },
    { path: 'd.log', size: 99 },
    { path: 'zfolder', folder: true },
  ];

  it('behaves as specified: finds the first file where the condition holds', () => {
    expect(runMini(desugarProgram(first('size')), tree).output).toEqual(['c.log']);
    const none = tree.map((e) => (e.size ? { ...e, size: 1 } : e));
    expect(runMini(desugarProgram(first('size')), none).output).toEqual(['none']);
    expect(runMini(desugarProgram(first('size')), []).output).toEqual(['none']);
  });
});

// ================================================================== hygiene

describe('hygiene', () => {
  const userVars = [
    'n',
    'item',
    'items',
    'low',
    'high',
    'mid',
    'new_name',
    'files',
    'folder',
    'ext',
  ];
  // User variables of a type no temp could share, declared AFTER the composite.
  const after = userVars.map((name, i) =>
    b.assign(name, b.lit(i === 0 ? true : 'x', `u${i}`), `u.${name}`),
  );

  const composites = (): Stmt[] => [
    comp(
      'renameByPattern',
      { fields: { template: '{n}{ext}' }, inputs: { folder: root('i1') } },
      'r',
    ),
    comp('sortByType', { fields: { grouping: 'extension' }, inputs: { folder: root('i2') } }, 's'),
    comp(
      'findAndAct',
      { fields: { action: 'rename', renameTemplate: '{n}' }, inputs: { folder: root('i3') } },
      'f',
    ),
    comp(
      'findFirst',
      {
        inputs: { folder: root('i4'), condition: b.lit(true, 'i5') },
        bodies: { found: [], notFound: [] },
      },
      'b',
    ),
  ];

  it('temps avoid user variables anywhere in the scope (even later ones)', () => {
    const d = desugarOk(b.program([...composites(), ...after]));
    const names = declared(d.body);
    for (const v of ['n', 'item', 'items', 'low', 'new_name']) expect(names).toContain(`${v}_2`);
  });

  it('two composites in the same scope never share temporaries', () => {
    const d = desugarOk(b.program(composites()));
    const text = show(d.body);
    expect(text).toContain('for item in fs.list(fs.root()):'); // renameByPattern
    expect(text).toContain('for item_2 in fs.list(folder):'); // sortByType
    expect(text).toContain('for item_3 in items:'); // findAndAct
    expect(text).toContain('for item_4 in fs.list(fs.root()):'); // findFirst
    expect(text).toContain('n_2 = 0');
  });

  it('avoids function names and bind names of nested composites', () => {
    const fn = b.fn('item', [], null, [], 'fn.item');
    const inner = comp(
      'findFirst',
      {
        inputs: { folder: root('ii'), condition: b.lit(true, 'ic') },
        bodies: { found: [], notFound: [] },
        binds: { candidate: 'items', match: 'low' },
      },
      'inner',
    );
    const outer = comp(
      'findFirst',
      {
        inputs: { folder: root('oi'), condition: b.lit(true, 'oc') },
        bodies: { found: [inner], notFound: [] },
      },
      'outer',
    );
    const d = desugarOk(b.program([outer], [fn]));
    const names = declared(d.body);
    expect(names).not.toContain('item');
    expect(names).toContain('items'); // the inner bind
    expect(names).toContain('items_2');
  });

  it('composites inside a function use the function scope', () => {
    const fnBody = [
      comp(
        'sortByType',
        { fields: { grouping: 'extension' }, inputs: { folder: b.v('item', 'fv') } },
        'fs1',
      ),
    ];
    const fn = b.fn('tidy', [{ name: 'item', type: T.path }], null, fnBody, 'fn');
    // Program scope has `folder`, which the function does not see.
    const p = b.program(
      [b.assign('folder', b.lit(1, 'pl'), 'pa'), b.do(b.call('tidy', [b.root('pr')], 'pc'), 'pd')],
      [fn],
    );
    const d = desugarOk(p);
    const text = show(d.functions[0]!.body);
    expect(text).toContain('folder = item');
    expect(text).toContain('for item_2 in fs.list(folder):');
  });
});

// =================================================== purity / determinism

describe('desugarProgram', () => {
  const nested = (): Program => {
    const inner = comp(
      'renameByPattern',
      {
        fields: { template: '{n}_{name}{ext}' },
        inputs: { folder: b.op('fs.parent', [b.v('match', 'im')], 'if') },
      },
      'inner',
    );
    const outer = comp(
      'findFirst',
      {
        inputs: { folder: root('of'), condition: b.lit(true, 'oc') },
        bodies: {
          found: [b.if(b.lit(true, 'ift'), [inner], [], 'wrap')],
          notFound: [],
        },
      },
      'outer',
    );
    return b.program([outer]);
  };

  it('is pure', () => {
    const p = nested();
    const before = structuredClone(p);
    const d = desugarProgram(p);
    expect(p).toEqual(before);
    // Output shares no objects with the input.
    (d.body[0] as { id: string }).id = 'mutated';
    expect(p).toEqual(before);
  });

  it('is deterministic', () => {
    expect(desugarProgram(nested())).toEqual(desugarProgram(nested()));
  });

  it('desugars nested composites outermost first and ids stay unique and derived', () => {
    const d = desugarOk(nested());
    expect(hasComposite(d.body)).toBe(false);
    const all = ids(d.body);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((i) => i.startsWith('inner/')).length).toBeGreaterThan(0);
    // Outer-first: the outer composite gets the unsuffixed temps.
    const text = show(d.body);
    expect(text).toContain('for item in fs.list(fs.root()):');
    expect(text).toContain('    for item_2 in fs.list(fs.parent(match)):');
    // Desugared ids map back to their composite.
    for (const id of all) {
      expect(
        ['of', 'oc', 'ift', 'wrap', 'im', 'if'].includes(id) || /^(outer|inner)\//.test(id),
      ).toBe(true);
    }
  });

  it('leaves programs without composites unchanged', () => {
    const p = b.program([b.print(b.lit('hi', 'l'), 'p')]);
    expect(desugarProgram(p)).toEqual(p);
  });
});

// =============================================================== desugarOne

describe('desugarOne', () => {
  const program = (): Program => {
    const inner = comp(
      'sortByType',
      { inputs: { folder: b.op('fs.parent', [b.v('match', 'im')], 'if') } },
      'inner',
    );
    const outer = comp(
      'findFirst',
      {
        inputs: { folder: root('of'), condition: b.lit(true, 'oc') },
        bodies: { found: [inner], notFound: [] },
      },
      'outer',
    );
    const fnComp = comp('renameByPattern', { inputs: { folder: b.v('folder', 'fv') } }, 'fc');
    const fn = b.fn('tidy', [{ name: 'folder', type: T.path }], null, [fnComp], 'fn');
    return b.program([b.assign('low', b.lit('x', 'ul'), 'ua'), outer], [fn]);
  };

  it('expands one level, keeping nested composites in bodies', () => {
    const stmts = desugarOne(program(), 'outer');
    expect(hasComposite(stmts)).toBe(true);
    expect(JSON.stringify(stmts)).toContain('"id":"inner"');
    expect(declared(stmts)).toContain('low_2'); // program scope has `low`
    // Spliced back in place, the program is still valid and fully desugars.
    const p = program();
    p.body.splice(1, 1, ...stmts);
    expect(errors(p)).toEqual([]);
    const full = desugarOk(p);
    expect(hasComposite(full.body)).toBe(false);
  });

  it('expands an inner composite and one inside a function using its own scope', () => {
    const inner = desugarOne(program(), 'inner');
    expect(show(inner)).toContain('folder = fs.parent(match)');
    const fnStmts = desugarOne(program(), 'fc');
    expect(show(fnStmts)).toContain('for item in fs.list(folder):');
    expect(declared(fnStmts)).not.toContain('low_2');
  });

  it('is pure and deterministic', () => {
    const p = program();
    const before = structuredClone(p);
    expect(desugarOne(p, 'outer')).toEqual(desugarOne(p, 'outer'));
    expect(p).toEqual(before);
  });

  it('throws clear errors for unknown or non-composite ids', () => {
    expect(() => desugarOne(program(), 'nope')).toThrow(/no block with id "nope"/);
    expect(() => desugarOne(program(), 'ua')).toThrow(/"assign" block, not a task block/);
  });
});
