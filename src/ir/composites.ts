/**
 * Composite blocks — CONTRACT (design.md §6.1).
 *
 * This file defines the composite node shape and the *schemas* of the v1 composites
 * (fields, inputs, bodies, bound names). The desugarings themselves live in src/composites/.
 */
import type { NodeId, Stmt, Expr, Type, Program } from './types.ts';

export const COMPOSITE_NAMES = ['renameByPattern', 'sortByType', 'findAndAct', 'findFirst'] as const;
export type CompositeTaskName = (typeof COMPOSITE_NAMES)[number];
export const ACTION_NAMES = [
  'everyFile',
  'makeFolderIfMissing',
  'goThrough',
  'repeatTimes',
  'keepDoingUntil',
  'findFile',
  'halvingSearch',
  'keepLeftHalf',
  'keepRightHalf',
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];
export type CompositeName = CompositeTaskName | ActionName;
export const COMPOSITE_EXPR_NAMES = ['filesIn', 'countFiles', 'typeOf'] as const;
export type CompositeExprName = (typeof COMPOSITE_EXPR_NAMES)[number];
export const ALL_COMPOSITE_NAMES = [...COMPOSITE_NAMES, ...ACTION_NAMES] as const;
export type AnyCompositeName = CompositeName;

/** Literal configuration value. `null` = optional field left unset. Dates are 'YYYY-MM-DD'. */
export type FieldValue = string | number | boolean | null;

export interface CompositeStmt {
  id: NodeId;
  kind: 'composite';
  name: AnyCompositeName;
  fields: Record<string, FieldValue>;
  inputs: Record<string, Expr>;
  bodies: Record<string, Stmt[]>;
  /** User-chosen names for the variables this composite introduces, keyed by bind key. */
  binds: Record<string, string>;
}

export interface CompositeExpr {
  id: NodeId;
  kind: 'compositeExpr';
  name: CompositeExprName;
  fields: Record<string, FieldValue>;
  inputs: Record<string, Expr>;
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
  name: AnyCompositeName;
  level: 'task' | 'action';
  rank: number;
  label: string;
  help: string;
  fields: readonly FieldSchema[];
  inputs: readonly InputSchema[];
  bodies: readonly { key: string; label: string }[];
  binds: readonly BindSchema[];
  /** Cross-field requirements beyond the schema (checked by the validator). */
  requires?: readonly { when: { field: string; equals: FieldValue[] }; need: string[] }[];
}

