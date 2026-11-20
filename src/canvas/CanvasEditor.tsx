import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useKeyPress,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { b } from '../ir/build.ts';
import type { Program, Stmt } from '../ir/types.ts';
import { BackEdge, DataEdge, ExecEdge, SelfEdge } from './edges/index.ts';
import { autoLayout, nodeSize, routeBackEdges } from './layout.ts';
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
import type { CanvasEdge, CanvasLayout, CanvasNode } from './types.ts';
import { CanvasToolbar } from './CanvasToolbar.tsx';
import { CANVAS_STMT_MIME, CanvasPalette } from './CanvasPalette.tsx';
import { canReorderStatements, writeback } from './writeback.ts';
import '@xyflow/react/dist/style.css';
import './nodes/base.css';

export interface CanvasEditorProps {
  program: Program;
  dispatch?: (program: Program) => void;
  canvasLayout?: CanvasLayout;
  onCanvasLayoutChange?: (layout: CanvasLayout) => void;
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

function convertNode(node: CanvasNode, bodyCount: number | undefined, editable: boolean): Node {
  const size = nodeSize(node);
  const projectedBodyCount = node.data.bodyNodeCount ?? node.data.bodyCount;
  const data = {
    ...node.data,
    label: node.label,
    binds: node.binds,
    irPath: node.irPath,
    ...(node.kind === 'loop'
      ? { bodyCount: typeof projectedBodyCount === 'number' ? projectedBodyCount : bodyCount ?? 0 }
      : {}),
  };
  return {
    id: node.id,
    type: node.kind === 'frame' ? FRAME_NODE_TYPE : node.kind,
    position: node.position,
    ...size,
    // Seed dimensions so React Flow can lay out handles and compute drag positions immediately.
    measured: size,
    data,
    draggable: editable && node.kind !== 'terminal' && node.kind !== 'merge',
    selectable: editable && node.kind !== 'terminal' && node.kind !== 'merge' && node.kind !== 'frame',
    connectable: editable && node.kind !== 'terminal' && node.kind !== 'merge' && node.kind !== 'frame',
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
    selectable: edge.kind === 'exec',
    reconnectable: edge.kind === 'exec',
  };
}

function pointSegmentDistance(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + projection * dx), point.y - (a.y + projection * dy));
}

