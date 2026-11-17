import { getBezierPath } from '@xyflow/react';
import type { CanvasEdgeProps, Point } from './edgeUtils.tsx';
import { cubicMidpoint, cubicPath, drawEdge, getBezierControls } from './edgeUtils.tsx';

export function BackEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  style,
  markerEnd,
}: CanvasEdgeProps) {
  const start: Point = { x: sourceX, y: sourceY };
  const end: Point = { x: targetX, y: targetY };
  const controls = getBezierControls(data);
  let path: string;
  let labelPoint: Point;

  if (controls) {
    path = cubicPath(start, controls, end);
    labelPoint = cubicMidpoint(start, controls, end);
  } else {
    const [fallbackPath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    path = fallbackPath;
    labelPoint = { x: labelX, y: labelY };
  }

  const edgeLabel = label ?? (typeof data?.label === 'string' ? data.label : 'again');
  return drawEdge({
    id,
    path,
    color: '#c2410c',
    strokeWidth: 1.8,
    style,
    markerEnd,
    dashed: true,
    label: edgeLabel,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    className: 'back-edge',
  });
}
