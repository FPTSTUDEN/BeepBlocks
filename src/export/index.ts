/**
 * Python exporter public API — Workstream B (design.md §8).
 */
import type { NodeId, Program } from '../ir/types.ts';
import type { DesugarProgram } from '../ir/composites.ts';
import type { ValidationError } from '../ir/errors.ts';
import { typecheck, validateProgram } from '../ir/validate.ts';
import { describeComposite } from './python/describe.ts';
import { buildHeader, visitProgram } from './python/header.ts';
import { emitScript } from './python/emit.ts';

export type ExportResult = { ok: true; source: string } | { ok: false; errors: ValidationError[] };

export interface ExportOptions {
  /** Injected by app/ (export/ must not import composites/). */
  desugar: DesugarProgram;
  /** Shown in the script header. */
  title?: string;
}

const DEFAULT_TITLE = 'BeepBlocks program';

const failure = (message: string): ExportResult => ({
  ok: false,
  errors: [{ nodeId: '', code: 'STRUCTURE', message, severity: 'error' }],
});

const errorsOnly = (issues: ValidationError[]) => issues.filter((i) => i.severity === 'error');

/** Validates, desugars, and emits a standalone Python 3.9+ script. Never throws on invalid IR. */
export function exportPython(program: Program, options: ExportOptions): ExportResult {
  try {
    const errors = errorsOnly(validateProgram(program));
    if (errors.length > 0) return { ok: false, errors };

    let desugared: Program;
    try {
      desugared = options.desugar(program);
    } catch (err) {
      return failure(
        `The task blocks could not be expanded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const checked = typecheck(desugared, { primitiveOnly: true });
    const desugaredErrors = errorsOnly(checked.issues);
    if (desugaredErrors.length > 0) return { ok: false, errors: desugaredErrors };

    const composites = new Map<NodeId, string>();
    visitProgram(program, (n) => {
      if (n.kind === 'composite') composites.set(n.id, describeComposite(n));
    });
    const title = options.title?.trim() || DEFAULT_TITLE;
    const source = emitScript({
      program: desugared,
      exprTypes: checked.exprTypes,
      header: buildHeader({ title, original: program, desugared }),
      composites,
    });
    return { ok: true, source };
  } catch (err) {
    return failure(
      `The program could not be exported: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
