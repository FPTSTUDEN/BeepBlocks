import dagre from 'dagre';
import type { CanvasEdge, CanvasLayout, CanvasNode } from './types.ts';

export function nodeSize(node: CanvasNode): { width: number; height: number } {
  if (node.kind === 'frame') return { width: 220, height: 60 };
  if (node.kind === 'condition' || node.kind === 'merge') return { width: 120, height: 80 };
  return { width: 160, height: 60 };
}

export function autoLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[] = [],
  overrides: CanvasLayout = { nodes: {} },
): CanvasNode[] {
  if (nodes.length === 0) return [];

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const { width, height } = nodeSize(node);
    graph.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    if (edge.kind !== 'exec' || edge.source === edge.target) continue;
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const override = overrides.nodes[node.id];
    if (override) {
      return { ...node, position: { ...override } };
    }

    const graphNode = graph.node(node.id);
    if (!graphNode) return node;

    return {
      ...node,
      position: {
        x: graphNode.x - graphNode.width / 2,
        y: graphNode.y - graphNode.height / 2,
      },
    };
  });
}

export function routeBackEdges(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return edges.map((edge) => {
    if (edge.kind !== 'back') return edge;

    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) return edge;

    const minY = Math.min(source.position.y, target.position.y);
    const maxY = Math.max(
      source.position.y + nodeSize(source).height,
      target.position.y + nodeSize(target).height,
    );
    const loopBand = nodes.filter((node) => {
      const { height } = nodeSize(node);
      return node.position.y <= maxY && node.position.y + height >= minY;
    });
    const leftmost = Math.min(...loopBand.map((node) => node.position.x));
    const routeX = leftmost - 48;
    const sourceY = source.position.y + nodeSize(source).height / 2;
    const targetY = target.position.y + nodeSize(target).height / 2;

    return {
      ...edge,
      data: {
        ...edge.data,
        bezier: {
          controlPoint1: { x: routeX, y: sourceY },
          controlPoint2: { x: routeX, y: targetY },
        },
      },
    };
  });
}
