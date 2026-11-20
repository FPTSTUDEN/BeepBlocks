import { Handle, Position } from '@xyflow/react';
import { branchLabels, nodeLabel, type CanvasNodeRenderProps } from './shared.ts';

export function SwitchNode({ data, id }: CanvasNodeRenderProps) {
  const label = nodeLabel(data, 'switch');
  const branches = branchLabels(data);

  return (
    <div
      className="beep-canvas-node condition-node switch-node"
      role="group"
      aria-label={`Condition: ${label} (${id})`}
    >
      <Handle className="beep-canvas-node__handle" type="target" position={Position.Top} id="in" />
      <Handle
        className="beep-canvas-node__handle"
        type="source"
        position={Position.Left}
        id="false"
      />
      <div className="condition-node__shape" aria-hidden="true" />
      <div className="condition-node__label">{label}</div>
      {branches.map((branch, index) => {
        const top = `${((index + 1) / (branches.length + 1)) * 100}%`;
        return (
          <div className="switch-node__branch" key={`${index}-${branch}`}>
            <Handle
              className="beep-canvas-node__handle"
              type="source"
              position={Position.Right}
              id={`branch-${index}`}
              style={{ top }}
              aria-label={branch}
            />
            <span className="switch-node__branch-label" style={{ top }} aria-hidden="true">
              {branch}
            </span>
          </div>
        );
      })}
    </div>
  );
}
