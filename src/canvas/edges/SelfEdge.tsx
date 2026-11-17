import type { CanvasEdgeProps, Point } from './edgeUtils.tsx';
import { cubicPath, drawEdge } from './edgeUtils.tsx';

export function SelfEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: CanvasEdgeProps) {
  const start: Point = { x: sourceX, y: sourceY };
  const end: Point = { x: targetX, y: targetY };
  const arcWidth = Math.max(42, Math.abs(targetY - sourceY) * 0.45);
  const rightSide = Math.max(sourceX, targetX) + arcWidth;
  const path = cubicPath(start, {
    controlPoint1: { x: rightSide, y: sourceY + 18 },
    controlPoint2: { x: rightSide, y: targetY - 18 },
  }, end);

  return drawEdge({
    id,
    path,
    color: '#7c3aed',
    strokeWidth: 1.8,
    style,
    markerEnd,
    label: '↩',
    labelX: targetX + 10,
    labelY: targetY - 8,
    className: 'self-edge',
  });
}
