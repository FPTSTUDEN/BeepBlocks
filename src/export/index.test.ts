import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import type { Program } from '../ir/types.ts';
import { exportPython } from './index.ts';

const identity = (p: Program) => p;

describe('exportPython', () => {
  it('exports a valid program', () => {
    const r = exportPython(b.program([b.print(b.lit('hi'), 'p')]), {
      desugar: identity,
      title: 'Hi',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain('print("hi")');
      expect(r.source).toContain('Hi \u2014 exported from BeepBlocks');
    }
  });

  it('uses a default title', () => {
    const r = exportPython(b.program([]), { desugar: identity });
    expect(r.ok && r.source.includes('BeepBlocks program \u2014 exported')).toBe(true);
  });

  it('refuses invalid IR with the validation errors (before desugaring)', () => {
    let called = false;
    const r = exportPython(b.program([b.print(b.lit(1), 'bad')]), {
      desugar: (p) => {
        called = true;
        return p;
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.nodeId, e.code])).toEqual([['bad', 'TYPE_MISMATCH']]);
      expect(r.errors.every((e) => e.severity === 'error')).toBe(true);
    }
    expect(called).toBe(false);
  });

  it('exports despite warnings', () => {
    // A large float literal is fine; unused results only warn.
    const r = exportPython(b.program([b.do(b.op('fs.exists', [b.op('fs.root', [])]))]), {
      desugar: identity,
    });
    expect(r.ok).toBe(true);
  });

  it('re-validates the desugared program as primitive-only', () => {
    const withComposite = b.program([
      b.composite(
        'sortByType',
        { fields: { grouping: 'extension' }, inputs: { folder: b.op('fs.root', []) } },
        'c',
      ),
    ]);
    const r = exportPython(withComposite, { desugar: identity });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ nodeId: 'c', code: 'STRUCTURE' });

    const broken = exportPython(b.program([]), {
      desugar: () => b.program([b.print(b.v('nope'), 'x')]),
    });
    expect(broken.ok).toBe(false);
  });

  it('never throws, even on garbage or a throwing desugar', () => {
    for (const junk of [
      null,
      42,
      {},
      { functions: 'x', body: [] },
      { functions: [], body: [{}] },
    ]) {
      const r = exportPython(junk as unknown as Program, { desugar: identity });
      expect(r.ok).toBe(false);
    }
    const r = exportPython(b.program([]), {
      desugar: () => {
        throw new Error('boom');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toContain('boom');
  });
});
