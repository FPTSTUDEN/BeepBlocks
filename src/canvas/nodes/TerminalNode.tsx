import { Handle, Position } from '@xyflow/react';
import { nodeLabel, type CanvasNodeRenderProps } from './shared.ts';

export function TerminalNode({ data }: CanvasNodeRenderProps) {
  const label = nodeLabel(data, 'End');

  return (
    <div className="beep-canvas-node terminal-node" role="group" aria-label={label}>
      <Handle className="beep-canvas-node__handle" type="target" position={Position.Top} id="in" />
      {label.toLowerCase() !== 'end' && (
        <Handle className="beep-canvas-node__handle" type="source" position={Position.Bottom} id="out" />
      )}
      {label}
    </div>
  );
}
