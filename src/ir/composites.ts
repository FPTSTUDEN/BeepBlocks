/**
 * Composite blocks — CONTRACT (design.md §6.1).
 *
 * This file defines the composite node shape and the *schemas* of the v1 composites
 * (fields, inputs, bodies, bound names). The desugarings themselves live in src/composites/.
 */
import type { NodeId, Stmt, Expr, Type, Program } from './types.ts';

export const COMPOSITE_NAMES = ['renameByPattern', 'sortByType', 'findAndAct', 'findFirst'] as const;
export type CompositeName = (typeof COMPOSITE_NAMES)[number];

/** Literal configuration value. `null` = optional field left unset. Dates are 'YYYY-MM-DD'. */
export type FieldValue = string | number | boolean | null;

export interface CompositeStmt {
  id: NodeId;
  kind: 'composite';
  name: CompositeName;
  fields: Record<string, FieldValue>;
  inputs: Record<string, Expr>;
  bodies: Record<string, Stmt[]>;
  /** User-chosen names for the variables this composite introduces, keyed by bind key. */
  binds: Record<string, string>;
}

export type FieldKind = 'text' | 'number' | 'bool' | 'enum' | 'date';

export interface FieldSchema {
  key: string;
  kind: FieldKind;
  label: string;
  optional?: boolean;
  default: FieldValue;
  options?: readonly string[];
  /** Extra syntax validation applied to text fields. */
  syntax?: 'wildcard' | 'template' | 'extension';
  /** For number fields: minimum allowed value. */
  min?: number;
}

export interface InputSchema {
  key: string;
  label: string;
  type: Type;
  optional?: boolean;
}

export interface BindSchema {
  key: string;
  type: Type;
  defaultName: string;
  /** Input keys and body keys in which the bound variable is visible. */
  visibleIn: readonly string[];
}

export interface CompositeSchema {
  name: CompositeName;
  label: string;
  help: string;
  fields: readonly FieldSchema[];
  inputs: readonly InputSchema[];
  bodies: readonly { key: string; label: string }[];
  binds: readonly BindSchema[];
  /** Cross-field requirements beyond the schema (checked by the validator). */
  requires?: readonly { when: { field: string; equals: FieldValue[] }; need: string[] }[];
}

// ---------------------------------------------------------- Desugar contract

export interface DesugarCtx {
  /** Deterministic fresh variable name: `base`, then `base_2`, `base_3`… avoiding names in scope. */
  freshName(base: string): string;
  /** Derived node id: `${compositeId}/${local}`. */
  id(local: string): NodeId;
}

export interface CompositeDef extends CompositeSchema {
  desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[];
}

/** Injected into editor/ and export/ by app/ so they need not import composites/. */
export type DesugarProgram = (program: Program) => Program;
/** Desugars a single composite in the context of a program (used by editor Expand). */
export type DesugarOne = (program: Program, compositeId: NodeId) => Stmt[];

// ------------------------------------------------------------------ Schemas
const PATH: Type = { t: 'path' };
const BOOL: Type = { t: 'bool' };

