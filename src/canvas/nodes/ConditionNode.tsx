import { Handle, Position } from '@xyflow/react';
import { nodeLabel, type CanvasNodeRenderProps } from './shared.ts';

export function ConditionNode({ data }: CanvasNodeRenderProps) {
  const label = nodeLabel(data, 'condition');

  return (
    <div className="beep-canvas-node condition-node" role="group" aria-label={`Condition: ${label}`}>
      <Handle className="beep-canvas-node__handle" type="target" position={Position.Top} id="in" />
      <Handle className="beep-canvas-node__handle" type="source" position={Position.Right} id="true" />
      <Handle className="beep-canvas-node__handle" type="source" position={Position.Left} id="false" />
      <div className="condition-node__shape" aria-hidden="true" />
      <div className="condition-node__label">{label}</div>
    </div>
  );
}
