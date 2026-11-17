import { Handle, Position } from '@xyflow/react';
import { mergeInputCount, type CanvasNodeRenderProps } from './shared.ts';

export function MergeNode({ data, id }: CanvasNodeRenderProps) {
  const inputs = mergeInputCount(data);

  return (
    <div className="beep-canvas-node merge-node" role="group" aria-label={`Merge point (${id})`}>
      {Array.from({ length: inputs }, (_, index) => (
        <Handle
          className="beep-canvas-node__handle"
          key={index}
          type="target"
          position={Position.Left}
          id={`in-${index}`}
          style={{ top: `${((index + 1) / (inputs + 1)) * 100}%` }}
        />
      ))}
      <Handle className="beep-canvas-node__handle" type="source" position={Position.Right} id="out" />
    </div>
  );
}
