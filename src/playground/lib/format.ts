/**
 * Display formatting for the playground: values (Python-like), sizes, dates, file kinds.
 */
import type { Value } from '../../ir/timeline.ts';
import type { FsNode } from '../../domains/fileExplorer/fsTypes.ts';
import { displayPath } from './paths.ts';

// ------------------------------------------------------------------ values

/**
 * Python `repr(float)`: shortest round-trip digits, scientific notation when the decimal
 * exponent is < -4 or >= 16, always with a `.0` or exponent so it reads as a float.
 */
export function formatPyFloat(v: number): string {
  if (Number.isNaN(v)) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  // toExponential() with no argument yields the shortest digits that round-trip.
  const [mantissa, expPart] = v.toExponential().split('e') as [string, string];
  const exp = Number(expPart);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  const sign = negative ? '-' : '';
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const e = Math.abs(exp).toString().padStart(2, '0');
    return `${sign}${m}e${exp < 0 ? '-' : '+'}${e}`;
  }
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  const intLen = exp + 1;
  if (digits.length <= intLen) return `${sign}${digits}${'0'.repeat(intLen - digits.length)}.0`;
  return `${sign}${digits.slice(0, intLen)}.${digits.slice(intLen)}`;
}

/** Maximum list elements shown before truncating. */
export const LIST_PREVIEW = 3;

/** Formats a runtime value for the variables panel. Text is quoted, paths are `./rel`. */
export function formatValue(value: Value): string {
  switch (value.t) {
    case 'int':
      return String(value.v);
    case 'float':
      return formatPyFloat(value.v);
    case 'text':
      return JSON.stringify(value.v);
    case 'bool':
      return value.v ? 'True' : 'False';
    case 'path':
      return displayPath(value.v);
    case 'list': {
      const shown = value.v.slice(0, LIST_PREVIEW).map(formatValue);
      const more = value.v.length - LIST_PREVIEW;
      if (more > 0) shown.push(`… (+${more} more)`);
      return `[${shown.join(', ')}]`;
    }
  }
}

/** Static-type name for the variables panel (design.md §4.1: `number` covers int and float). */
export function valueType(value: Value): string {
  switch (value.t) {
    case 'int':
    case 'float':
      return 'number';
    case 'list': {
      const first = value.v[0];
      return first ? `list of ${valueType(first)}` : 'list';
    }
    default:
      return value.t;
  }
}

// ------------------------------------------------------------- sizes/dates

const UNITS = ['KB', 'MB', 'GB', 'TB'];

/** Human-readable size with decimal units: `512 B`, `180 KB`, `2.4 MB`. */
export function humanSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  let n = bytes;
  let unit = 'B';
  for (const u of UNITS) {
    if (n < 1000) break;
    n /= 1000;
    unit = u;
  }
  const rounded = n < 100 ? Math.round(n * 10) / 10 : Math.round(n);
  // Rounding can push 999.95 KB up to "1000 KB"; that is acceptable and still accurate.
  return `${String(rounded)} ${unit}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** UTC `YYYY-MM-DD HH:mm` from epoch seconds. */
export function formatDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

/** `YYYY-MM-DDTHH:mm` (UTC) for a datetime-local input. */
export function toDateTimeInput(epochSeconds: number): string {
  return formatDate(epochSeconds).replace(' ', 'T');
}

/** Parses a datetime-local value as UTC epoch seconds; null when invalid. */
export function fromDateTimeInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// -------------------------------------------------------------- file kinds

export interface FileKind {
  icon: string;
  /** Text alternative for the icon. */
  label: string;
}

const KINDS: { exts: string[]; kind: FileKind }[] = [
  {
    exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg', 'tif', 'tiff'],
    kind: { icon: '🖼️', label: 'Image' },
  },
  { exts: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'], kind: { icon: '🎵', label: 'Audio' } },
  { exts: ['mp4', 'mov', 'avi', 'mkv', 'webm'], kind: { icon: '🎬', label: 'Video' } },
  {
    exts: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'],
    kind: { icon: '📄', label: 'Document' },
  },
  {
    exts: ['txt', 'md', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'ini'],
    kind: { icon: '📝', label: 'Text' },
  },
  { exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'], kind: { icon: '🗜️', label: 'Archive' } },
  {
    exts: ['py', 'js', 'ts', 'html', 'css', 'sh', 'c', 'cpp', 'java'],
    kind: { icon: '💻', label: 'Code' },
  },
];

/** pathlib-style suffix without the dot ('' when none; a leading dot is not a suffix). */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1);
}

export function fileKind(node: FsNode): FileKind {
  if (node.type === 'folder') return { icon: '📁', label: 'Folder' };
  const ext = extensionOf(node.name).toLowerCase();
  const found = KINDS.find((k) => k.exts.includes(ext));
  if (found) return found.kind;
  return { icon: '📃', label: 'File' };
}
