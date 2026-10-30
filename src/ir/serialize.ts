/** IR JSON (de)serialization with format/version checks (design.md §4.1, Req 1.2). */
import type { Program } from './types.ts';
import type { ValidationError } from './errors.ts';
import { validateProgram } from './validate.ts';

export function serializeProgram(program: Program): string {
  return JSON.stringify(program, null, 2);
}

export type ParseResult =
  | { ok: true; program: Program; warnings: ValidationError[] }
  | { ok: false; errors: ValidationError[] };

const structural = (message: string): ValidationError => ({
  nodeId: '',
  code: 'STRUCTURE',
  message,
  severity: 'error',
});

/**
 * Parses and fully validates a program. Accepts a JSON string or an already-parsed value.
 * Never throws.
 */
export function parseProgram(input: string | unknown): ParseResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, errors: [structural('This is not valid JSON.')] };
    }
  }
  if (typeof value !== 'object' || value === null) {
    return { ok: false, errors: [structural('Expected a program object.')] };
  }
  const v = value as Record<string, unknown>;
  if (v.format !== 'block-playground-ir') {
    return { ok: false, errors: [structural('This is not a Block Playground program.')] };
  }
  if (v.version !== 1) {
    return {
      ok: false,
      errors: [structural(`Unsupported program version ${String(v.version)} (expected 1).`)],
    };
  }
  const program = value as Program;
  const issues = validateProgram(program);
  const errors = issues.filter((e) => e.severity === 'error');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, program, warnings: issues.filter((e) => e.severity === 'warning') };
}
