/**
 * Conformance coverage (design.md §11): every op, every portable error code, and every
 * composite × field variant must appear in at least one fixture.
 */
import {
  OP_NAMES,
  RUNTIME_ERROR_CODES,
  SIMULATOR_ONLY_CODES,
  getField,
  parseTemplate,
  type CompositeStmt,
  type ErrorCode,
  type Expr,
  type Program,
  type Stmt,
} from '../src/ir/index.ts';

export interface FixtureRecord {
  name: string;
  source: Program;
  desugared: Program;
  errorCode: string | null;
}

/** Codes that cannot occur identically in Python (design.md §12). */
const NOT_PORTABLE: readonly ErrorCode[] = [...SIMULATOR_ONLY_CODES, 'INT_OVERFLOW'];

export const REQUIRED_VARIANTS: readonly string[] = [
  ...['name', 'ext', 'n', 'n:width', 'date'].map((p) => `renameByPattern template {${p}}`),
  'sortByType grouping=category',
  'sortByType grouping=extension',
  ...['move', 'copy', 'delete', 'rename'].map((a) => `findAndAct action=${a}`),
  'findAndAct recursive=true',
  'findAndAct recursive=false',
  ...['namePattern', 'extension', 'minSize', 'maxSize', 'modifiedAfter', 'modifiedBefore'].map(
    (c) => `findAndAct criterion ${c}`,
  ),
  ...['name', 'modified', 'size'].map((k) => `findFirst sortBy=${k}`),
  ...['move', 'copy', 'delete', 'rename'].map((a) => `everyFile action=${a}`),
  'everyFile includeSubfolders=true',
  'everyFile includeSubfolders=false',
  'everyFile makeFolder=true',
  'everyFile makeFolder=false',
  'goThrough includeSubfolders=true',
  'goThrough includeSubfolders=false',
  'repeatTimes',
  'keepDoingUntil',
  ...['first', 'biggest', 'smallest', 'newest', 'oldest'].map((k) => `findFile which=${k}`),
  ...['listing', 'name', 'date', 'size'].map((k) => `filesIn order=${k}`),
  'countFiles',
  'typeOf by=category',
  'typeOf by=extension',
  'halvingSearch',
  'hoist statement',
  'hoist while condition',
  'hoist short circuit',
];

function walkStmts(stmts: Stmt[], visitStmt: (s: Stmt) => void, visitExpr: (e: Expr) => void): void {
  const expr = (e: Expr): void => {
    visitExpr(e);
    switch (e.kind) {
      case 'list':
        e.items.forEach(expr);
        break;
      case 'binary':
        expr(e.left);
        expr(e.right);
        break;
      case 'unary':
        expr(e.arg);
        break;
      case 'op':
      case 'call':
        e.args.forEach(expr);
        break;
      case 'compositeExpr':
        Object.values(e.inputs).forEach(expr);
        break;
      default:
        break;
    }
  };
  const stmt = (s: Stmt): void => {
    visitStmt(s);
    switch (s.kind) {
      case 'assign':
        expr(s.value);
        break;
      case 'if':
        expr(s.cond);
        s.then.forEach(stmt);
        s.else.forEach(stmt);
        break;
      case 'while':
        expr(s.cond);
        s.body.forEach(stmt);
        break;
      case 'forEach':
        expr(s.list);
        s.body.forEach(stmt);
        break;
      case 'return':
        if (s.value) expr(s.value);
        break;
      case 'do':
        expr(s.expr);
        break;
      case 'print':
        expr(s.value);
        break;
      case 'composite':
        Object.values(s.inputs).forEach(expr);
        Object.values(s.bodies).forEach((b) => b.forEach(stmt));
        break;
    }
  };
  stmts.forEach(stmt);
}

function allStmts(p: Program): Stmt[] {
  return [...p.body, ...p.functions.flatMap((f) => f.body)];
}

