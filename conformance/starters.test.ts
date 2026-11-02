import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS } from '../src/domains/fileExplorer/scenarios/index.ts';
import { desugarProgram } from '../src/composites/index.ts';
import { simulateSync } from '../src/sim/index.ts';
import { STARTERS, starterFixtureDir, starterFixtureFiles, starterFixtureName } from './lib/starters.ts';

describe('starter projects', () => {
  it('has exactly one starter per built-in scenario', () => {
    expect(STARTERS.map((s) => s.scenarioId).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  it('shows each scenario’s suggested composite', () => {
    for (const s of STARTERS) {
      const sc = SCENARIOS.find((x) => x.id === s.scenarioId)!;
      const names = s.program.body.filter((n) => n.kind === 'composite').map((n) => n.name);
      expect(names, s.title).toContain(sc.suggestedComposite);
    }
  });

  it('finds the first failing night in a handful of reads (binary search, not a scan)', () => {
    const s = STARTERS.find((x) => x.scenarioId === 'nightly-logs')!;
    const tree = SCENARIOS.find((x) => x.id === s.scenarioId)!.tree;
    const res = simulateSync(desugarProgram(s.program), tree);
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    expect(res.timeline.output.map((l) => l.text)).toEqual(['First failing night: nightly-2026-02-10.log']);
    // Logs opened by the condition: 64 logs → at most ceil(log2(65)) = 7. Hand-traced probes:
    // 32 (02-02 OK), 48 (02-18 ERROR), 40 (02-10 ERROR), 36 (02-06 OK), 38 (02-08 OK), 39 (02-09 OK).
    const opened = res.timeline.snapshots.filter((x) => x.event === 'fsRead' && x.nodeId === 'nl-cond-read');
    expect(opened).toHaveLength(6);
  });

  describe.each(STARTERS.map((s) => [starterFixtureName(s), s] as const))('fixture %s', (_name, s) => {
    it('matches the starter (run `pnpm gen:starters` after changing a starter)', () => {
      const dir = starterFixtureDir(s);
      for (const [file, text] of Object.entries(starterFixtureFiles(s))) {
        expect(readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n'), file).toBe(text);
      }
    });

    it('has a hand-written golden', () => {
      expect(existsSync(join(starterFixtureDir(s), 'expected.json'))).toBe(true);
    });
  });
});
