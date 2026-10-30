/**
 * Composite desugarings — Workstream C (design.md §6). Stubs until Phase 1.
 *
 * Contract notes for the implementer:
 * - `desugarProgram` is pure and deterministic, desugars innermost composites first, and
 *   returns a program that passes `validateProgram(p, { primitiveOnly: true })`.
 * - Temporaries come from `DesugarCtx.freshName`, which must avoid every name used anywhere
 *   in the enclosing scope (whole function or whole program body), not just earlier ones.
 * - Node ids are derived: `${composite.id}/${local}`.
 */
import type { CompositeDef, CompositeName, DesugarOne, DesugarProgram } from '../ir/composites.ts';

export const COMPOSITES: Partial<Record<CompositeName, CompositeDef>> = {};

export const desugarProgram: DesugarProgram = () => {
  throw new Error('desugarProgram: not implemented (Workstream C)');
};

export const desugarOne: DesugarOne = () => {
  throw new Error('desugarOne: not implemented (Workstream C)');
};
