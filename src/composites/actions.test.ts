import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import { T } from '../ir/types.ts';
import { validateProgram } from '../ir/validate.ts';
import { desugarProgram } from './index.ts';

let rootId = 0;
const root = () => b.root(`root-${++rootId}`);

describe('v1.1 statement actions', () => {
  it('desugars the loop and file actions to valid primitive IR', () => {
    const body = [
      b.composite('makeFolderIfMissing', { inputs: { path: root() } }, 'mkdir'),
      b.composite(
        'everyFile',
        {
          fields: { action: 'rename', includeSubfolders: true, renameTemplate: '{n:2}_{name}{ext}' },
          inputs: { folder: root() },
          binds: { file: 'file' },
        },
        'every',
      ),
      b.composite('goThrough', { inputs: { folder: root() }, bodies: { body: [] } }, 'through'),
      b.composite('repeatTimes', { inputs: { n: b.lit(2, 'n') }, bodies: { body: [] } }, 'repeat'),
      b.composite('keepDoingUntil', { inputs: { condition: b.lit(true, 'done') }, bodies: { body: [] } }, 'until'),
      b.composite('findFile', { inputs: { folder: root() }, bodies: { found: [], notFound: [] } }, 'find'),
    ];
    const issues = validateProgram(b.program(body));
    expect(issues.filter((x) => x.severity === 'error')).toEqual([]);
    const expanded = desugarProgram(b.program(body));
    expect(validateProgram(expanded, { primitiveOnly: true }).filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('supports all find-file ranking modes and preserves ties by first match', () => {
    for (const which of ['first', 'biggest', 'smallest', 'newest', 'oldest'] as const) {
      const p = b.program([
        b.composite(
          'findFile',
          {
            fields: { which },
            inputs: { folder: root() },
            binds: { file: 'file', found: 'found' },
            bodies: { found: [b.print(b.op('text.from', [b.v('found', 'found.print')], 'found.text'))], notFound: [] },
          },
          `find-${which}`,
        ),
      ]);
      expect(validateProgram(p).filter((x) => x.severity === 'error')).toEqual([]);
      expect(validateProgram(desugarProgram(p), { primitiveOnly: true }).filter((x) => x.severity === 'error')).toEqual([]);
    }
  });

  it('desugars expression actions in statement positions', () => {
    const p = b.program([
      b.assign('n', b.compositeExpr('countFiles', { inputs: { folder: root() } }, 'count')),
      b.assign(
        'files',
        b.compositeExpr(
          'filesIn',
          { fields: { order: 'size' }, inputs: { folder: root() } },
          'files',
        ),
      ),
      b.assign('kind', b.compositeExpr('typeOf', { inputs: { file: root() } }, 'kind')),
    ]);
    const expanded = desugarProgram(p);
    expect(validateProgram(expanded, { primitiveOnly: true }).filter((x) => x.severity === 'error')).toEqual([]);
    expect(expanded.body.some((s) => s.kind === 'forEach')).toBe(true);
    expect(T.path).toEqual({ t: 'path' });
  });
});
