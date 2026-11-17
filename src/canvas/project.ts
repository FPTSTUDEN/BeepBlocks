import type { Expr, Program, Stmt } from '../ir/types.ts';
import type { CanvasEdge, CanvasLayout, CanvasNode, CanvasNodeKind } from './types.ts';

function pathToId(path: Array<string | number>): string {
  return path.map(String).join('.');
}

function isReturnTerminating(stmts: Stmt[]): boolean {
  return stmts.length > 0 && stmts[stmts.length - 1]!.kind === 'return';
}

export function projectProgram(
  program: Program,
  overrides: CanvasLayout = { nodes: {} },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const nodeMap = new Map<string, CanvasNode>();
  const varProducers = new Map<string, string>();

  const addNode = (
    kind: CanvasNodeKind,
    label: string,
    path: Array<string | number>,
    binds: string[] = [],
    data: Record<string, unknown> = {},
    explicitId?: string,
  ): CanvasNode => {
    const id = explicitId ?? `stmt-${pathToId(path)}`;
    const node: CanvasNode = {
      id,
      kind,
      label,
      binds,
      irPath: path.filter((value) => typeof value === 'number'),
      position: overrides.nodes[id] ?? { x: 0, y: 0 },
      data,
    };
    nodes.push(node);
    nodeMap.set(id, node);
    return node;
  };

  const addExecEdge = (
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
    kind: CanvasEdge['kind'] = 'exec',
    label?: string,
    data: Record<string, unknown> = {},
  ): void => {
    edges.push({
      id: `${source}:${sourceHandle}>${target}:${targetHandle}`,
      source,
      sourceHandle,
      target,
      targetHandle,
      kind,
      label,
      data,
    });
  };

  const visitExpr = (expr: Expr, consumerId: string): void => {
    if (expr.kind === 'var') {
      const producerId = varProducers.get(expr.name);
      if (producerId) {
        edges.push({
          id: `data-${producerId}-${consumerId}-${expr.name}`,
          source: producerId,
          sourceHandle: 'value',
          target: consumerId,
          targetHandle: 'value-in',
          kind: 'data',
          label: expr.name,
        });
      }
      return;
    }

    if ('left' in expr && expr.left) visitExpr(expr.left, consumerId);
    if ('right' in expr && expr.right) visitExpr(expr.right, consumerId);
    if ('args' in expr && Array.isArray(expr.args)) for (const arg of expr.args) visitExpr(arg, consumerId);
    if ('items' in expr && Array.isArray(expr.items)) for (const item of expr.items) visitExpr(item, consumerId);
  };

  const projectStatementList = (
    stmts: Stmt[],
    path: Array<string | number>,
  ): { startId: string | null; endId: string | null } => {
    if (stmts.length === 0) return { startId: null, endId: null };

    let previous: { id: string; kind: CanvasNodeKind } | null = null;
    let firstId: string | null = null;
    let lastId: string | null = null;

    for (let index = 0; index < stmts.length; index += 1) {
      const stmt = stmts[index]!;
      const result = visitStmt(stmt, [...path, index]);
      if (!firstId && result.startId) firstId = result.startId;
      if (result.endId) lastId = result.endId;
      if (previous && result.startId) {
        const handle = previous.kind === 'loop' ? 'done' : 'out';
        addExecEdge(previous.id, handle, result.startId, 'in');
      }
      if (result.endId) {
        previous = { id: result.endId, kind: nodeMap.get(result.endId)?.kind ?? 'sequence' };
      }
    }

    return { startId: firstId, endId: lastId };
  };

  const visitStmt = (stmt: Stmt, path: Array<string | number>): { startId: string | null; endId: string | null } => {
    if (stmt.kind === 'assign') {
      const node = addNode('sequence', stmt.name, path, [stmt.name], { writes: stmt.name });
      varProducers.set(stmt.name, node.id);
      visitExpr(stmt.value, node.id);
      return { startId: node.id, endId: node.id };
    }

    if (stmt.kind === 'print') {
      const node = addNode('sequence', 'print', path, [], { prints: true });
      visitExpr(stmt.value, node.id);
      return { startId: node.id, endId: node.id };
    }

    if (stmt.kind === 'return') {
      const node = addNode('terminal', 'return', path, [], { returns: stmt.value ?? null });
      if (stmt.value) visitExpr(stmt.value, node.id);
      return { startId: node.id, endId: node.id };
    }

    if (stmt.kind === 'do') {
      const label = stmt.expr.kind === 'call' ? stmt.expr.fn : 'do';
      const node = addNode('sequence', label, path, [], { value: true });
      if (stmt.expr.kind === 'call') {
        for (const arg of stmt.expr.args) visitExpr(arg, node.id);
      }
      return { startId: node.id, endId: node.id };
    }

    if (stmt.kind === 'if') {
      const conditionId = `stmt-${pathToId(path)}`;
      const conditionNode = addNode('condition', 'if', path, [], { condition: true }, conditionId);
      const thenResult = projectStatementList(stmt.then, [...path, 'then']);
      const elseResult = projectStatementList(stmt.else, [...path, 'else']);

      const trueEnd = thenResult.endId && !isReturnTerminating(stmt.then) ? thenResult.endId : null;
      const falseEnd = elseResult.endId && !isReturnTerminating(stmt.else) ? elseResult.endId : null;
      const mergeId =
        trueEnd || falseEnd || stmt.then.length === 0 || stmt.else.length === 0
          ? `merge-${pathToId(path)}`
          : null;

      if (mergeId) {
        addNode('merge', 'merge', [...path, 'merge'], [], {}, mergeId);
      }

      if (thenResult.startId) addExecEdge(conditionNode.id, 'true', thenResult.startId, 'in');
      if (elseResult.startId) addExecEdge(conditionNode.id, 'false', elseResult.startId, 'in');
      if (mergeId) {
        if (stmt.then.length === 0) {
          addExecEdge(conditionNode.id, 'true', mergeId, 'in-0');
        } else if (trueEnd) {
          addExecEdge(trueEnd, 'out', mergeId, 'in-0');
        }
        if (stmt.else.length === 0) {
          addExecEdge(conditionNode.id, 'false', mergeId, 'in-1');
        } else if (falseEnd) {
          addExecEdge(falseEnd, 'out', mergeId, 'in-1');
        }
      }

      visitExpr(stmt.cond, conditionNode.id);
      return {
        startId: conditionNode.id,
        endId: mergeId ?? (trueEnd ?? falseEnd ?? null),
      };
    }

    if (stmt.kind === 'while' || stmt.kind === 'forEach') {
      const loopNode = addNode(
        'loop',
        stmt.kind === 'forEach' ? 'for each' : 'while',
        path,
        [],
        { loop: true },
        `stmt-${pathToId(path)}`,
      );
      const bodyStartIndex = nodes.length;
      const bodyResult = projectStatementList(stmt.body, [...path, 'body']);
      const bodyNodeIds = nodes.slice(bodyStartIndex).map((node) => node.id);
      loopNode.data.bodyNodeIds = bodyNodeIds;
      loopNode.data.bodyNodeCount = stmt.body.length;

      if (bodyResult.startId) addExecEdge(loopNode.id, 'body', bodyResult.startId, 'in');
      if (bodyResult.endId) addExecEdge(bodyResult.endId, 'out', loopNode.id, 'back-in', 'back');

      visitExpr(stmt.kind === 'while' ? stmt.cond : stmt.list, loopNode.id);
      return { startId: loopNode.id, endId: loopNode.id };
    }

    const fallback = addNode('sequence', stmt.kind, path, [], {});
    return { startId: fallback.id, endId: fallback.id };
  };

  const startNode = addNode('terminal', 'Start', ['program', 'start'], [], {}, 'term-start');
  const endNode = addNode('terminal', 'End', ['program', 'end'], [], {}, 'term-end');
  const topLevel = projectStatementList(program.body, ['program']);

  if (topLevel.startId) addExecEdge(startNode.id, 'out', topLevel.startId, 'in');
  if (topLevel.endId) addExecEdge(topLevel.endId, 'out', endNode.id, 'in');

  for (const fn of program.functions) {
    const frameId = `frame-${fn.name}`;
    const frame = addNode('frame', fn.name, ['function', fn.name], [], { recursive: false }, frameId);
    const body = projectStatementList(fn.body, ['function', fn.name, 'body']);

    if (body.startId) addExecEdge(frame.id, 'in', body.startId, 'in');
    if (body.endId) addExecEdge(body.endId, 'out', frame.id, 'out');

    const recursiveCall = fn.body.find(
      (stmt) => stmt.kind === 'do' && stmt.expr.kind === 'call' && stmt.expr.fn === fn.name,
    );
    if (recursiveCall) {
      frame.data.recursive = true;
      const callId = `stmt-${pathToId(['function', fn.name, 'body', fn.body.indexOf(recursiveCall)])}`;
      addExecEdge(callId, 'out', frameId, 'in', 'self', '↩');
    }
  }

  return { nodes, edges };
}
