import * as Blockly from 'blockly/core';
import type { Expr, If, Program, Stmt } from '../../ir/types.ts';
import { B } from './blockTypes.ts';

function switchVariable(condition: Expr): string | null {
  if (condition.kind !== 'binary' || condition.op !== '==') return null;
  if (condition.left.kind === 'var' && condition.right.kind === 'lit') return condition.left.name;
  if (condition.right.kind === 'var' && condition.left.kind === 'lit') return condition.right.name;
  return null;
}

function switchChainVariable(statement: Stmt): string | null {
  if (statement.kind !== 'if') return null;
  let current = statement;
  let variable: string | undefined;
  let comparisons = 0;

  while (true) {
    const candidate = switchVariable(current.cond);
    if (!candidate || (variable !== undefined && variable !== candidate)) return null;
    variable = candidate;
    comparisons += 1;

    const nested = current.else.length === 1 ? current.else[0] : undefined;
    if (nested?.kind === 'if') {
      current = nested;
      continue;
    }
    return comparisons >= 2 && current.else.length > 0 ? variable : null;
  }
}

export function isSwitchChain(statement: Stmt): statement is If {
  return switchChainVariable(statement) !== null;
}

export function updateSwitchAnnotations(workspace: Blockly.Workspace, program: Program): void {
  const switchLabels = new Map<string, string>();
  const visit = (statement: Stmt) => {
    if (statement.kind === 'if') {
      const variable = switchChainVariable(statement);
      if (variable) switchLabels.set(statement.id, `Switch on: ${variable}`);
      statement.then.forEach(visit);
      statement.else.forEach(visit);
    } else if (statement.kind === 'while' || statement.kind === 'forEach') {
      statement.body.forEach(visit);
    } else if (statement.kind === 'composite') {
      Object.values(statement.bodies).flat().forEach(visit);
    }
  };

  program.body.forEach(visit);
  program.functions.forEach((fn) => fn.body.forEach(visit));

  for (const block of workspace.getAllBlocks(false)) {
    if (block.type !== B.if) continue;
    const field = block.getField('SWITCH_BADGE');
    if (field) field.setValue(switchLabels.get(block.id) ?? '');
  }
}
