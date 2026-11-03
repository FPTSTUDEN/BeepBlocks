import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { ACTION_SCHEMAS, getBind } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Expr, Stmt } from '../ir/types.ts';
import { counterInit, counterNext, planTemplate, renameStmts } from './template.ts';
import { andAll, boolField, enumField, input } from './util.ts';

const ACTIONS = ['move', 'copy', 'delete', 'rename'] as const;

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const action = enumField(node, 'action', ACTIONS);
  const recursive = boolField(node, 'includeSubfolders');
  const makeFolder = boolField(node, 'makeFolder');
  const file = getBind(node, 'file');
  const counterPlan = action === 'rename' ? planTemplate(String(node.fields.renameTemplate ?? '{name}{ext}')) : null;
  const counter = counterPlan?.usesCounter ? ctx.freshName('n') : null;
  const conditions: Expr[] = [
    b.not(b.op('fs.isFolder', [b.v(file, id('file.folder'))], id('file.isFolder')), id('file.test')),
  ];
  const condition = node.inputs.condition;
  if (condition) conditions.push(condition);
  const body: Stmt[] = [];
  if (action === 'move' || action === 'copy') {
    const destination = ctx.freshName('destination');
    body.push(b.assign(destination, input(node, 'destination'), id('destination')));
    if (makeFolder) {
      body.push(
        b.if(
          b.not(b.op('fs.exists', [b.v(destination, id('destination.exists.value'))], id('destination.exists')), id('destination.missing')),
          [b.do(b.op('fs.makeFolder', [b.v(destination, id('destination.make'))], id('destination.made.op')), id('destination.made'))],
          [],
          id('destination.if'),
        ),
      );
    }
    body.push(
      b.if(
        b.bin(
          '!=',
          b.op('fs.parent', [b.v(file, id('guard.file'))], id('guard.parent')),
          b.v(destination, id('guard.dest')),
          id('guard.test'),
        ),
        [b.do(b.op(action === 'move' ? 'fs.move' : 'fs.copy', [b.v(file, id('action.file')), b.v(destination, id('action.dest'))], id('action.op')), id('action'))],
        [],
        id('guard'),
      ),
    );
  } else if (action === 'delete') {
    body.push(b.do(b.op('fs.delete', [b.v(file, id('delete.file'))], id('delete.op')), id('delete')));
  } else {
    if (counter) body.push(counterNext(ctx, counter));
    body.push(...renameStmts(counterPlan!, { ctx, item: file, counter }));
  }
  const guarded = andAll(conditions, ctx, 'condition');
  const loopBody = guarded ? [b.if(guarded, body, [], id('check'))] : body;
  return [
    ...(counter ? [counterInit(ctx, counter)] : []),
    b.forEach(
      file,
      b.op(recursive ? 'fs.walk' : 'fs.list', [input(node, 'folder')], id('items.list')),
      loopBody,
      id('loop'),
    ),
  ];
}

export const everyFile: CompositeDef = { ...ACTION_SCHEMAS.everyFile, desugar };
