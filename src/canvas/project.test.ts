import { describe, expect, it } from 'vitest';
import { b } from '../ir/build.ts';
import { autoLayout, routeBackEdges } from './layout.ts';
import { projectProgram } from './project.ts';

describe('canvas projection', () => {
  it('projects a flat program into a start/sequence/end chain', () => {
    const program = b.program([
      b.assign('x', b.lit(1)),
      b.assign('y', b.v('x')),
      b.print(b.v('y')),
    ]);

    const result = projectProgram(program);
    expect(result.nodes.some((node) => node.id === 'term-start')).toBe(true);
    expect(result.nodes.some((node) => node.id === 'term-end')).toBe(true);
    expect(result.nodes.filter((node) => node.kind === 'sequence')).toHaveLength(3);
    expect(result.edges.some((edge) => edge.source === 'term-start' && edge.target === 'stmt-program.0')).toBe(true);
    expect(result.edges.some((edge) => edge.source === 'stmt-program.0' && edge.target === 'stmt-program.1')).toBe(true);
    expect(result.edges.some((edge) => edge.kind === 'data' && edge.label === 'x')).toBe(true);
  });

  it('projects if/else branches to condition and merge nodes', () => {
    const program = b.program([
      b.if(
        b.v('flag'),
        [b.assign('left', b.lit(1))],
        [b.assign('right', b.lit(2))],
      ),
    ]);

    const result = projectProgram(program);
    const condition = result.nodes.find((node) => node.kind === 'condition');
    const merge = result.nodes.find((node) => node.kind === 'merge');

    expect(condition).toBeTruthy();
    expect(merge).toBeTruthy();
    expect(result.edges.some((edge) => edge.source === condition!.id && edge.sourceHandle === 'true')).toBe(true);
    expect(result.edges.some((edge) => edge.source === condition!.id && edge.sourceHandle === 'false')).toBe(true);
    expect(result.edges.some((edge) => edge.target === merge!.id && edge.targetHandle === 'in-0')).toBe(true);
    expect(result.edges.some((edge) => edge.target === merge!.id && edge.targetHandle === 'in-1')).toBe(true);
  });

  it('allows execution to continue after a return-only if branch with no else', () => {
    const program = b.program([
      b.if(b.v('flag'), [b.ret(b.lit(1))]),
      b.assign('after', b.lit(2)),
    ]);

    const result = projectProgram(program);
    const condition = result.nodes.find((node) => node.kind === 'condition');
    const merge = result.nodes.find((node) => node.kind === 'merge');
    expect(condition).toBeTruthy();
    expect(merge).toBeTruthy();
    expect(result.edges.some((edge) =>
      edge.source === condition!.id && edge.sourceHandle === 'false' && edge.target === merge!.id,
    )).toBe(true);
    expect(result.edges.some((edge) => edge.source === merge!.id && edge.target === 'stmt-program.1')).toBe(true);
    expect(result.edges.some((edge) =>
      edge.source === 'stmt-program.0.then.0' && edge.target === merge!.id,
    )).toBe(false);
  });

  it('records projected loop body nodes for canvas collapse', () => {
    const result = projectProgram(b.program([
      b.while(b.v('keepGoing'), [b.if(b.v('ready'), [b.print(b.lit('step'))])]),
    ]));
    const loop = result.nodes.find((node) => node.kind === 'loop');

    expect(loop?.data.bodyNodeIds).toContain('stmt-program.0.body.0');
    expect(loop?.data.bodyNodeIds).toContain('stmt-program.0.body.0.then.0');
    expect(loop?.data.bodyNodeCount).toBe(1);
  });

  it('marks recursive function frames and adds a self-edge', () => {
    const program = b.program([], [
      b.fn('recurse', [], null, [b.do(b.call('recurse', []))]),
    ]);

    const result = projectProgram(program);
    const frame = result.nodes.find((node) => node.kind === 'frame' && node.label === 'recurse');

    expect(frame).toBeTruthy();
    expect(frame!.data.recursive).toBe(true);
    expect(result.edges.some((edge) => edge.kind === 'self' && edge.source === 'stmt-function.recurse.body.0')).toBe(true);
  });

  it('keeps explicit layout overrides on projected node ids', () => {
    const program = b.program([b.assign('value', b.lit(3))]);
    const result = projectProgram(program, {
      nodes: {
        'stmt-program.0': { x: 42, y: 99 },
      },
    });

    const assignNode = result.nodes.find((node) => node.id === 'stmt-program.0');
    expect(assignNode?.position).toEqual({ x: 42, y: 99 });
  });
});

describe('canvas layout', () => {
  it('orders linear exec edges top-to-bottom without mutating override positions', () => {
    const nodes = [
      { id: 'a', kind: 'sequence' as const, label: 'A', binds: [], irPath: [0], position: { x: 0, y: 0 }, data: {} },
      { id: 'b', kind: 'sequence' as const, label: 'B', binds: [], irPath: [1], position: { x: 0, y: 0 }, data: {} },
      { id: 'c', kind: 'sequence' as const, label: 'C', binds: [], irPath: [2], position: { x: 0, y: 0 }, data: {} },
    ];
    const edges = [
      { id: 'a->b', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in', kind: 'exec' as const },
      { id: 'b->c', source: 'b', sourceHandle: 'out', target: 'c', targetHandle: 'in', kind: 'exec' as const },
    ];

    const laidOut = autoLayout(nodes, edges);
    expect(laidOut.find((node) => node.id === 'a')!.position.y).toBeLessThan(
      laidOut.find((node) => node.id === 'b')!.position.y,
    );
    expect(laidOut.find((node) => node.id === 'b')!.position.y).toBeLessThan(
      laidOut.find((node) => node.id === 'c')!.position.y,
    );

    const overridden = autoLayout(nodes, edges, { nodes: { b: { x: 10, y: 20 } } });
    expect(overridden.find((node) => node.id === 'b')!.position).toEqual({ x: 10, y: 20 });
  });

  it('routes back-edge controls to the left of the loop nodes', () => {
    const nodes = [
      { id: 'loop', kind: 'loop' as const, label: 'while', binds: [], irPath: [0], position: { x: 100, y: 0 }, data: {} },
      { id: 'body', kind: 'sequence' as const, label: 'body', binds: [], irPath: [0, 0], position: { x: 180, y: 120 }, data: {} },
    ];
    const backEdge = {
      id: 'body-back',
      source: 'body',
      sourceHandle: 'out',
      target: 'loop',
      targetHandle: 'back-in',
      kind: 'back' as const,
    };

    const routed = routeBackEdges(nodes, [backEdge]);
    const bezier = routed[0]!.data!.bezier as {
      controlPoint1: { x: number; y: number };
      controlPoint2: { x: number; y: number };
    };
    expect(bezier.controlPoint1.x).toBeLessThan(100);
    expect(bezier.controlPoint2.x).toBeLessThan(100);
  });
});
