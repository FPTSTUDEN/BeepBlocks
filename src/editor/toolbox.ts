/**
 * Toolbox (design.md §9): Tasks, Files, Logic, Loops, Variables, Lists, Text, Math, Functions.
 * Variables and Functions are dynamic categories.
 */
import * as Blockly from 'blockly/core';
import { ACTION_NAMES, COMPOSITE_NAMES } from '../ir/composites.ts';
import { OP_NAMES, type OpName } from '../ir/ops.ts';
import { B, compositeBlockType, opBlockType } from './blocks/blockTypes.ts';
import { STYLE } from './blocks/common.ts';
import { callSpecForDef, NO_RETURN } from './blocks/functions.ts';
import { isStatementOp, opStyle } from './blocks/ops.ts';
import { typeKeyLabel } from './blocks/typeKeys.ts';
import { variableTypeKey } from './blocks/variables.ts';

type BlockInfo = Blockly.utils.toolbox.BlockInfo;
type ConnectionState = NonNullable<BlockInfo['inputs']>[string];
type Item = Blockly.utils.toolbox.ToolboxItemInfo;

export const CATEGORY_NAMES = [
  'Tasks',
  'Files',
  'Logic',
  'Loops',
  'Variables',
  'Lists',
  'Text',
  'Math',
  'Functions',
] as const;

export const VARIABLES_CATEGORY = 'BP_VARIABLES';
export const FUNCTIONS_CATEGORY = 'BP_FUNCTIONS';

const block = (type: string, extra: Partial<BlockInfo> = {}): BlockInfo => ({
  kind: 'block',
  type,
  ...extra,
});
const child = (type: string, extra: Partial<BlockInfo> = {}): ConnectionState => ({
  block: { type, ...extra },
});
const root = () => child(opBlockType('fs.root'));
const text = (v: string) => child(B.text, { fields: { TEXT: v } });
const num = (v: string) => child(B.number, { fields: { NUM: v } });

/** Sensible default inputs for op blocks in the palette. */
function opDefaults(op: OpName): Record<string, ConnectionState> {
  switch (op) {
    case 'fs.join':
      return { A0: root(), A1: text('new folder') };
    case 'fs.list':
    case 'fs.walk':
      return { A0: root() };
    case 'fs.makeFolder':
      return {
        A0: child(opBlockType('fs.join'), { inputs: { A0: root(), A1: text('new folder') } }),
      };
    case 'text.from':
      return { A0: num('1') };
    case 'text.padNumber':
      return { A0: num('7'), A1: num('3') };
    case 'list.range':
      return { A0: num('0'), A1: num('5') };
    case 'list.get':
      return { A1: num('0') };
    default:
      return {};
  }
}

function opBlock(op: OpName): BlockInfo {
  const inputs = opDefaults(op);
  return block(opBlockType(op), Object.keys(inputs).length ? { inputs } : {});
}

/** A "do [op]" step, for ops that give back a value but are mostly used as actions. */
function doOp(op: OpName): BlockInfo {
  return block(B.do, { inputs: { EXPR: { block: { type: opBlockType(op) } } } });
}

function category(
  name: string,
  style: string,
  contents: Item[],
): Blockly.utils.toolbox.StaticCategoryInfo {
  return {
    kind: 'category',
    name,
    categorystyle: style,
    contents,
    id: `bp-cat-${name.toLowerCase()}`,
    colour: undefined,
    cssconfig: undefined,
    hidden: undefined,
  };
}

function dynamic(
  name: string,
  style: string,
  custom: string,
): Blockly.utils.toolbox.DynamicCategoryInfo {
  // `name` is read by Blockly at runtime but missing from its DynamicCategoryInfo type.
  const info = {
    kind: 'category',
    name,
    categorystyle: style,
    custom,
    id: `bp-cat-${name.toLowerCase()}`,
    colour: undefined,
    cssconfig: undefined,
    hidden: undefined,
  };
  return info;
}

const opsWhere = (pred: (op: OpName) => boolean) => OP_NAMES.filter(pred).map(opBlock);