function variantsOf(c: CompositeStmt): string[] {
  const out: string[] = [];
  switch (c.name) {
    case 'renameByPattern': {
      const t = parseTemplate(String(getField(c, 'template')));
      if (t.ok) {
        for (const part of t.parts) {
          if (part.kind === 'n') out.push(`renameByPattern template {${part.width ? 'n:width' : 'n'}}`);
          else if (part.kind !== 'lit') out.push(`renameByPattern template {${part.kind}}`);
        }
      }
      break;
    }
    case 'sortByType':
      out.push(`sortByType grouping=${String(getField(c, 'grouping'))}`);
      break;
    case 'findAndAct':
      out.push(`findAndAct action=${String(getField(c, 'action'))}`);
      out.push(`findAndAct recursive=${String(getField(c, 'recursive'))}`);
      for (const k of ['namePattern', 'extension', 'minSize', 'maxSize', 'modifiedAfter', 'modifiedBefore']) {
        if (getField(c, k) !== null) out.push(`findAndAct criterion ${k}`);
      }
      break;
    case 'findFirst':
      out.push(`findFirst sortBy=${String(getField(c, 'sortBy'))}`);
      break;
    case 'everyFile':
      out.push(`everyFile action=${String(getField(c, 'action'))}`);
      out.push(`everyFile includeSubfolders=${String(getField(c, 'includeSubfolders'))}`);
      out.push(`everyFile makeFolder=${String(getField(c, 'makeFolder'))}`);
      break;
    case 'goThrough':
      out.push(`goThrough includeSubfolders=${String(getField(c, 'includeSubfolders'))}`);
      break;
    case 'repeatTimes':
      out.push('repeatTimes');
      break;
    case 'keepDoingUntil':
      out.push('keepDoingUntil');
      break;
    case 'findFile':
      out.push(`findFile which=${String(getField(c, 'which'))}`);
      break;
    case 'halvingSearch':
      out.push('halvingSearch');
      break;
    case 'keepLeftHalf':
    case 'keepRightHalf':
      break;
  }
  return out;
}

export function coverageReport(records: FixtureRecord[]): { complete: boolean; text: string } {
  const ops = new Set<string>();
  const variants = new Set<string>();
  const codes = new Set<string>();
  for (const r of records) {
    walkStmts(allStmts(r.desugared), () => {}, (e) => e.kind === 'op' && ops.add(e.op));
    walkStmts(
      allStmts(r.source),
      (s) => s.kind === 'composite' && variantsOf(s).forEach((v) => variants.add(v)),
      (e) => {
        if (e.kind === 'op') ops.add(e.op);
        if (e.kind === 'compositeExpr') {
          if (e.name === 'filesIn') variants.add(`filesIn order=${String(e.fields.order ?? 'listing')}`);
          else if (e.name === 'typeOf') variants.add(`typeOf by=${String(e.fields.by ?? 'category')}`);
          else variants.add(e.name);
        }
      },
    );
    if (r.errorCode) codes.add(r.errorCode);
  }
  const missingOps = OP_NAMES.filter((o) => !ops.has(o));
  const missingCodes = RUNTIME_ERROR_CODES.filter((c) => !NOT_PORTABLE.includes(c) && !codes.has(c));
  const missingVariants = REQUIRED_VARIANTS.filter((v) => !variants.has(v));
  const section = (title: string, missing: readonly string[], total: number) =>
    `${title}: ${total - missing.length}/${total} covered` +
    (missing.length ? `\n  missing: ${missing.join(', ')}` : '');
  const portable = RUNTIME_ERROR_CODES.length - NOT_PORTABLE.length;
  return {
    complete: missingOps.length + missingCodes.length + missingVariants.length === 0,
    text: [
      'Coverage',
      section('  ops', missingOps, OP_NAMES.length),
      section('  error codes', missingCodes, portable),
      section('  composite variants', missingVariants, REQUIRED_VARIANTS.length),
    ].join('\n'),
  };
}
