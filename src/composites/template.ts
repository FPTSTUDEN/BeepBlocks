/**
 * Rename templates → primitive IR (design.md §6.2, task C.2).
 *
 *   {name}  → fs.stem(item)
 *   {ext}   → ext, computed once per file:  ext = fs.ext(item); if ext != '': ext = '.' + ext
 *   {n}     → text.from(n)
 *   {n:W}   → text.padNumber(n, W)
 *   {date}  → text.date(fs.modified(item))
 *   literal → text literal ({{ and }} already unescaped by parseTemplate)
 *
 * Parts are joined with `+`. Only what the template uses is generated.
 */
import type { DesugarCtx } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import { parseTemplate, type TemplatePart } from '../ir/syntax.ts';
import type { Expr, Stmt } from '../ir/types.ts';

export interface TemplatePlan {
  parts: TemplatePart[];
  usesCounter: boolean;
  usesExt: boolean;
}

export function planTemplate(template: string): TemplatePlan {
  const r = parseTemplate(template);
  if (!r.ok) throw new Error(`Invalid rename template "${template}": ${r.error}`);
  return {
    parts: r.parts,
    usesCounter: r.parts.some((p) => p.kind === 'n'),
    usesExt: r.parts.some((p) => p.kind === 'ext'),
  };
}

/** `n = 0` */
export function counterInit(ctx: DesugarCtx, counter: string): Stmt {
  return b.assign(counter, b.lit(0, ctx.id('count.init.value')), ctx.id('count.init'));
}

/** `n = n + 1` */
export function counterNext(ctx: DesugarCtx, counter: string): Stmt {
  const id = ctx.id;
  return b.assign(
    counter,
    b.bin(
      '+',
      b.v(counter, id('count.next.n')),
      b.lit(1, id('count.next.one')),
      id('count.next.value'),
    ),
    id('count.next'),
  );
}

export interface RenameOpts {
  ctx: DesugarCtx;
  /** Loop variable holding the file path. */
  item: string;
  /** Counter variable (already incremented for this file), or null if unused. */
  counter: string | null;
}

/**
 * Statements that rename `item` according to the template, skipping unchanged names:
 *
 *   [ext = fs.ext(item)                 # only if the template uses {ext}
 *    if ext != '': ext = '.' + ext]
 *   new_name = <concatenation>
 *   if new_name != fs.name(item):
 *       fs.rename(item, new_name)
 */
export function renameStmts(plan: TemplatePlan, { ctx, item, counter }: RenameOpts): Stmt[] {
  const id = ctx.id;
  const out: Stmt[] = [];

  let dotExt: string | null = null;
  if (plan.usesExt) {
    // ext = fs.ext(item)
    // if ext != '':
    //     ext = '.' + ext
    dotExt = ctx.freshName('ext');
    out.push(
      b.assign(dotExt, b.op('fs.ext', [b.v(item, id('ext.raw.item'))], id('ext.raw')), id('ext')),
      b.if(
        b.bin(
          '!=',
          b.v(dotExt, id('ext.test.ext')),
          b.lit('', id('ext.test.empty')),
          id('ext.test'),
        ),
        [
          b.assign(
            dotExt,
            b.bin(
              '+',
              b.lit('.', id('ext.dot.lit')),
              b.v(dotExt, id('ext.dot.ext')),
              id('ext.dot.value'),
            ),
            id('ext.dot'),
          ),
        ],
        [],
        id('ext.if'),
      ),
    );
  }

  const partExpr = (p: TemplatePart, i: number): Expr => {
    const pid = (s: string) => id(`tpl.p${i}${s}`);
    switch (p.kind) {
      case 'lit':
        return b.lit(p.text, pid(''));
      case 'name':
        return b.op('fs.stem', [b.v(item, pid('.item'))], pid(''));
      case 'ext':
        if (dotExt === null) throw new Error('unreachable: {ext} without an ext temp');
        return b.v(dotExt, pid(''));
      case 'n': {
        if (counter === null) throw new Error('unreachable: {n} without a counter');
        const n = b.v(counter, pid('.n'));
        return p.width > 0
          ? b.op('text.padNumber', [n, b.lit(p.width, pid('.width'))], pid(''))
          : b.op('text.from', [n], pid(''));
      }
      case 'date':
        return b.op(
          'text.date',
          [b.op('fs.modified', [b.v(item, pid('.item'))], pid('.modified'))],
          pid(''),
        );
    }
  };

  const exprs = plan.parts.map(partExpr);
  const [first, ...rest] = exprs;
  if (!first) throw new Error('unreachable: empty template');
  let value: Expr = first;
  rest.forEach((e, i) => {
    value = b.bin('+', value, e, id(`tpl.cat${i + 1}`));
  });

  const newName = ctx.freshName('new_name');
  out.push(b.assign(newName, value, id('newName')));
  out.push(
    b.if(
      b.bin(
        '!=',
        b.v(newName, id('changed.new')),
        b.op('fs.name', [b.v(item, id('changed.item'))], id('changed.old')),
        id('changed.test'),
      ),
      [
        b.do(
          b.op(
            'fs.rename',
            [b.v(item, id('rename.item')), b.v(newName, id('rename.name'))],
            id('rename.op'),
          ),
          id('rename'),
        ),
      ],
      [],
      id('changed'),
    ),
  );
  return out;
}