export function buildToolbox(showAdvanced = true): Blockly.utils.toolbox.ToolboxInfo {
  const fsOps = OP_NAMES.filter((op) => opStyle(op) === STYLE.files);
  if (!showAdvanced) {
    return {
      kind: 'categoryToolbox',
      contents: [
        category('Tasks', STYLE.tasks, COMPOSITE_NAMES.map((n) => block(compositeBlockType(n), { inputs: { I_folder: root() } }))),
        category('Files', STYLE.files, [
          ...ACTION_NAMES.filter((n) => ['everyFile', 'makeFolderIfMissing'].includes(n)).map((n) => block(compositeBlockType(n))),
          ...fsOps.filter(isStatementOp).map(opBlock),
          doOp('fs.rename'),
          doOp('fs.move'),
          doOp('fs.copy'),
        ]),
        category('Groups', STYLE.tasks, [
          ...ACTION_NAMES.filter((n) => ['goThrough', 'findFile'].includes(n)).map((n) => block(compositeBlockType(n))),
        ]),
        category('Search', STYLE.tasks, [
          ...ACTION_NAMES.filter((n) => ['halvingSearch', 'keepLeftHalf', 'keepRightHalf'].includes(n)).map((n) => block(compositeBlockType(n))),
        ]),
        category('Repeat', STYLE.loops, [
          ...ACTION_NAMES.filter((n) => ['repeatTimes', 'keepDoingUntil'].includes(n)).map((n) => block(compositeBlockType(n))),
        ]),
        category('Decisions', STYLE.logic, [block(B.if), block(B.compare), block(B.logic), block(B.not), block(B.bool)]),
        category('Remember', STYLE.variables, [block(B.assign), block(B.var), block(B.print, { inputs: { VALUE: text('Hello!') } })]),
        category('Values', STYLE.text, [block(B.text), block(B.number), block(B.date), opBlock('fs.root')]),
      ],
    };
  }
  return {
    kind: 'categoryToolbox',
    contents: [
      category(
        'Tasks',
        STYLE.tasks,
        COMPOSITE_NAMES.map((n) => block(compositeBlockType(n), { inputs: { I_folder: root() } })),
      ),
      category('Files', STYLE.files, [
        ...fsOps.filter(isStatementOp).map(opBlock),
        doOp('fs.rename'),
        doOp('fs.move'),
        doOp('fs.copy'),
        ...fsOps.filter((op) => !isStatementOp(op)).map(opBlock),
      ]),
      category('Logic', STYLE.logic, [
        block(B.if),
        block(B.if, { extraState: { else: true } }),
        block(B.compare),
        block(B.logic),
        block(B.not),
        block(B.bool),
      ]),
      category('Loops', STYLE.loops, [
        block(B.forEach, {
          inputs: { LIST: child(opBlockType('fs.list'), { inputs: { A0: root() } }) },
        }),
        block(B.while),
      ]),
      dynamic('Variables', STYLE.variables, VARIABLES_CATEGORY),
      category('Lists', STYLE.lists, [
        block(B.list, { extraState: { items: 2 } }),
        ...opsWhere((op) => opStyle(op) === STYLE.lists),
      ]),
      category('Text', STYLE.text, [
        block(B.print, { inputs: { VALUE: text('Hello!') } }),
        block(B.text),
        ...opsWhere((op) => opStyle(op) === STYLE.text),
      ]),
      category('Math', STYLE.math, [
        block(B.number),
        block(B.arith, { inputs: { A: num('1'), B: num('1') } }),
        block(B.neg),
        block(B.date),
        ...opsWhere((op) => opStyle(op) === STYLE.math),
      ]),
      dynamic('Functions', STYLE.functions, FUNCTIONS_CATEGORY),
    ],
  };
}

// ------------------------------------------------------- dynamic categories

/** Types offered by the "Make a … variable" buttons (stored on `variable.type`). */
export const CREATE_VAR_TYPES = [
  'number',
  'text',
  'bool',
  'path',
  'list:path',
  'list:number',
  'list:text',
];

const createKey = (type: string) => `BP_CREATE_VARIABLE_${type}`;

export function variablesFlyout(ws: Blockly.Workspace): Blockly.utils.toolbox.FlyoutItemInfo[] {
  const items: Blockly.utils.toolbox.FlyoutItemInfo[] = CREATE_VAR_TYPES.map((t) => ({
    kind: 'button',
    text: `Make a ${typeKeyLabel(t)} variable`,
    callbackkey: createKey(t),
  }));
  const vars = [...ws.getVariableMap().getAllVariables()].sort((a, b) =>
    a.getName().localeCompare(b.getName()),
  );
  for (const v of vars) {
    const field = { VAR: { name: v.getName(), type: v.getType() } };
    const key = variableTypeKey(v);
    items.push({
      kind: 'label',
      text: key ? `${v.getName()} (${typeKeyLabel(key)})` : v.getName(),
      id: undefined,
    });
    items.push(block(B.assign, { fields: field }), block(B.var, { fields: field }));
  }
  return items;
}

export function functionsFlyout(ws: Blockly.Workspace): Blockly.utils.toolbox.FlyoutItemInfo[] {
  const items: Blockly.utils.toolbox.FlyoutItemInfo[] = [
    block(B.function),
    block(B.return),
    block(B.do),
  ];
  for (const def of ws.getBlocksByType(B.function, false)) {
    const spec = callSpecForDef(def);
    if (!spec.fn) continue;
    items.push(block(spec.returns === NO_RETURN ? B.callStmt : B.call, { extraState: spec }));
  }
  return items;
}

/** Registers the dynamic Variables/Functions categories and variable buttons on `ws`. */
export function registerDynamicCategories(ws: Blockly.WorkspaceSvg): void {
  ws.registerToolboxCategoryCallback(VARIABLES_CATEGORY, (w) => variablesFlyout(w));
  ws.registerToolboxCategoryCallback(FUNCTIONS_CATEGORY, (w) => functionsFlyout(w));
  for (const t of CREATE_VAR_TYPES) {
    ws.registerButtonCallback(createKey(t), (button) =>
      Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace(), undefined, t),
    );
  }
}
