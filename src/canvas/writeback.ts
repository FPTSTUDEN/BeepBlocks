import type { Program, Stmt } from '../ir/types.ts';

export interface StatementLocation {
  statements: Stmt[];
  index: number;
}

export type CanvasWritebackAction =
  | { type: 'remove'; path: Array<string | number> }
  | { type: 'insert-before'; targetPath: Array<string | number> | null; statement: Stmt }
  | { type: 'move-after'; sourcePath: Array<string | number>; targetPath: Array<string | number> };

export function findStatementLocation(program: Program, path: Array<string | number>): StatementLocation | null {
  let statements: Stmt[];
  let cursor: number;

  if (path[0] === 'program') {
    statements = program.body;
    cursor = 1;
  } else if (path[0] === 'function' && typeof path[1] === 'string' && path[2] === 'body') {
    const fn = program.functions.find((candidate) => candidate.name === path[1]);
    if (!fn) return null;
    statements = fn.body;
    cursor = 3;
  } else {
    return null;
  }

  while (cursor < path.length) {
    const index = path[cursor];
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= statements.length) {
      return null;
    }
    if (cursor === path.length - 1) return { statements, index };

    const statement = statements[index]!;
    const branch = path[cursor + 1];
    if (statement.kind === 'if' && branch === 'then') statements = statement.then;
    else if (statement.kind === 'if' && branch === 'else') statements = statement.else;
    else if ((statement.kind === 'while' || statement.kind === 'forEach') && branch === 'body') {
      statements = statement.body;
    } else return null;
    cursor += 2;
  }

  return null;
}

export function removeStatement(program: Program, path: Array<string | number>): Program | null {
  const next = structuredClone(program);
  const location = findStatementLocation(next, path);
  if (!location) return null;
  location.statements.splice(location.index, 1);
  return next;
}

export function insertStatementBefore(
  program: Program,
  targetPath: Array<string | number> | null,
  statement: Stmt,
): Program | null {
  const next = structuredClone(program);
  if (!targetPath) {
    next.body.push(structuredClone(statement));
    return next;
  }
  const location = findStatementLocation(next, targetPath);
  if (!location) return null;
  location.statements.splice(location.index, 0, structuredClone(statement));
  return next;
}

export function canReorderStatements(
  program: Program,
  sourcePath: Array<string | number> | undefined,
  targetPath: Array<string | number> | undefined,
): boolean {
  if (!sourcePath || !targetPath || sourcePath.length !== targetPath.length || sourcePath.length === 0) {
    return false;
  }
  if (sourcePath.at(-1) === targetPath.at(-1)) return false;
  if (sourcePath.slice(0, -1).some((segment, index) => segment !== targetPath[index])) return false;
  return Boolean(findStatementLocation(program, sourcePath) && findStatementLocation(program, targetPath));
}

export function moveStatementAfter(
  program: Program,
  sourcePath: Array<string | number>,
  targetPath: Array<string | number>,
): Program | null {
  if (!canReorderStatements(program, sourcePath, targetPath)) return null;
  const next = structuredClone(program);
  const sourceLocation = findStatementLocation(next, sourcePath)!;
  const targetLocation = findStatementLocation(next, targetPath)!;
  const statements = sourceLocation.statements;
  if (statements !== targetLocation.statements) return null;

  const source = statements[sourceLocation.index]!;
  const target = statements[targetLocation.index]!;
  statements.splice(targetLocation.index, 1);
  const sourceIndex = statements.indexOf(source);
  statements.splice(sourceIndex + 1, 0, target);
  return next;
}

export function writeback(program: Program, action: CanvasWritebackAction): Program | null {
  switch (action.type) {
    case 'remove':
      return removeStatement(program, action.path);
    case 'insert-before':
      return insertStatementBefore(program, action.targetPath, action.statement);
    case 'move-after':
      return moveStatementAfter(program, action.sourcePath, action.targetPath);
  }
}
