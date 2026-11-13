export interface NodeOverride {
  x: number;
  y: number;
}

export interface CanvasLayout {
  nodes: Record<string, NodeOverride>;
}

export type CanvasNodeKind =
  | 'sequence'
  | 'condition'
  | 'loop'
  | 'merge'
  | 'frame'
  | 'terminal'
  | 'switch';

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  label: string;
  binds: string[];
  irPath: number[];
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  kind: 'exec' | 'data' | 'back' | 'self';
  label?: string;
  data?: Record<string, unknown>;
}
