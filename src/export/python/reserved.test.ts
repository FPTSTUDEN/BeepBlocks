/**
 * User variables and functions are emitted verbatim as Python names, so every module-level
 * name of the embedded runtime must be rejected by checkIdentifier (Task 2.0).
 */
import { describe, expect, it } from 'vitest';
import { checkIdentifier } from '../../ir/validate.ts';
import { RUNTIME_PY } from './runtime.gen.ts';

/** Top-level `def`/`class` names, assignment targets and import bindings. */
function moduleLevelNames(source: string): string[] {
  const names = new Set<string>();
  for (const line of source.split('\n')) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:def|class)\s+([A-Za-z_]\w*)/.exec(line))) names.add(m[1]!);
    else if ((m = /^([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)/.exec(line))) names.add(m[1]!);
    else if ((m = /^import\s+(.+)$/.exec(line))) {
      for (const part of m[1]!.split(',')) {
        const [mod, alias] = part.trim().split(/\s+as\s+/);
        names.add((alias ?? mod!).split('.')[0]!.trim());
      }
    } else if ((m = /^from\s+\S+\s+import\s+(.+)$/.exec(line))) {
      for (const part of m[1]!.replace(/[()]/g, '').split(',')) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (name) names.add((alias ?? name).trim());
      }
    }
  }
  return [...names].sort();
}

describe('reserved names', () => {
  const names = moduleLevelNames(RUNTIME_PY);

  it('finds the runtime module-level names', () => {
    for (const n of ['_BPError', '_RealFS', '_PlanFS', 'Path', 'datetime', 'shutil']) {
      expect(names).toContain(n);
    }
  });

  it.each(names)('rejects runtime name %s as a user name', (n) => {
    expect(checkIdentifier(n)).not.toBeNull();
  });

  it('reserves the _bp prefix case-insensitively', () => {
    expect(checkIdentifier('_BPanything')).not.toBeNull();
    expect(checkIdentifier('_Bp_x')).not.toBeNull();
    expect(checkIdentifier('bp_ok')).toBeNull();
  });
});
