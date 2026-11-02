/**
 * Writes program.json and tree.json for each starter project's conformance fixture
 * (`pnpm gen:starters`). expected.json is never touched: it is written and checked by hand.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTERS, starterFixtureDir, starterFixtureFiles } from './lib/starters.ts';

for (const s of STARTERS) {
  const dir = starterFixtureDir(s);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(starterFixtureFiles(s))) {
    writeFileSync(join(dir, file), text, 'utf8');
  }
  const golden = existsSync(join(dir, 'expected.json')) ? '' : '  (no expected.json yet)';
  console.log(`wrote ${dir}${golden}`);
}
