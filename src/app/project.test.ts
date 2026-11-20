import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import { SCENARIOS } from '../domains/fileExplorer/scenarios/index.ts';
import { newProject, parseProject, projectFileName, serializeProject } from './project.ts';

const withProgram = (program: unknown) => ({ ...newProject(), program });

describe('project files', () => {
  it('round-trips every built-in scenario', () => {
    for (const sc of SCENARIOS) {
      const p = { ...newProject(sc), program: b.program([b.print(b.lit('x'), 'p')]) };
      const res = parseProject(serializeProject(p));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.project).toEqual(p);
    }
  });

  it('accepts work-in-progress programs with empty sockets', () => {
    const res = parseProject(withProgram(b.program([b.print(null as never, 'p')])));
    expect(res.ok).toBe(true);
  });

  it('round-trips canvas positions without changing the IR', () => {
    const p = {
      ...newProject(),
      program: b.program([b.print(b.lit('kept'), 'print')]),
      canvas: { nodes: { 'stmt-program.0': { x: 70, y: 120 } } },
    };
    const result = parseProject(serializeProject(p));
    expect(result.ok && result.project.canvas).toEqual(p.canvas);
    expect(result.ok && result.project.program).toEqual(p.program);
  });

  it('opens a version 1 project without canvas data and preserves its IR when canvas data is saved', () => {
    const program = {
      ...b.program([b.print(b.lit('legacy'), 'legacy-print')]),
      version: 1 as const,
    };
    const legacyProject = { ...newProject(), program };
    const opened = parseProject(serializeProject(legacyProject));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.project.canvas).toBeUndefined();

    const saved = { ...opened.project, canvas: { nodes: {} } };
    const reloaded = parseProject(serializeProject(saved));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.project.canvas).toEqual({ nodes: {} });
    expect(reloaded.project.program).toEqual(opened.project.program);
  });

  it.each([
    ['not JSON', '{nope', /not valid JSON/],
    ['wrong format', { format: 'something-else' }, /not a BeepBlocks project/],
    ['newer version', { ...newProject(), version: 2 }, /version 2/],
    [
      'malformed program',
      withProgram({ format: 'beepblocks-ir', version: 1, body: 'x' }),
      /Program/,
    ],
    [
      'unknown node kind',
      withProgram(b.program([{ id: 'q', kind: 'teleport' } as never])),
      /not a statement/,
    ],
    ['no scenario', { ...newProject(), scenario: undefined }, /no scenario/],
  ])('rejects %s', (_label, input, message) => {
    const res = parseProject(input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join('\n')).toMatch(message);
  });

  it('rejects invalid scenario trees', () => {
    const p = newProject();
    const bad = (children: unknown[]) =>
      parseProject({
        ...p,
        scenario: { ...p.scenario, tree: { root: { ...p.scenario.tree.root, children } } },
      });
    const file = (name: string, extra: object = { content: '' }) => ({
      type: 'file',
      name,
      modified: 0,
      ...extra,
    });
    for (const children of [
      [file('CON')],
      [file('a.txt'), file('A.TXT')],
      [file('x', { content: 'a', binarySize: 1 })],
      [file('x', {})],
      [file('x', { binarySize: -1 })],
      [{ ...file('x'), modified: 1.5 }],
      [{ type: 'link', name: 'x', modified: 0 }],
    ]) {
      expect(bad(children).ok).toBe(false);
    }
  });

  it('sorts imported folder children', () => {
    const p = newProject();
    const children = [
      { type: 'file', name: 'b.txt', modified: 0, content: '' },
      { type: 'file', name: 'A.txt', modified: 0, content: '' },
    ];
    const res = parseProject({
      ...p,
      scenario: { ...p.scenario, tree: { root: { ...p.scenario.tree.root, children } } },
    });
    expect(res.ok && res.project.scenario.tree.root.children.map((c) => c.name)).toEqual([
      'A.txt',
      'b.txt',
    ]);
  });

  it('makes safe file names', () => {
    expect(projectFileName('My: project?')).toBe('My- project-.beep.json');
    expect(projectFileName('  ')).toBe('project.beep.json');
    expect(projectFileName('end.')).toBe('end.beep.json');
  });
});
