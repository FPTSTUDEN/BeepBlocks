/**
 * Project files and autosave (design.md §13, Req 12).
 *
 * A project's program may be work in progress (empty sockets are `null`), so loading checks
 * structure with `validateStructure`; the full validator still gates Run and Export.
 */
import type { NodeId, Program } from '../ir/types.ts';
import { COMPOSITE_NAMES } from '../ir/composites.ts';
import { RUN_BLOCK_ID } from '../ir/ids.ts';
import { validateStructure } from '../ir/validate.ts';
import {
  checkName,
  compareNames,
  type FsFolder,
  type FsNode,
  type SandboxFS,
  type Scenario,
} from '../domains/fileExplorer/fsTypes.ts';
import { SCENARIOS } from '../domains/fileExplorer/scenarios/index.ts';

export type Layout = Record<NodeId, { x: number; y: number }>;

export interface ProjectFile {
  format: 'beepblocks-project';
  version: 1;
  title: string;
  /** Un-desugared: composites preserved. */
  program: Program;
  /** Top-level stacks only. */
  layout: Layout;
  scenario: Scenario;
}

export const PROJECT_KEY = 'beepblocks.project';
export const PROJECT_EXTENSION = '.beep.json';
export const DEFAULT_TITLE = 'Untitled project';
const MAX_TITLE = 100;

export function emptyProgram(): Program {
  return { format: 'beepblocks-ir', version: 2, functions: [], body: [] };
}

export function newProject(scenario: Scenario = SCENARIOS[0]!): ProjectFile {
  return {
    format: 'beepblocks-project',
    version: 1,
    title: DEFAULT_TITLE,
    program: emptyProgram(),
    layout: { [RUN_BLOCK_ID]: { x: 40, y: 40 } },
    scenario: structuredClone(scenario),
  };
}

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 2) + '\n';
}

/** A file name for downloading: the title with unsafe characters replaced. */
export function projectFileName(title: string): string {
  const base = [...title.trim()]
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? '-' : ch))
    .join('')
    .replace(/-{2,}/g, '-')
    .replace(/[. ]+$/, '');
  return (base || 'project') + PROJECT_EXTENSION;
}

// -------------------------------------------------------------- validation

export type ProjectParse = { ok: true; project: ProjectFile } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

function checkTree(fs: unknown, errors: string[]): void {
  if (!isObj(fs) || !isObj(fs.root)) {
    errors.push('The scenario has no root folder.');
    return;
  }
  const root = fs.root;
  if (root.type !== 'folder') {
    errors.push('The scenario root must be a folder.');
    return;
  }
  const visit = (n: unknown, path: string, isRoot: boolean): void => {
    if (errors.length >= 20) return;
    if (!isObj(n)) {
      errors.push(`Scenario: an item in "${path || '/'}" is not valid.`);
      return;
    }
    const name = typeof n.name === 'string' ? n.name : '';
    const here = isRoot ? '' : path ? `${path}/${name}` : name;
    if (!isRoot) {
      const problem = typeof n.name === 'string' ? checkName(n.name) : 'A name is required.';
      if (problem) errors.push(`Scenario: "${here || '?'}": ${problem}`);
    }
    if (!isInt(n.modified) || n.modified < 0) {
      errors.push(`Scenario: "${here || '/'}" has an invalid modified time.`);
    }
    if (n.type === 'folder') {
      if (!Array.isArray(n.children)) {
        errors.push(`Scenario: folder "${here || '/'}" has no item list.`);
        return;
      }
      const seen = new Set<string>();
      for (const c of n.children as unknown[]) {
        if (isObj(c) && typeof c.name === 'string') {
          const key = c.name.toLowerCase();
          if (seen.has(key)) errors.push(`Scenario: "${here || '/'}" has two items named "${c.name}".`);
          seen.add(key);
        }
        visit(c, here, false);
      }
    } else if (n.type === 'file') {
      const hasContent = n.content !== undefined;
      const hasSize = n.binarySize !== undefined;
      if (hasContent === hasSize) {
        errors.push(`Scenario: file "${here}" needs either text content or a binary size, not both.`);
      } else if (hasContent && typeof n.content !== 'string') {
        errors.push(`Scenario: file "${here}" has invalid content.`);
      } else if (hasSize && (!isInt(n.binarySize) || n.binarySize < 0)) {
        errors.push(`Scenario: file "${here}" has an invalid size.`);
      }
    } else {
      errors.push(`Scenario: "${here}" is neither a file nor a folder.`);
    }
  };
  visit(root, '', true);
}

/** Validates a scenario object; returns problems (empty = valid). */
export function checkScenario(s: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(s)) return ['The project has no scenario.'];
  for (const key of ['id', 'title', 'description'] as const) {
    if (typeof s[key] !== 'string') errors.push(`The scenario is missing its ${key}.`);
  }
  if (
    s.suggestedComposite !== undefined &&
    !(COMPOSITE_NAMES as readonly unknown[]).includes(s.suggestedComposite)
  ) {
    errors.push('The scenario suggests an unknown task block.');
  }
  checkTree(s.tree, errors);
  return errors;
}

