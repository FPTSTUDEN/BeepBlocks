/**
 * Starter projects (tasks 3.2): one ready-made project per built-in scenario, each showing
 * the scenario's suggested composite. Each starter is also a conformance fixture
 * (`conformance/fixtures/starter-<scenario id>/`); `pnpm gen:starters` rewrites the fixture's
 * program.json and tree.json from this file, and `conformance/starters.test.ts` checks they
 * are in sync. The fixture's expected.json is written by hand.
 *
 * Node ids are fixed (not generated) so that the fixtures are stable.
 */
import { b } from '../ir/build.ts';
import { RUN_BLOCK_ID } from '../ir/ids.ts';
import type { Program } from '../ir/types.ts';
import type { Scenario } from '../domains/fileExplorer/fsTypes.ts';
import { SCENARIOS } from '../domains/fileExplorer/scenarios/index.ts';
import type { ProjectFile } from './project.ts';

export interface Starter {
  /** Scenario id this starter runs on. */
  scenarioId: string;
  title: string;
  /** One sentence for the "New project" dialog. */
  summary: string;
  program: Program;
}

const inRoot = (name: string, id: string) =>
  b.op('fs.join', [b.root(`${id}-root`), b.lit(name, `${id}-name`)], id);

export const STARTERS: readonly Starter[] = [
  {
    scenarioId: 'messy-downloads',
    title: 'Sort my downloads',
    summary: 'Moves every file in Downloads into a folder for its type: Images, Documents, Audio and so on.',
    program: b.program([
      b.composite(
        'sortByType',
        { fields: { grouping: 'category' }, inputs: { folder: b.root('dl-folder') } },
        'dl-sort',
      ),
    ]),
  },
  {
    scenarioId: 'camera-photos',
    title: 'Rename camera photos',
    summary: 'Renames IMG_0001.JPG and friends to the date each photo was taken plus a counter.',
    program: b.program([
      b.composite(
        'renameByPattern',
        {
          fields: { match: 'IMG_*', template: '{date}_{n:3}{ext}' },
          inputs: { folder: b.root('cam-folder') },
        },
        'cam-rename',
      ),
    ]),
  },
  {
    scenarioId: 'project-tree',
    title: 'Clear out temporary files',
    summary: 'Makes a Trash folder, then finds every .tmp file in the project and moves it there.',
    program: b.program([
      b.if(
        b.not(b.op('fs.exists', [inRoot('Trash', 'pt-exists-path')], 'pt-exists'), 'pt-missing'),
        [b.do(b.op('fs.makeFolder', [inRoot('Trash', 'pt-mkdir-path')], 'pt-mkdir-op'), 'pt-mkdir')],
        [],
        'pt-if',
      ),
      b.composite(
        'findAndAct',
        {
          fields: { recursive: true, extension: 'tmp', action: 'move' },
          inputs: { folder: b.root('pt-folder'), destination: inRoot('Trash', 'pt-dest') },
        },
        'pt-find',
      ),
    ]),
  },
  {
    scenarioId: 'nightly-logs',
    title: 'Find the first failing night',
    summary: 'Binary search: checks the middle log, halves the range, and finds the first ERROR in a few reads.',
    program: b.program([
      b.composite(
        'findFirst',
        {
          fields: { sortBy: 'name' },
          inputs: {
            folder: b.root('nl-folder'),
            condition: b.op(
              'text.contains',
              [
                b.op('fs.readText', [b.v('log', 'nl-cond-log')], 'nl-cond-read'),
                b.lit('status: ERROR', 'nl-cond-text'),
              ],
              'nl-cond',
            ),
          },
          bodies: {
            found: [
              b.print(
                b.bin(
                  '+',
                  b.lit('First failing night: ', 'nl-found-label'),
                  b.op('fs.name', [b.v('failed', 'nl-found-var')], 'nl-found-name'),
                  'nl-found-text',
                ),
                'nl-found',
              ),
            ],
            notFound: [b.print(b.lit('Every night passed.', 'nl-none-text'), 'nl-none')],
          },
          binds: { candidate: 'log', match: 'failed' },
        },
        'nl-search',
      ),
    ]),
  },
];

export function getStarter(scenarioId: string): Starter | undefined {
  return STARTERS.find((s) => s.scenarioId === scenarioId);
}

/** A fresh project for a starter, on a copy of its built-in scenario. */
export function starterProject(starter: Starter, scenarios: readonly Scenario[] = SCENARIOS): ProjectFile {
  const scenario = scenarios.find((s) => s.id === starter.scenarioId);
  if (!scenario) throw new Error(`Starter "${starter.title}" needs missing scenario "${starter.scenarioId}"`);
  return {
    format: 'beepblocks-project',
    version: 1,
    title: starter.title,
    program: structuredClone(starter.program),
    layout: { [RUN_BLOCK_ID]: { x: 40, y: 40 } },
    scenario: structuredClone(scenario),
  };
}
