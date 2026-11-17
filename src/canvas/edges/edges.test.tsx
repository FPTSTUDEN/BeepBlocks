import { renderToStaticMarkup } from 'react-dom/server';
import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { CanvasEdgeProps } from './edgeUtils.tsx';
import { BackEdge } from './BackEdge.tsx';
import { DataEdge } from './DataEdge.tsx';
import { ExecEdge } from './ExecEdge.tsx';
import { SelfEdge } from './SelfEdge.tsx';

function edgeProps(overrides: Partial<CanvasEdgeProps> = {}): CanvasEdgeProps {
  return {
    id: 'edge-1',
    source: 'source',
    target: 'target',
    sourceX: 20,
    sourceY: 30,
    targetX: 180,
    targetY: 150,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {},
    ...overrides,
  };
}

describe('canvas custom edges', () => {
  it('renders orthogonal execution edges with a grey arrowhead', () => {
    const markup = renderToStaticMarkup(<ExecEdge {...edgeProps()} />);

    expect(markup).toContain('class="react-flow__edge exec-edge"');
    expect(markup).toContain('d="M20,30 L20,90 L180,90 L180,150"');
    expect(markup).toContain('stroke:#6b7280');
    expect(markup).toContain('marker-end="url(#canvas-edge-arrow-edge-1)"');
  });

  it('renders data edges as thin blue curves', () => {
    const markup = renderToStaticMarkup(<DataEdge {...edgeProps()} />);

    expect(markup).toContain('class="react-flow__edge data-edge"');
    expect(markup).toMatch(/d="M20,30 C[^"]+"/);
    expect(markup).toContain('stroke:#2563eb');
    expect(markup).toContain('stroke-width:1.5');
  });

  it('uses absolute precomputed back-edge controls and labels the midpoint', () => {
    const markup = renderToStaticMarkup(
      <BackEdge
        {...edgeProps({
          data: {
            bezier: {
              controlPoint1: { x: -40, y: 30 },
              controlPoint2: { x: -40, y: 150 },
            },
          },
        })}
      />,
    );

    expect(markup).toContain('d="M20,30 C-40,30 -40,150 180,150"');
    expect(markup).toContain('stroke-dasharray:6 4');
    expect(markup).toContain('>again</text>');
    expect(markup).toContain('x="-5" y="90"');
  });

  it('falls back to a computed curve when back-edge controls are missing or invalid', () => {
    const missing = renderToStaticMarkup(<BackEdge {...edgeProps({ data: undefined })} />);
    const invalid = renderToStaticMarkup(
      <BackEdge {...edgeProps({ data: { bezier: { controlPoint1: { x: NaN, y: 0 } } } })} />,
    );

    expect(missing).toMatch(/d="M20,30 C[^"]+"/);
    expect(invalid).toMatch(/d="M20,30 C[^"]+"/);
    expect(missing).not.toContain('NaN');
  });

  it('renders a recursion loop with the return-arrow icon by the arrowhead', () => {
    const markup = renderToStaticMarkup(<SelfEdge {...edgeProps()} />);

    expect(markup).toContain('class="react-flow__edge self-edge"');
    expect(markup).toMatch(/d="M20,30 C[^"]+ 180,150"/);
    expect(markup).toContain('>↩</text>');
    expect(markup).toContain('stroke:#7c3aed');
  });
});
