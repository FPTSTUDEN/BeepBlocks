import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { nodeLabel, type CanvasNodeRenderProps } from './shared.ts';

export function LoopNode({ data }: CanvasNodeRenderProps) {
  const [collapsed, setCollapsed] = useState(false);
  const label = nodeLabel(data, 'loop');
  const bodyCount = typeof data.bodyCount === 'number' ? Math.max(0, data.bodyCount) : 0;

  return (
    <div
      className={`beep-canvas-node loop-node${collapsed ? ' loop-node--collapsed' : ''}`}
      role="group"
      aria-label={`Loop: ${label}`}
      aria-expanded={!collapsed}
      onDoubleClick={() => setCollapsed((value) => !value)}
    >
      <Handle className="beep-canvas-node__handle" type="target" position={Position.Top} id="in" />
      <Handle className="beep-canvas-node__handle" type="source" position={Position.Right} id="body" />
      <Handle className="beep-canvas-node__handle" type="source" position={Position.Bottom} id="done" />
      <Handle
        className="beep-canvas-node__handle"
        type="target"
        position={Position.Top}
        id="back-in"
        style={{ left: '22%' }}
      />
      <div className="loop-node__title">
        <span className="loop-node__icon" aria-hidden="true">⟳</span>
        <span>{label}</span>
      </div>
      {collapsed && <div className="loop-node__collapsed">⟳ {bodyCount} steps inside</div>}
    </div>
  );
}