export const COMPOSITE_SCHEMAS: Readonly<Record<CompositeName, CompositeSchema>> = {
  renameByPattern: {
    name: 'renameByPattern',
    label: 'Rename files matching a pattern',
    help:
      'Renames every file directly inside the folder whose name matches the pattern. ' +
      'In the new name, {name} is the old name without extension, {ext} the extension ' +
      '(with its dot), {n} a counter starting at 1 ({n:3} pads it to 3 digits), and ' +
      '{date} the file\u2019s modified date.',
    fields: [
      { key: 'match', kind: 'text', label: 'files matching', default: '*', syntax: 'wildcard' },
      {
        key: 'template',
        kind: 'text',
        label: 'new name',
        default: '{name}{ext}',
        syntax: 'template',
      },
    ],
    inputs: [{ key: 'folder', label: 'in folder', type: PATH }],
    bodies: [],
    binds: [],
  },

  sortByType: {
    name: 'sortByType',
    label: 'Sort files into folders by type',
    help:
      'Moves each file directly inside the folder into a subfolder for its type, creating ' +
      'subfolders when needed. "category" groups extensions (Images, Documents, ...); ' +
      '"extension" makes one folder per extension.',
    fields: [
      {
        key: 'grouping',
        kind: 'enum',
        label: 'group by',
        default: 'category',
        options: ['category', 'extension'],
      },
    ],
    inputs: [{ key: 'folder', label: 'in folder', type: PATH }],
    bodies: [],
    binds: [],
  },

  findAndAct: {
    name: 'findAndAct',
    label: 'Find files and do something with them',
    help:
      'Finds files in the folder (and its subfolders, if chosen) that meet every criterion ' +
      'you set, then moves, copies, deletes, or renames each one. Criteria you leave empty ' +
      'are ignored.',
    fields: [
      { key: 'recursive', kind: 'bool', label: 'include subfolders', default: true },
      {
        key: 'namePattern',
        kind: 'text',
        label: 'name matches',
        optional: true,
        default: null,
        syntax: 'wildcard',
      },
      {
        key: 'extension',
        kind: 'text',
        label: 'extension is',
        optional: true,
        default: null,
        syntax: 'extension',
      },
      { key: 'minSize', kind: 'number', label: 'at least (bytes)', optional: true, default: null, min: 0 },
      { key: 'maxSize', kind: 'number', label: 'at most (bytes)', optional: true, default: null, min: 0 },
      { key: 'modifiedAfter', kind: 'date', label: 'modified after', optional: true, default: null },
      { key: 'modifiedBefore', kind: 'date', label: 'modified before', optional: true, default: null },
      {
        key: 'action',
        kind: 'enum',
        label: 'then',
        default: 'move',
        options: ['move', 'copy', 'delete', 'rename'],
      },
      {
        key: 'renameTemplate',
        kind: 'text',
        label: 'new name',
        optional: true,
        default: null,
        syntax: 'template',
      },
    ],
    inputs: [
      { key: 'folder', label: 'look in folder', type: PATH },
      { key: 'destination', label: 'into folder', type: PATH, optional: true },
    ],
    bodies: [],
    binds: [],
    requires: [
      { when: { field: 'action', equals: ['move', 'copy'] }, need: ['destination'] },
      { when: { field: 'action', equals: ['rename'] }, need: ['renameTemplate'] },
    ],
  },

  findFirst: {
    name: 'findFirst',
    label: 'Find the first file where\u2026 (binary search)',
    help:
      'Sorts the files in the folder, then finds the first one where the condition is true ' +
      'by repeatedly checking the middle and halving the range. The condition must be false ' +
      'for the early files and true from some point on \u2014 otherwise the answer can be wrong.',
    fields: [
      {
        key: 'sortBy',
        kind: 'enum',
        label: 'sorted by',
        default: 'name',
        options: ['name', 'modified', 'size'],
      },
    ],
    inputs: [
      { key: 'folder', label: 'files in folder', type: PATH },
      { key: 'condition', label: 'where', type: BOOL },
    ],
    bodies: [
      { key: 'found', label: 'if found' },
      { key: 'notFound', label: 'otherwise' },
    ],
    binds: [
      { key: 'candidate', type: PATH, defaultName: 'candidate', visibleIn: ['condition'] },
      { key: 'match', type: PATH, defaultName: 'match', visibleIn: ['found'] },
    ],
  },
};

// ------------------------------------------------------------------ Helpers

/** Field value with the schema default applied for missing keys. */
export function getField(node: CompositeStmt, key: string): FieldValue {
  if (key in node.fields) return node.fields[key] ?? null;
  const schema = COMPOSITE_SCHEMAS[node.name].fields.find((f) => f.key === key);
  if (!schema) throw new Error(`Composite ${node.name} has no field "${key}"`);
  return schema.default;
}

/** User-chosen name for a bound variable, or the schema default. */
export function getBind(node: CompositeStmt, key: string): string {
  const name = node.binds[key];
  if (typeof name === 'string' && name.length > 0) return name;
  const schema = COMPOSITE_SCHEMAS[node.name].binds.find((b) => b.key === key);
  if (!schema) throw new Error(`Composite ${node.name} has no bind "${key}"`);
  return schema.defaultName;
}
