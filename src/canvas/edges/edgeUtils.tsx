import type { CSSProperties, ReactNode } from 'react';
import type { Edge, EdgeProps } from '@xyflow/react';

export type CanvasEdgeProps = EdgeProps<Edge<Record<string, unknown>>>;

export interface Point {
  x: number;
  y: number;
}

export interface BezierControls {
  controlPoint1: Point;
  controlPoint2: Point;
}

export function getBezierControls(data: unknown): BezierControls | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const bezier = (data as Record<string, unknown>).bezier;
  if (!bezier || typeof bezier !== 'object') return undefined;

  const controls = bezier as Record<string, unknown>;
  const first = controls.controlPoint1;
  const second = controls.controlPoint2;
  if (!isPoint(first) || !isPoint(second)) return undefined;

  return { controlPoint1: first, controlPoint2: second };
}

export function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === 'number' && Number.isFinite(point.x) &&
    typeof point.y === 'number' && Number.isFinite(point.y);
}

export function cubicMidpoint(start: Point, controls: BezierControls, end: Point): Point {
  return {
    x: (start.x + 3 * controls.controlPoint1.x + 3 * controls.controlPoint2.x + end.x) / 8,
    y: (start.y + 3 * controls.controlPoint1.y + 3 * controls.controlPoint2.y + end.y) / 8,
  };
}

export function cubicPath(start: Point, controls: BezierControls, end: Point): string {
  return `M${start.x},${start.y} C${controls.controlPoint1.x},${controls.controlPoint1.y} ${controls.controlPoint2.x},${controls.controlPoint2.y} ${end.x},${end.y}`;
}

function markerId(id: string): string {
  return `canvas-edge-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

interface DrawEdgeOptions {
  id: string;
  path: string;
  color: string;
  strokeWidth: number;
  style?: CSSProperties;
  markerEnd?: string;
  dashed?: boolean;
  label?: ReactNode;
  labelX?: number;
  labelY?: number;
  className: string;
}

export function drawEdge({
  id,
  path,
  color,
  strokeWidth,
  style,
  markerEnd,
  dashed,
  label,
  labelX,
  labelY,
  className,
}: DrawEdgeOptions) {
  const arrowId = markerId(id);
  const pathStyle: CSSProperties = {
    ...style,
    fill: 'none',
    stroke: style?.stroke ?? color,
    strokeWidth: style?.strokeWidth ?? strokeWidth,
    ...(dashed ? { strokeDasharray: style?.strokeDasharray ?? '6 4' } : {}),
  };

  return (
    <g className={`react-flow__edge ${className}`}>
      {!markerEnd && (
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={String(pathStyle.stroke)} />
          </marker>
        </defs>
      )}
      <path
        className="react-flow__edge-interaction"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        pointerEvents="stroke"
      />
      <path
        className="react-flow__edge-path"
        d={path}
        style={pathStyle}
        markerEnd={markerEnd ?? `url(#${arrowId})`}
      />
      {label != null && labelX != null && labelY != null && (
        <text
          className="react-flow__edge-text"
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="central"
          fill={String(pathStyle.stroke)}
          fontSize={12}
        >
          {label}
        </text>
      )}
    </g>
  );
}
