/**
 * Starter projects as conformance fixtures (tasks 3.2). Shared by `gen-starters.ts`, which
 * writes the files, and `starters.test.ts`, which checks they are up to date.
 */
import { join, resolve } from 'node:path';
import { STARTERS, starterProject, type Starter } from '../../src/app/starters.ts';

export const FIXTURES = resolve(import.meta.dirname, '..', 'fixtures');

export const starterFixtureName = (s: Starter) => `starter-${s.scenarioId}`;
export const starterFixtureDir = (s: Starter) => join(FIXTURES, starterFixtureName(s));

/** The generated files of a starter's fixture (expected.json is hand-written). */
export function starterFixtureFiles(s: Starter): { 'program.json': string; 'tree.json': string } {
  const p = starterProject(s);
  return {
    'program.json': JSON.stringify(p.program, null, 2) + '\n',
    'tree.json': JSON.stringify(p.scenario.tree, null, 2) + '\n',
  };
}

export { STARTERS };
