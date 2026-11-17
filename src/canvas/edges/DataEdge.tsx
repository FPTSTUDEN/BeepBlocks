import { getBezierPath } from '@xyflow/react';
import type { CanvasEdgeProps } from './edgeUtils.tsx';
import { drawEdge } from './edgeUtils.tsx';

export function DataEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: CanvasEdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return drawEdge({
    id,
    path,
    color: '#2563eb',
    strokeWidth: 1.5,
    style,
    markerEnd,
    className: 'data-edge',
  });
}
