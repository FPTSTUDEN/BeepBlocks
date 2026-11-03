/**
 * sortByType (design.md §6.2, task C.4).
 *
 *   folder = <folder>                          # used twice → evaluated once
 *   for item in fs.list(folder):
 *       if not fs.isFolder(item):
 *           ext = text.lower(fs.ext(item))
 *           <group = …>                         # extension: ext or 'No extension'
 *                                               # category:  if/else chain over CATEGORIES
 *           target = fs.join(folder, group)
 *           if not fs.exists(target):
 *               fs.makeFolder(target)
 *           fs.move(item, target)
 */
import type { CompositeDef, CompositeStmt, DesugarCtx } from '../ir/composites.ts';
import { COMPOSITE_SCHEMAS } from '../ir/composites.ts';
import { b } from '../ir/build.ts';
import type { Stmt } from '../ir/types.ts';
import { enumField, input } from './util.ts';

/** Folder name for files without an extension, in `extension` mode. */
export const NO_EXTENSION_FOLDER = 'No extension';
/** Folder name for unknown and missing extensions, in `category` mode. */
export const OTHER_CATEGORY = 'Other';

/** Category table (lowercase extensions without dot). Checked in this order. */
// prettier-ignore
export const CATEGORIES: readonly { readonly name: string; readonly exts: readonly string[] }[] = [
  {
    name: 'Images',
    exts: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'tif', 'tiff', 'heic', 'ico', 'raw'],
  },
  {
    name: 'Documents',
    exts: [
      'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx',
      'odp', 'epub',
    ],
  },
  { name: 'Audio', exts: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'mid'] },
  { name: 'Video', exts: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg'] },
  { name: 'Archives', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso'] },
  {
    name: 'Code',
    exts: [
      'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'json', 'xml', 'yml', 'yaml', 'java',
      'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'ps1', 'sql',
    ],
  },
];

/** Category for a lowercase extension (without dot), as the desugared chain computes it. */
export function categoryOf(ext: string): string {
  return CATEGORIES.find((c) => c.exts.includes(ext))?.name ?? OTHER_CATEGORY;
}

function desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[] {
  const id = ctx.id;
  const grouping = enumField(node, 'grouping', ['category', 'extension'] as const);
  const folder = ctx.freshName('folder');
  const file = ctx.freshName('item');
  return [
    b.assign(folder, input(node, 'folder'), id('folder')),
    b.composite(
      'everyFile',
      {
        fields: { action: 'move', includeSubfolders: false, makeFolder: true },
        inputs: {
          folder: b.v(folder, id('action.folder')),
          destination: b.op(
            'fs.join',
            [
              b.v(folder, id('destination.folder')),
              b.compositeExpr(
                'typeOf',
                { fields: { by: grouping }, inputs: { file: b.v(file, id('type.file')) } },
                id('destination.type'),
              ),
            ],
            id('destination'),
          ),
        },
        binds: { file },
      },
      id('everyFile'),
    ),
  ];
}

export const sortByType: CompositeDef = { ...COMPOSITE_SCHEMAS.sortByType, desugar };
