import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useKeyPress,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Program, Stmt } from '../ir/types.ts';
import { BackEdge, DataEdge, ExecEdge, SelfEdge } from './edges/index.ts';
import { autoLayout, routeBackEdges } from './layout.ts';
import {
  ConditionNode,
  FrameNode,
  FRAME_NODE_TYPE,
  LoopNode,
  MergeNode,
  SequenceNode,
  SwitchNode,
  TerminalNode,
} from './nodes/index.ts';
import { projectProgram } from './project.ts';
import type { CanvasEdge, CanvasNode } from './types.ts';
import { CanvasToolbar } from './CanvasToolbar.tsx';
import '@xyflow/react/dist/style.css';
import './nodes/base.css';

export interface CanvasEditorProps {
  program: Program;
  dispatch?: (...args: unknown[]) => void;
  ariaLabel?: string;
}

const nodeTypes: NodeTypes = {
  sequence: SequenceNode,
  condition: ConditionNode,
  loop: LoopNode,
  merge: MergeNode,
  [FRAME_NODE_TYPE]: FrameNode,
  terminal: TerminalNode,
  switch: SwitchNode,
};

const edgeTypes = {
  exec: ExecEdge,
  data: DataEdge,
  back: BackEdge,
  self: SelfEdge,
};

function loopBodyCounts(program: Program): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (statements: Stmt[], path: Array<string | number>) => {
    statements.forEach((statement, index) => {
      const statementPath = [...path, index];
      if (statement.kind === 'while' || statement.kind === 'forEach') {
        counts.set(`stmt-${statementPath.join('.')}`, statement.body.length);
        visit(statement.body, [...statementPath, 'body']);
      } else if (statement.kind === 'if') {
        visit(statement.then, [...statementPath, 'then']);
        visit(statement.else, [...statementPath, 'else']);
      }
    });
  };

  visit(program.body, ['program']);
  for (const fn of program.functions) visit(fn.body, ['function', fn.name, 'body']);
  return counts;
}

function convertNode(node: CanvasNode, bodyCount: number | undefined): Node {
  const projectedBodyCount = node.data.bodyNodeCount ?? node.data.bodyCount;
  const data = {
    ...node.data,
    label: node.label,
    binds: node.binds,
    ...(node.kind === 'loop'
      ? { bodyCount: typeof projectedBodyCount === 'number' ? projectedBodyCount : bodyCount ?? 0 }
      : {}),
  };
  return {
    id: node.id,
    type: node.kind === 'frame' ? FRAME_NODE_TYPE : node.kind,
    position: node.position,
    data,
    draggable: false,
    selectable: false,
  };
}

function convertEdge(edge: CanvasEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    type: edge.kind,
    label: edge.label,
    data: edge.data,
    selectable: false,
  };
}

function bodyNodeIds(loop: CanvasNode, nodes: CanvasNode[]): Set<string> {
  const listed = loop.data.bodyNodeIds;
  const baseIds = Array.isArray(listed)
    ? listed.filter((id): id is string => typeof id === 'string')
    : [];
  const statementPrefix = `${loop.id}.body.`;
  const mergePrefix = `merge-${loop.id.slice('stmt-'.length)}.body.`;

  return new Set(
    nodes
      .filter((node) =>
        baseIds.some((id) =>
          node.id === id ||
          node.id.startsWith(`${id}.`) ||
          node.id === `merge-${id.slice('stmt-'.length)}` ||
          node.id.startsWith(`merge-${id.slice('stmt-'.length)}.`),
        ) ||
        node.id.startsWith(statementPrefix) ||
        node.id.startsWith(mergePrefix),
      )
      .map((node) => node.id),
  );
}

function CanvasKeyboardShortcuts({
  target,
  onFit,
  onZoomReset,
}: {
  target: HTMLDivElement;
  onFit: () => void;
  onZoomReset: () => void;
}) {
  const fitShortcutPressed = useKeyPress('f', { target });
  const zoomResetShortcutPressed = useKeyPress('0', { target });

  useEffect(() => {
    if (fitShortcutPressed) onFit();
  }, [fitShortcutPressed, onFit]);

  useEffect(() => {
    if (zoomResetShortcutPressed) onZoomReset();
  }, [onZoomReset, zoomResetShortcutPressed]);

  return null;
}

