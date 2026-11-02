/** Test-only: renders primitive IR as compact Python-like text for golden expectations. */
import type { Expr, Stmt } from '../../ir/types.ts';

function lit(v: number | string | boolean): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}

export function showExpr(e: Expr, nested = false): string {
  switch (e.kind) {
    case 'lit':
      return lit(e.value);
    case 'date':
      return `date('${e.iso}')`;
    case 'list':
      return `[${e.items.map((x) => showExpr(x)).join(', ')}]`;
    case 'var':
      return e.name;
    case 'binary': {
      const s = `${showExpr(e.left, true)} ${e.op} ${showExpr(e.right, true)}`;
      return nested ? `(${s})` : s;
    }
    case 'unary':
      return e.op === 'not' ? `not ${showExpr(e.arg, true)}` : `-${showExpr(e.arg, true)}`;
    case 'op':
    case 'call':
      return `${e.kind === 'op' ? e.op : e.fn}(${e.args.map((x) => showExpr(x)).join(', ')})`;
    case 'compositeExpr':
      return `<${e.name}>`;
  }
}

export function show(stmts: readonly Stmt[], indent = ''): string {
  const lines: string[] = [];
  const block = (body: readonly Stmt[]) =>
    body.length ? show(body, indent + '  ') : `${indent}  pass`;
  for (const s of stmts) {
    switch (s.kind) {
      case 'assign':
        lines.push(
          `${indent}${s.name} = ${showExpr(s.value)}${s.hint ? `  # -> ${s.hint.indexInto}` : ''}`,
        );
        break;
      case 'if':
        lines.push(`${indent}if ${showExpr(s.cond)}:`, block(s.then));
        if (s.else.length) lines.push(`${indent}else:`, block(s.else));
        break;
      case 'while':
        lines.push(`${indent}while ${showExpr(s.cond)}:`, block(s.body));
        break;
      case 'forEach':
        lines.push(`${indent}for ${s.name} in ${showExpr(s.list)}:`, block(s.body));
        break;
      case 'return':
        lines.push(`${indent}return${s.value ? ` ${showExpr(s.value)}` : ''}`);
        break;
      case 'do':
        lines.push(`${indent}${showExpr(s.expr)}`);
        break;
      case 'print':
        lines.push(`${indent}print(${showExpr(s.value)})`);
        break;
      case 'composite':
        lines.push(`${indent}<${s.name} ${s.id}>`);
        break;
    }
  }
  return lines.join('\n');
}
