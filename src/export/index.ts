/**
 * Python exporter public API — Workstream B (design.md §8). Stub until Phase 1.
 */
import type { Program } from '../ir/types.ts';
import type { DesugarProgram } from '../ir/composites.ts';
import type { ValidationError } from '../ir/errors.ts';

export type ExportResult = { ok: true; source: string } | { ok: false; errors: ValidationError[] };

export interface ExportOptions {
  /** Injected by app/ (export/ must not import composites/). */
  desugar: DesugarProgram;
  /** Shown in the script header. */
  title?: string;
}

/** Validates, desugars, and emits a standalone Python 3.9+ script. Never throws on invalid IR. */
export function exportPython(_program: Program, _options: ExportOptions): ExportResult {
  throw new Error('exportPython: not implemented (Workstream B)');
}
