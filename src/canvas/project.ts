import type { CanvasEdge, CanvasLayout, CanvasNode } from './types.ts';

export function projectProgram(
  _program: unknown,
  overrides: CanvasLayout = { nodes: {} },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  for (const [id, position] of Object.entries(overrides.nodes ?? {})) {
    nodes.push({
      id,
      kind: 'sequence',
      label: id,
      binds: [],
      irPath: [],
      position,
      data: {},
    });
  }

  return { nodes, edges };
}