function CanvasEditorCanvas({ program, ariaLabel }: Pick<CanvasEditorProps, 'program' | 'ariaLabel'>) {
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const reactFlow = useReactFlow();
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [dataFlowVisible, setDataFlowVisible] = useState(true);
  const [collapsedLoops, setCollapsedLoops] = useState<Set<string>>(() => new Set());
  const [manualLayout, setManualLayout] = useState<{
    projection: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    nodes: CanvasNode[];
  } | null>(null);

  const projection = useMemo(() => projectProgram(program), [program]);
  const bodyCounts = useMemo(() => loopBodyCounts(program), [program]);
  const autoLaidOutNodes = useMemo(() => autoLayout(projection.nodes, projection.edges), [projection]);
  const layoutNodes = manualLayout?.projection === projection ? manualLayout.nodes : autoLaidOutNodes;
  const renderedNodes = useMemo(() => {
    const collapsedBodyIds = new Set<string>();
    for (const loop of layoutNodes) {
      if (loop.kind === 'loop' && collapsedLoops.has(loop.id)) {
        for (const id of bodyNodeIds(loop, layoutNodes)) collapsedBodyIds.add(id);
      }
    }

    return layoutNodes
      .filter((node) => !collapsedBodyIds.has(node.id))
      .map((node) => convertNode(node, bodyCounts.get(node.id)));
  }, [bodyCounts, collapsedLoops, layoutNodes]);
  const renderedEdges = useMemo(() => {
    const visibleIds = new Set(renderedNodes.map((node) => node.id));
    const visibleEdges = projection.edges.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    );
    return routeBackEdges(
      layoutNodes.filter((node) => visibleIds.has(node.id)),
      visibleEdges,
    ).map(convertEdge);
  }, [layoutNodes, projection.edges, renderedNodes]);

  const relayout = useCallback(() => {
    setManualLayout({
      projection,
      nodes: autoLayout(projection.nodes, projection.edges),
    });
  }, [projection]);
  const fit = useCallback(() => void reactFlow.fitView({ padding: 0.2 }), [reactFlow]);
  const zoomReset = useCallback(() => void reactFlow.zoomTo(1), [reactFlow]);
  const zoomIn = useCallback(() => void reactFlow.zoomIn(), [reactFlow]);
  const zoomOut = useCallback(() => void reactFlow.zoomOut(), [reactFlow]);

  const handleDoubleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest('.loop-node')) return;
    const id = event.target.closest('.react-flow__node')?.getAttribute('data-id');
    if (!id) return;
    window.setTimeout(() => {
      setCollapsedLoops((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, 0);
  };

  return (
    <div
      ref={setRootElement}
      role="application"
      aria-label={ariaLabel}
      data-testid="bp-canvas-editor"
      tabIndex={0}
      className={`beep-canvas-root${dataFlowVisible ? '' : ' hide-data-edges'}`}
      onDoubleClickCapture={handleDoubleClickCapture}
      style={{ width: '100%', height: '100%', minHeight: '18rem', border: '1px solid var(--bp-border)', borderRadius: 8 }}
    >
      <style>{'.hide-data-edges .data-edge { display: none; }'}</style>
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        {rootElement && <CanvasKeyboardShortcuts target={rootElement} onFit={fit} onZoomReset={zoomReset} />}
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Panel position="top-left">
          <CanvasToolbar
            onReLayout={relayout}
            onFit={fit}
            onZoomReset={zoomReset}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            showMinimap={minimapVisible}
            showDataFlow={dataFlowVisible}
            onToggleMinimap={() => setMinimapVisible((visible) => !visible)}
            onToggleDataFlow={() => setDataFlowVisible((visible) => !visible)}
          />
        </Panel>
        {minimapVisible && <MiniMap />}
      </ReactFlow>
    </div>
  );
}

export function CanvasEditor({ program, ariaLabel = 'Flow canvas' }: CanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <CanvasEditorCanvas program={program} ariaLabel={ariaLabel} />
    </ReactFlowProvider>
  );
}
