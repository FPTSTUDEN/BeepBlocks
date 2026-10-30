/** `pnpm gen:runtime`: regenerates runtime.gen.ts from runtime.py (design.md §8.3). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRuntimeModule } from './runtimeModule.ts';

const here = import.meta.dirname;
const source = readFileSync(join(here, 'runtime.py'), 'utf8');
writeFileSync(join(here, 'runtime.gen.ts'), renderRuntimeModule(source), 'utf8');
console.log('Wrote src/export/python/runtime.gen.ts');
