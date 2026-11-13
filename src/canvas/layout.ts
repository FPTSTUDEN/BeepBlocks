import type { CanvasLayout, CanvasNode } from './types.ts';

export function autoLayout(
  nodes: CanvasNode[],
  _edges: unknown[] = [],
  overrides: CanvasLayout = { nodes: {} },
): CanvasNode[] {
  const next = nodes.map((node, index) => {
    const override = overrides.nodes[node.id];
    return {
      ...node,
      position: override ?? { x: 120 + (index % 3) * 220, y: 80 + Math.floor(index / 3) * 120 },
    };
  });

  return next;
}