function statementForPaletteItem(id: string): Stmt | null {
  if (id === 'move-file') return b.do(b.op('fs.move', [b.root(), b.root()]));
  return null;
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

function CanvasEditorCanvas({
  program,
  dispatch,
  canvasLayout = { nodes: {} },
  onCanvasLayoutChange,
  ariaLabel,
}: CanvasEditorProps) {
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const reactFlow = useReactFlow();
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [dataFlowVisible, setDataFlowVisible] = useState(true);
  const [collapsedLoops, setCollapsedLoops] = useState<Set<string>>(() => new Set());
  const [editHistory, setEditHistory] = useState<{ past: Program[]; future: Program[] }>({ past: [], future: [] });
  const [editError, setEditError] = useState('');
  const [flowNodeState, setFlowNodeState] = useState<{ source: Node[]; nodes: Node[] } | null>(null);
  const [flowEdgeState, setFlowEdgeState] = useState<{ source: Edge[]; edges: Edge[] } | null>(null);
  const [manualLayout, setManualLayout] = useState<{
    projection: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    nodes: CanvasNode[];
  } | null>(null);

  const projection = useMemo(() => projectProgram(program, canvasLayout), [canvasLayout, program]);
  const bodyCounts = useMemo(() => loopBodyCounts(program), [program]);
  const autoLaidOutNodes = useMemo(
    () => autoLayout(projection.nodes, projection.edges, canvasLayout),
    [canvasLayout, projection],
  );
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
      .map((node) => convertNode(node, bodyCounts.get(node.id), Boolean(dispatch)));
  }, [bodyCounts, collapsedLoops, dispatch, layoutNodes]);
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

  const flowNodes = flowNodeState?.source === renderedNodes ? flowNodeState.nodes : renderedNodes;
  const flowEdges = flowEdgeState?.source === renderedEdges ? flowEdgeState.edges : renderedEdges;

  const relayout = useCallback(() => {
    setManualLayout({
      projection,
      nodes: autoLayout(projection.nodes, projection.edges, { nodes: {} }),
    });
    onCanvasLayoutChange?.({ nodes: {} });
  }, [onCanvasLayoutChange, projection]);
  const fit = useCallback(() => void reactFlow.fitView({ padding: 0.2 }), [reactFlow]);
  const zoomReset = useCallback(() => void reactFlow.zoomTo(1), [reactFlow]);
  const zoomIn = useCallback(() => void reactFlow.zoomIn(), [reactFlow]);
  const zoomOut = useCallback(() => void reactFlow.zoomOut(), [reactFlow]);

  const commitProgram = useCallback((next: Program) => {
    if (!dispatch || JSON.stringify(next) === JSON.stringify(program)) return;
    setEditHistory((history) => ({ past: [...history.past, structuredClone(program)], future: [] }));
    dispatch(next);
    setEditError('');
  }, [dispatch, program]);

  const undo = useCallback(() => {
    const previous = editHistory.past.at(-1);
    if (!previous || !dispatch) return;
    setEditHistory({ past: editHistory.past.slice(0, -1), future: [structuredClone(program), ...editHistory.future] });
    dispatch(previous);
    setEditError('');
  }, [dispatch, editHistory, program]);

  const redo = useCallback(() => {
    const next = editHistory.future[0];
    if (!next || !dispatch) return;
    setEditHistory({ past: [...editHistory.past, structuredClone(program)], future: editHistory.future.slice(1) });
    dispatch(next);
    setEditError('');
  }, [dispatch, editHistory, program]);

  const nodePath = useCallback((id: string | null | undefined) =>
    projection.nodes.find((node) => node.id === id)?.irPath, [projection.nodes]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setFlowNodeState((current) => {
      const nodes = current?.source === renderedNodes ? current.nodes : renderedNodes;
      return { source: renderedNodes, nodes: applyNodeChanges(changes, nodes) };
    });
  }, [renderedNodes]);
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdgeState((current) => {
      const edges = current?.source === renderedEdges ? current.edges : renderedEdges;
      return { source: renderedEdges, edges: applyEdgeChanges(changes, edges) };
    });
  }, [renderedEdges]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!['out', 'done'].includes(connection.sourceHandle ?? '') || connection.targetHandle !== 'in') return false;
    return canReorderStatements(program, nodePath(connection.source), nodePath(connection.target));
  }, [nodePath, program]);

  const handleConnection = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) {
      setEditError('Statements can only be reconnected within the same sequence.');
      return;
    }
    const sourcePath = nodePath(connection.source);
    const targetPath = nodePath(connection.target);
    if (!sourcePath || !targetPath) return;
    const next = writeback(program, { type: 'move-after', sourcePath, targetPath });
    if (next) commitProgram(next);
  }, [commitProgram, isValidConnection, nodePath, program]);

  const handleNodesDelete = useCallback((deletedNodes: Node[]) => {
    const paths = deletedNodes
      .map((node) => nodePath(node.id))
      .filter((path): path is Array<string | number> => path !== undefined)
      .sort((a, b) => b.length - a.length || Number(b.at(-1)) - Number(a.at(-1)));
    let next = program;
    for (const path of paths) {
      const candidate = writeback(next, { type: 'remove', path });
      if (candidate) next = candidate;
    }
    commitProgram(next);
  }, [commitProgram, nodePath, program]);

  const handleDeleteKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (!(event.target instanceof HTMLElement)) return;
    const nodeId = event.target.closest('.react-flow__node')?.getAttribute('data-id');
    const path = nodePath(nodeId);
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    const next = writeback(program, { type: 'remove', path });
    if (next) commitProgram(next);
  }, [commitProgram, nodePath, program]);

  const handleNodeDragStop = useCallback((_event: unknown, node: Node) => {
    if (!onCanvasLayoutChange) return;
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      setEditError('The canvas could not save this node position.');
      return;
    }
    onCanvasLayoutChange({
      nodes: {
        ...canvasLayout.nodes,
        [node.id]: { x: node.position.x, y: node.position.y },
      },
    });
  }, [canvasLayout.nodes, onCanvasLayoutChange]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(CANVAS_STMT_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dispatch) return;
    const paletteId = event.dataTransfer.getData(CANVAS_STMT_MIME);
    if (!paletteId) return;
    event.preventDefault();
    const statement = statementForPaletteItem(paletteId);
    if (!statement) {
      setEditError(`Unknown palette statement: ${paletteId}`);
      return;
    }
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const nearest = projection.edges
      .filter((edge) => edge.kind === 'exec')
      .map((edge) => {
        const source = reactFlow.getNode(edge.source);
        const target = reactFlow.getNode(edge.target);
        if (!source || !target) return { edge, distance: Number.POSITIVE_INFINITY };
        const center = (node: typeof source) => ({
          x: node.position.x + (node.measured?.width ?? 120) / 2,
          y: node.position.y + (node.measured?.height ?? 50) / 2,
        });
        return { edge, distance: pointSegmentDistance(point, center(source), center(target)) };
      })
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || !Number.isFinite(nearest.distance)) {
      setEditError('Drop the statement on an execution edge.');
      return;
    }
    const targetPath = nodePath(nearest.edge.target);
    const sourcePath = nodePath(nearest.edge.source);
    const insertPath = targetPath ?? (sourcePath ? [...sourcePath.slice(0, -1), Number(sourcePath.at(-1)) + 1] : null);
    const next = writeback(program, { type: 'insert-before', targetPath: insertPath, statement });
    if (!next) {
      setEditError('This edge is not inside an editable statement sequence.');
      return;
    }
    commitProgram(next);
  }, [commitProgram, dispatch, nodePath, program, projection.edges, reactFlow]);

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
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDownCapture={handleDeleteKey}
      style={{ width: '100%', height: '100%', minHeight: '18rem', border: '1px solid var(--bp-border)', borderRadius: 8 }}
    >
      <style>{'.hide-data-edges .data-edge { display: none; }'}</style>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={Boolean(dispatch)}
        nodesConnectable={Boolean(dispatch)}
        elementsSelectable={Boolean(dispatch)}
        edgesReconnectable={Boolean(dispatch)}
        deleteKeyCode={dispatch ? ['Backspace', 'Delete'] : null}
        isValidConnection={isValidConnection}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodesDelete={handleNodesDelete}
        onConnect={handleConnection}
        onConnectEnd={(_event, state) => {
          if (!state.isValid) setEditError('Invalid connection: connect statements within the same sequence.');
        }}
        onReconnect={(_edge: Edge, connection: Connection) => handleConnection(connection)}
        onNodeDragStop={handleNodeDragStop}
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
            onUndo={undo}
            onRedo={redo}
            canUndo={editHistory.past.length > 0}
            canRedo={editHistory.future.length > 0}
          />
        </Panel>
        <Panel position="top-right">
          <CanvasPalette disabled={!dispatch} />
        </Panel>
        {editError && <Panel position="bottom-left"><div role="status">{editError}</div></Panel>}
        {minimapVisible && <MiniMap />}
      </ReactFlow>
    </div>
  );
}

export function CanvasEditor(props: CanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <CanvasEditorCanvas {...props} ariaLabel={props.ariaLabel ?? 'Flow canvas'} />
    </ReactFlowProvider>
  );
}
