import { Handle, Position } from '@xyflow/react';
import { categoryClass, nodeLabel, type CanvasNodeRenderProps } from './shared.ts';

export function SequenceNode({ data, id }: CanvasNodeRenderProps) {
  const label = nodeLabel(data, 'Action');
  const binds = Array.isArray(data.binds) ? data.binds : [];

  return (
    <div
      className={`beep-canvas-node sequence-node ${categoryClass(data)}`}
      role="group"
      aria-label={`${label} (${id})`}
    >
      <Handle className="beep-canvas-node__handle" type="target" position={Position.Top} id="in" />
      <div className="sequence-node__label">{label}</div>
      {binds.length > 0 && <div className="sequence-node__binds">{binds.join(', ')}</div>}
      <Handle
        className="beep-canvas-node__handle"
        type="source"
        position={Position.Bottom}
        id="out"
      />
    </div>
  );
}
