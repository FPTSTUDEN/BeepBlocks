import { Position } from '@xyflow/react';
import type { CanvasEdgeProps, Point } from './edgeUtils.tsx';
import { drawEdge } from './edgeUtils.tsx';

export function ExecEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  style,
  markerEnd,
}: CanvasEdgeProps) {
  const start: Point = { x: sourceX, y: sourceY };
  const end: Point = { x: targetX, y: targetY };
  const path = sourcePosition === Position.Left || sourcePosition === Position.Right
    ? `M${start.x},${start.y} L${(start.x + end.x) / 2},${start.y} L${(start.x + end.x) / 2},${end.y} L${end.x},${end.y}`
    : `M${start.x},${start.y} L${start.x},${(start.y + end.y) / 2} L${end.x},${(start.y + end.y) / 2} L${end.x},${end.y}`;

  return drawEdge({
    id,
    path,
    color: '#6b7280',
    strokeWidth: 1.8,
    style,
    markerEnd,
    className: 'exec-edge',
  });
}