function checkLayout(l: unknown): l is Layout {
  return (
    isObj(l) &&
    Object.values(l).every(
      (p) => isObj(p) && Number.isFinite(p.x as number) && Number.isFinite(p.y as number),
    )
  );
}

/**
 * Parses and validates a project (JSON text or parsed value). Never throws. On success the
 * result is a fresh object safe to store.
 */
export function parseProject(input: string | unknown): ProjectParse {
  let v: unknown = input;
  if (typeof input === 'string') {
    try {
      v = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['This file is not valid JSON.'] };
    }
  }
  if (!isObj(v) || v.format !== 'beepblocks-project') {
    return { ok: false, errors: ['This is not a BeepBlocks project file.'] };
  }
  if (v.version !== 1) {
    return {
      ok: false,
      errors: [`This project uses format version ${String(v.version)}; this app reads version 1.`],
    };
  }
  const errors: string[] = [];
  if (typeof v.title !== 'string') errors.push('The project has no title.');
  if (!checkLayout(v.layout)) errors.push('The block positions are not valid.');
  const program = v.program;
  if (!isObj(program) || program.format !== 'beepblocks-ir' || (program.version !== 1 && program.version !== 2)) {
    errors.push('The project does not contain a valid BeepBlocks program.');
  } else {
    for (const e of validateStructure(program).filter((i) => i.severity === 'error').slice(0, 10)) {
      errors.push(`Program${e.nodeId ? ` (block ${e.nodeId})` : ''}: ${e.message}`);
    }
  }
  errors.push(...checkScenario(v.scenario));
  if (errors.length > 0) return { ok: false, errors };
  const copy = structuredClone(v) as unknown as ProjectFile;
  copy.program.version = 2;
  copy.title = copy.title.slice(0, MAX_TITLE);
  copy.scenario = { ...copy.scenario, tree: sortTree(copy.scenario.tree) };
  return { ok: true, project: copy };
}

/** Folder children in design.md §5.3 order (imported files may list them in any order). */
function sortTree(fs: SandboxFS): SandboxFS {
  const sort = (n: FsNode): FsNode =>
    n.type === 'folder'
      ? { ...n, children: n.children.map(sort).sort((a, b) => compareNames(a.name, b.name)) }
      : n;
  return { root: sort(fs.root) as FsFolder };
}

// ---------------------------------------------------------------- autosave

/** Storage keys and format strings from before the BeepBlocks rename. */
const LEGACY_PROJECT_KEY = 'bp.project';
const LEGACY_SETTINGS_KEY = 'bp.settings';

/**
 * One-time move of an autosave written under the pre-rename keys ("Block Playground"):
 * rewrites the old format strings and moves both keys. Never throws; leaves newer data alone.
 */
export function migrateLegacyStorage(storage: Storage | undefined, settingsKey: string): void {
  if (!storage) return;
  try {
    const oldProject = storage.getItem(LEGACY_PROJECT_KEY);
    if (oldProject !== null) {
      if (storage.getItem(PROJECT_KEY) === null) {
        const p = JSON.parse(oldProject) as Record<string, unknown>;
        if (p.format === 'block-playground-project') p.format = 'beepblocks-project';
        const prog = p.program as Record<string, unknown> | undefined;
        if (prog && prog.format === 'block-playground-ir') prog.format = 'beepblocks-ir';
        storage.setItem(PROJECT_KEY, JSON.stringify(p));
      }
      storage.removeItem(LEGACY_PROJECT_KEY);
    }
    const oldSettings = storage.getItem(LEGACY_SETTINGS_KEY);
    if (oldSettings !== null) {
      if (storage.getItem(settingsKey) === null) storage.setItem(settingsKey, oldSettings);
      storage.removeItem(LEGACY_SETTINGS_KEY);
    }
  } catch {
    /* unreadable or blocked: start fresh */
  }
}

/** The autosaved project, or null if there is none or it is unreadable. Never throws. */
export function loadStoredProject(storage: Storage | undefined): ProjectFile | null {
  try {
    const raw = storage?.getItem(PROJECT_KEY);
    if (!raw) return null;
    const res = parseProject(raw);
    if (res.ok) return res.project;
    console.warn('Ignoring the saved project:', res.errors);
  } catch {
    /* storage blocked */
  }
  return null;
}

/** Returns false if the project could not be saved (quota exceeded or storage blocked). */
export function saveStoredProject(storage: Storage | undefined, p: ProjectFile): boolean {
  try {
    storage?.setItem(PROJECT_KEY, JSON.stringify(p));
    return storage !== undefined;
  } catch {
    return false;
  }
}
