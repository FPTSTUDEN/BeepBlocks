import { describe, expect, it } from 'vitest';
import { validateProgram } from '../ir/validate.ts';
import { SCENARIOS } from '../domains/fileExplorer/scenarios/index.ts';
import { parseProject, serializeProject } from './project.ts';
import { STARTERS, getStarter, starterProject } from './starters.ts';

describe.each(STARTERS.map((s) => [s.title, s] as const))('starter "%s"', (_title, s) => {
  it('is a valid program (runs and exports without fixes)', () => {
    expect(validateProgram(s.program).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('round-trips as a project file on its built-in scenario', () => {
    const p = starterProject(s);
    const res = parseProject(serializeProject(p));
    expect(res.ok ? res.project : res.errors).toEqual(p);
    expect(p.scenario).toEqual(SCENARIOS.find((x) => x.id === s.scenarioId));
  });

  it('gives each project its own copy', () => {
    const a = starterProject(s);
    a.program.body.length = 0;
    expect(starterProject(s).program.body.length).toBeGreaterThan(0);
    expect(getStarter(s.scenarioId)).toBe(s);
  });
});
