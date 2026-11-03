import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { ACTION_SCHEMAS, getBind } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import { type Stmt } from '../ir/types.ts';
import { input } from './util.ts';

function decide(
  stmts: readonly Stmt[],
  high: string,
  low: string,
  mid: string,
  line: ReturnType<typeof b.v>,
  ctx: DesugarCtx,
): Stmt[] {
  return stmts.map((s) => {
    if (s.kind === 'composite' && s.name === 'keepLeftHalf') {
      return b.assign(high, b.v(mid, ctx.id('left.mid')), ctx.id('left'), { indexInto: line.name });
    }
    if (s.kind === 'composite' && s.name === 'keepRightHalf') {
      return b.assign(
        low,
        b.bin('+', b.v(mid, ctx.id('right.mid')), b.lit(1, ctx.id('right.one')), ctx.id('right.value')),
        ctx.id('right'),
        { indexInto: line.name },
      );
    }
    if (s.kind === 'if') {
      return {
        ...s,
        then: decide(s.then, high, low, mid, line, ctx),
        else: decide(s.else, high, low, mid, line, ctx),
      };
    }
    return s;
  });
}

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const middle = getBind(node, 'middle');
  const answer = getBind(node, 'answer');
  const low = ctx.freshName('low');
  const high = ctx.freshName('high');
  const mid = ctx.freshName('mid');
  const line = input(node, 'line');
  const lineName = ctx.freshName('items');
  let lineRef = 0;
  const lineVar = () => b.v(lineName, id(`line.value.${++lineRef}`));
  const transformed = decide(node.bodies.decide ?? [], high, low, mid, lineVar(), ctx);
  return [
    b.assign(lineName, line, id('line')),
    b.assign(low, b.lit(0, id('low.value')), id('low'), { indexInto: lineName }),
    b.assign(high, b.op('list.length', [lineVar()], id('high.value')), id('high'), { indexInto: lineName }),
    b.while(
      b.bin('<', b.v(low, id('loop.low')), b.v(high, id('loop.high')), id('loop.test')),
      [
        b.assign(
          mid,
          b.bin(
            '//',
            b.bin('+', b.v(low, id('mid.low')), b.v(high, id('mid.high')), id('mid.sum')),
            b.lit(2, id('mid.two')),
            id('mid.value'),
          ),
          id('mid'),
          { indexInto: lineName },
        ),
        b.assign(middle,                 b.op('list.get', [lineVar(), b.v(mid, id('middle.mid'))], id('middle.value')), id('middle')),
        ...transformed,
      ],
      id('loop'),
    ),
    b.if(
      b.bin('<', b.v(low, id('result.low')),             b.op('list.length', [lineVar()], id('result.length')), id('result.test')),
      [
        b.assign(answer,                 b.op('list.get', [lineVar(), b.v(low, id('answer.low'))], id('answer.value')), id('answer')),
        ...(node.bodies.found ?? []),
      ],
      node.bodies.notFound ?? [],
      id('result'),
    ),
  ];
}

export const halvingSearch: CompositeDef = { ...ACTION_SCHEMAS.halvingSearch, desugar };
