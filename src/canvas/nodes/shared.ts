import type { Node, NodeProps } from '@xyflow/react';

export interface CanvasNodeRenderData extends Record<string, unknown> {
  label?: string;
  binds?: string[];
  category?: string;
  recursive?: boolean;
  branches?: Array<string | { id?: string; label?: string }>;
  branchCount?: number;
  inputCount?: number;
  inputs?: unknown[];
  bodyCount?: number;
}

export type CanvasNodeRenderProps = NodeProps<Node<CanvasNodeRenderData>>;

export function nodeLabel(data: CanvasNodeRenderData, fallback: string): string {
  return typeof data.label === 'string' && data.label.length > 0 ? data.label : fallback;
}

export function categoryClass(data: CanvasNodeRenderData): string {
  const allowed = new Set(['file-ops', 'control-flow', 'search', 'math', 'composite']);
  return allowed.has(data.category ?? '') ? `sequence-node--${data.category}` : 'sequence-node--composite';
}

export function branchLabels(data: CanvasNodeRenderData): string[] {
  if (Array.isArray(data.branches)) {
    return data.branches.map((branch, index) =>
      typeof branch === 'string' ? branch : branch.label ?? branch.id ?? `Branch ${index + 1}`,
    );
  }
  const count = typeof data.branchCount === 'number' ? Math.max(0, Math.floor(data.branchCount)) : 2;
  return Array.from({ length: count }, (_, index) => `Branch ${index + 1}`);
}

export function mergeInputCount(data: CanvasNodeRenderData): number {
  if (typeof data.inputCount === 'number') return Math.max(1, Math.floor(data.inputCount));
  if (Array.isArray(data.inputs)) return Math.max(1, data.inputs.length);
  return 2;
}