export interface CompositeExprSchema {
  name: CompositeExprName;
  level: 'action';
  rank: 1;
  label: string;
  help: string;
  returns: Type;
  fields: readonly FieldSchema[];
  inputs: readonly InputSchema[];
  binds: readonly BindSchema[];
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

export interface CompositeExprDef extends CompositeExprSchema {
  desugar(node: CompositeExpr, ctx: DesugarCtx): { pre: Stmt[]; value: Expr };
}

/** Injected into editor/ and export/ by app/ so they need not import composites/. */
export type DesugarProgram = (program: Program) => Program;
/** Desugars a single composite in the context of a program (used by editor Expand). */
export type DesugarOneResult =
  | { kind: 'stmt'; stmts: Stmt[] }
  | {
      kind: 'expr';
      pre: Stmt[];
      value: Expr;
      anchor: NodeId;
      anchorRole: 'before' | 'whileCond' | 'shortCircuit';
    };
/** Legacy statement expansion API; v2 expression expansion uses DesugarOneResult internally. */
export type DesugarOne = (program: Program, compositeId: NodeId) => Stmt[];
export type DesugarFully = (program: Program, compositeId: NodeId) => DesugarOneResult;

// ------------------------------------------------------------------ Schemas
const PATH: Type = { t: 'path' };
const BOOL: Type = { t: 'bool' };

export const COMPOSITE_SCHEMAS: Readonly<Record<CompositeName, CompositeSchema>> = {
  renameByPattern: {
    name: 'renameByPattern',
    level: 'task',
    rank: 3,
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
    level: 'task',
    rank: 3,
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
    level: 'task',
    rank: 3,
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
    level: 'task',
    rank: 3,
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
} as unknown as Readonly<Record<CompositeName, CompositeSchema>>;

const actionBase = (name: ActionName, rank = 1): Pick<CompositeSchema, 'name' | 'level' | 'rank'> => ({
  name,
  level: 'action',
  rank,
});

export const ACTION_SCHEMAS: Readonly<Record<ActionName, CompositeSchema>> = {
  everyFile: {
    ...actionBase('everyFile', 2),
    label: 'Do something to every file',
    help:
      'Moves, copies, deletes, or renames each matching file. Does nothing when no file matches. ' +
      'You can include subfolders and make a destination folder when it is missing.',
    fields: [
      { key: 'action', kind: 'enum', label: 'action', default: 'move', options: ['move', 'copy', 'delete', 'rename'] },
      { key: 'includeSubfolders', kind: 'bool', label: 'include subfolders', default: false },
      { key: 'makeFolder', kind: 'bool', label: 'make folder', default: false },
      { key: 'renameTemplate', kind: 'text', label: 'new name', optional: true, default: null, syntax: 'template' },
    ],
    inputs: [
      { key: 'folder', label: 'in folder', type: PATH },
      { key: 'condition', label: 'where', type: BOOL, optional: true },
      { key: 'destination', label: 'into folder', type: PATH, optional: true },
    ],
    bodies: [],
    binds: [{ key: 'file', type: PATH, defaultName: 'file', visibleIn: ['condition', 'destination'] }],
    requires: [
      { when: { field: 'action', equals: ['move', 'copy'] }, need: ['destination'] },
      { when: { field: 'action', equals: ['rename'] }, need: ['renameTemplate'] },
    ],
  },
  makeFolderIfMissing: {
    ...actionBase('makeFolderIfMissing'),
    label: 'Make folder if it is missing',
    help: 'Makes the folder when it is missing and does nothing when it already exists.',
    fields: [], inputs: [{ key: 'path', label: 'folder', type: PATH }], bodies: [], binds: [],
  },
  goThrough: {
    ...actionBase('goThrough'),
    label: 'Go through files one by one',
    help: 'Runs the steps once for each file; does nothing when there are no files.',
    fields: [{ key: 'includeSubfolders', kind: 'bool', label: 'include subfolders', default: false }],
    inputs: [{ key: 'folder', label: 'in folder', type: PATH }],
    bodies: [{ key: 'body', label: 'steps' }],
    binds: [{ key: 'file', type: PATH, defaultName: 'file', visibleIn: ['body'] }],
  },
  repeatTimes: {
    ...actionBase('repeatTimes'),
    label: 'Repeat a number of times',
    help: 'Runs the steps the given number of times; does nothing when the number is zero.',
    fields: [], inputs: [{ key: 'n', label: 'times', type: { t: 'number' } }], bodies: [{ key: 'body', label: 'steps' }], binds: [],
  },
  keepDoingUntil: {
    ...actionBase('keepDoingUntil'),
    label: 'Keep doing until',
    help: 'Checks the condition before each round and runs no steps when it is already true.',
    fields: [], inputs: [{ key: 'condition', label: 'until', type: BOOL }], bodies: [{ key: 'body', label: 'steps' }], binds: [],
  },
  findFile: {
    ...actionBase('findFile'),
    label: 'Find a file',
    help: 'Runs the matching steps for the chosen file, or the no-match steps when no file matches.',
    fields: [
      { key: 'which', kind: 'enum', label: 'which', default: 'first', options: ['first', 'biggest', 'smallest', 'newest', 'oldest'] },
      { key: 'includeSubfolders', kind: 'bool', label: 'include subfolders', default: false },
    ],
    inputs: [
      { key: 'folder', label: 'in folder', type: PATH },
      { key: 'condition', label: 'where', type: BOOL, optional: true },
    ],
    bodies: [{ key: 'found', label: 'if found' }, { key: 'notFound', label: 'if none is found' }],
    binds: [
      { key: 'file', type: PATH, defaultName: 'file', visibleIn: ['condition'] },
      { key: 'found', type: PATH, defaultName: 'found', visibleIn: ['found'] },
    ],
  },
  halvingSearch: {
    ...actionBase('halvingSearch'),
    label: 'Search by halving',
    help: 'Looks at the middle item repeatedly, then runs the matching result steps or the no-match steps.',
    fields: [], inputs: [{ key: 'line', label: 'line', type: { t: 'list', of: PATH } }],
    bodies: [{ key: 'decide', label: 'decide' }, { key: 'found', label: 'if found' }, { key: 'notFound', label: 'if none is found' }],
    binds: [
      { key: 'middle', type: PATH, defaultName: 'middle', visibleIn: ['decide'] },
      { key: 'answer', type: PATH, defaultName: 'answer', visibleIn: ['found'] },
    ],
  },
  keepLeftHalf: { ...actionBase('keepLeftHalf'), label: 'Keep the left half, including the middle', help: 'Used inside a halving search.', fields: [], inputs: [], bodies: [], binds: [] },
  keepRightHalf: { ...actionBase('keepRightHalf'), label: 'Keep the right half', help: 'Used inside a halving search.', fields: [], inputs: [], bodies: [], binds: [] },
};

export const COMPOSITE_EXPR_SCHEMAS: Readonly<Record<CompositeExprName, CompositeExprSchema>> = {
  filesIn: {
    name: 'filesIn', level: 'action', rank: 1, label: 'The files in',
    help: 'Returns matching files in the requested order, or an empty list when no files match.',
    returns: { t: 'list', of: PATH },
    fields: [
      { key: 'includeSubfolders', kind: 'bool', label: 'include subfolders', default: false },
      { key: 'order', kind: 'enum', label: 'lined up by', default: 'listing', options: ['listing', 'name', 'date', 'size'] },
    ],
    inputs: [{ key: 'folder', label: 'folder', type: PATH }, { key: 'condition', label: 'where', type: BOOL, optional: true }],
    binds: [{ key: 'file', type: PATH, defaultName: 'file', visibleIn: ['condition'] }],
  },
  countFiles: {
    name: 'countFiles', level: 'action', rank: 1, label: 'How many files',
    help: 'Counts the matching files and returns zero when no files match.',
    returns: { t: 'number' },
    fields: [{ key: 'includeSubfolders', kind: 'bool', label: 'include subfolders', default: false }],
    inputs: [{ key: 'folder', label: 'folder', type: PATH }, { key: 'condition', label: 'where', type: BOOL, optional: true }],
    binds: [{ key: 'file', type: PATH, defaultName: 'file', visibleIn: ['condition'] }],
  },
  typeOf: {
    name: 'typeOf', level: 'action', rank: 1, label: 'The type of', help: 'Returns the file type category or extension.',
    returns: { t: 'text' },
    fields: [{ key: 'by', kind: 'enum', label: 'by', default: 'category', options: ['category', 'extension'] }],
    inputs: [{ key: 'file', label: 'file', type: PATH }],
    binds: [],
  },
};

export function schemaFor(name: AnyCompositeName): CompositeSchema {
  return COMPOSITE_SCHEMAS[name as CompositeName] ?? ACTION_SCHEMAS[name as ActionName];
}

// ------------------------------------------------------------------ Helpers

/** Field value with the schema default applied for missing keys. */
export function getField(node: CompositeStmt | CompositeExpr, key: string): FieldValue {
  if (key in node.fields) return node.fields[key] ?? null;
  const schema = node.kind === 'composite'
    ? schemaFor(node.name).fields.find((f) => f.key === key)
    : COMPOSITE_EXPR_SCHEMAS[node.name].fields.find((f) => f.key === key);
  if (!schema) throw new Error(`Composite ${node.name} has no field "${key}"`);
  return schema.default;
}

/** User-chosen name for a bound variable, or the schema default. */
export function getBind(node: CompositeStmt | CompositeExpr, key: string): string {
  const name = node.binds[key];
  if (typeof name === 'string' && name.length > 0) return name;
  const schema = node.kind === 'composite'
    ? schemaFor(node.name).binds.find((b) => b.key === key)
    : COMPOSITE_EXPR_SCHEMAS[node.name].binds.find((b) => b.key === key);
  if (!schema) throw new Error(`Composite ${node.name} has no bind "${key}"`);
  return schema.defaultName;
}
