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
import { T, type Stmt } from '../ir/types.ts';
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
  const item = ctx.freshName('item');
  const ext = ctx.freshName('ext');
  const group = ctx.freshName('group');
  const target = ctx.freshName('target');

  const setGroup = (name: string, local: string): Stmt =>
    b.assign(group, b.lit(name, id(`${local}.value`)), id(local));

  let groupStmt: Stmt;
  if (grouping === 'extension') {
    groupStmt = b.if(
      b.bin(
        '==',
        b.v(ext, id('group.test.ext')),
        b.lit('', id('group.test.empty')),
        id('group.test'),
      ),
      [setGroup(NO_EXTENSION_FOLDER, 'group.none')],
      [b.assign(group, b.v(ext, id('group.ext.value')), id('group.ext'))],
      id('group.if'),
    );
  } else {
    // Build the chain from the end: else-branch of the last category is 'Other'.
    let rest: Stmt[] = [setGroup(OTHER_CATEGORY, 'group.other')];
    for (let i = CATEGORIES.length - 1; i >= 0; i--) {
      const cat = CATEGORIES[i]!;
      const g = (s: string) => id(`group.c${i}${s}`);
      rest = [
        b.if(
          b.op(
            'list.contains',
            [
              b.list(
                T.text,
                cat.exts.map((e, j) => b.lit(e, g(`.exts${j}`))),
                g('.exts'),
              ),
              b.v(ext, g('.ext')),
            ],
            g('.test'),
          ),
          [setGroup(cat.name, `group.c${i}.set`)],
          rest,
          g(''),
        ),
      ];
    }
    groupStmt = rest[0]!;
  }

  return [
    b.assign(folder, input(node, 'folder'), id('folder')),
    b.forEach(
      item,
      b.op('fs.list', [b.v(folder, id('loop.folder'))], id('loop.list')),
      [
        b.if(
          b.not(
            b.op('fs.isFolder', [b.v(item, id('check.item'))], id('check.isFolder')),
            id('check.isFile'),
          ),
          [
            b.assign(
              ext,
              b.op(
                'text.lower',
                [b.op('fs.ext', [b.v(item, id('ext.item'))], id('ext.raw'))],
                id('ext.lower'),
              ),
              id('ext'),
            ),
            groupStmt,
            b.assign(
              target,
              b.op(
                'fs.join',
                [b.v(folder, id('target.folder')), b.v(group, id('target.group'))],
                id('target.join'),
              ),
              id('target'),
            ),
            b.if(
              b.not(
                b.op('fs.exists', [b.v(target, id('mkdir.test.target'))], id('mkdir.test.exists')),
                id('mkdir.test'),
              ),
              [
                b.do(
                  b.op('fs.makeFolder', [b.v(target, id('mkdir.target'))], id('mkdir.op')),
                  id('mkdir'),
                ),
              ],
              [],
              id('mkdir.if'),
            ),
            b.do(
              b.op(
                'fs.move',
                [b.v(item, id('move.item')), b.v(target, id('move.target'))],
                id('move.op'),
              ),
              id('move'),
            ),
          ],
          [],
          id('check'),
        ),
      ],
      id('loop'),
    ),
  ];
}

export const sortByType: CompositeDef = { ...COMPOSITE_SCHEMAS.sortByType, desugar };
