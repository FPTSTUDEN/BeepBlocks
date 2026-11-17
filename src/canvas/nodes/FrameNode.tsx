import { Handle, Position } from '@xyflow/react';
import { nodeLabel, type CanvasNodeRenderProps } from './shared.ts';

export const FRAME_NODE_TYPE = 'group';

export function FrameNode({ data, id }: CanvasNodeRenderProps) {
  const label = nodeLabel(data, 'Function');

  return (
    <div className="beep-canvas-node frame-node" role="group" aria-label={`Function: ${label} (${id})`}>
      <Handle className="beep-canvas-node__handle" type="target" position={Position.Top} id="in" />
      <Handle className="beep-canvas-node__handle" type="source" position={Position.Bottom} id="out" />
      <div className="frame-node__title">
        <span>{label}</span>
        {data.recursive === true && <span className="frame-node__recursive">(calls itself)</span>}
      </div>
    </div>
  );
}
