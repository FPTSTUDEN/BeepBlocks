/**
 * Live validation (design.md §9, Req 3.3/3.4): debounced regeneration of the IR, validation,
 * and per-block warning icons with plain-language messages.
 */
import * as Blockly from 'blockly/core';
import type { NodeId, Program } from '../ir/types.ts';
import type { ValidationError } from '../ir/errors.ts';
import { resolveToExisting } from '../ir/ids.ts';
import { validateProgram } from '../ir/validate.ts';
import type { Layout } from './layout.ts';
import { RUN_BLOCK_ID } from './blocks/common.ts';
import { wsToIr, type WsToIrResult } from './convert/wsToIr.ts';

export const VALIDATION_DELAY_MS = 300;
const WARNING_ID = 'bp-validation';

/**
 * Combines editor issues (empty sockets, detached stacks) with `validateProgram`. The
 * validator's generic STRUCTURE errors for empty sockets are replaced by the editor's
 * friendlier MISSING_INPUT messages on the same block.
 */
export function collectIssues(conv: WsToIrResult): ValidationError[] {
  const holeParents = new Set(conv.issues.map((i) => i.nodeId));
  const validated = validateProgram(conv.program).filter(
    (i) => !(i.code === 'STRUCTURE' && holeParents.has(i.nodeId)),
  );
  const detached: ValidationError[] = conv.warnings.map((w) => ({
    nodeId: w.blockId,
    code: 'STRUCTURE',
    message: w.message,
    severity: 'warning',
  }));
  return [...conv.issues, ...validated, ...detached];
}

/**
 * Maps issues to the blocks that should show them. Derived ids (`abc/loop`) resolve to the
 * nearest existing block; issues for the whole program (nodeId '') go to "when run".
 */
export function issuesByBlock(
  issues: readonly ValidationError[],
  ws: Blockly.Workspace,
  aliases: ReadonlyMap<NodeId, string>,
): Map<string, ValidationError[]> {
  const exists = (id: NodeId) => ws.getBlockById(id) !== null || aliases.has(id);
  const out = new Map<string, ValidationError[]>();
  for (const issue of issues) {
    let target: string | null = RUN_BLOCK_ID;
    if (issue.nodeId !== '') {
      const resolved = resolveToExisting(issue.nodeId, exists);
      target = resolved === null ? RUN_BLOCK_ID : (aliases.get(resolved) ?? resolved);
    }
    if (!ws.getBlockById(target)) continue;
    const list = out.get(target) ?? [];
    list.push(issue);
    out.set(target, list);
  }
  return out;
}

export function warningText(issues: readonly ValidationError[]): string {
  return issues
    .map((i) => (i.severity === 'warning' ? `Note: ${i.message}` : i.message))
    .join('\n');
}

/** Sets warning icons on exactly the blocks in `byBlock`; clears all others. */
export function applyWarnings(
  ws: Blockly.Workspace,
  byBlock: ReadonlyMap<string, ValidationError[]>,
) {
  const wasEnabled = Blockly.Events.isEnabled();
  if (wasEnabled) Blockly.Events.disable();
  try {
    for (const block of ws.getAllBlocks(false)) {
      const issues = byBlock.get(block.id);
      block.setWarningText(issues ? warningText(issues) : null, WARNING_ID);
    }
  } finally {
    if (wasEnabled) Blockly.Events.enable();
  }
}

export interface ValidationResult {
  program: Program;
  layout: Layout;
  issues: ValidationError[];
  conversion: WsToIrResult;
  byBlock: Map<string, ValidationError[]>;
}

/** Regenerates the IR, validates it and applies warnings immediately. */
export function validateWorkspace(ws: Blockly.Workspace): ValidationResult {
  const conversion = wsToIr(ws);
  const issues = collectIssues(conversion);
  const byBlock = issuesByBlock(issues, ws, conversion.aliases);
  applyWarnings(ws, byBlock);
  return { program: conversion.program, layout: conversion.layout, issues, conversion, byBlock };
}

/**
 * Watches a workspace and validates it `delay` ms after the last relevant change.
 * UI-only events (selection, scrolling, clicks) are ignored.
 */
export class LiveValidator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listener = (e: Blockly.Events.Abstract) => {
    if (e.isUiEvent) return;
    this.schedule();
  };

  constructor(
    private readonly ws: Blockly.Workspace,
    private readonly onResult: (r: ValidationResult) => void,
    private readonly delay = VALIDATION_DELAY_MS,
  ) {
    ws.addChangeListener(this.listener);
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.ws.rendered && (this.ws as Blockly.WorkspaceSvg).isDragging()) {
        this.schedule();
        return;
      }
      this.flush();
    }, this.delay);
  }

  /** Validates now (cancelling any pending run). */
  flush(): ValidationResult {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const r = validateWorkspace(this.ws);
    this.onResult(r);
    return r;
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws.removeChangeListener(this.listener);
  }
}
