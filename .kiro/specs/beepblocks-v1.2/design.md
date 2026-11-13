# Design Document — BeepBlocks v1.2: Flow Canvas

## 1. Overview

Canvas mode is a **view + edit layer** that sits on top of the existing IR and
editor infrastructure. The IR (`src/ir/types.ts`), simulator, Python exporter,
and conformance fixtures are entirely unchanged. The canvas reads the IR tree,
projects it into a node-and-edge graph, and writes changes back to the IR tree.

```
┌──────────────────────────────────────────────────────┐
│  .beep.json                                          │
│  ┌────────────────────┐  ┌──────────────────────┐   │
│  │  IR (unchanged)    │  │  canvas: { nodes:{}, │   │
│  │  Program tree      │  │    edges:{} }         │   │
│  └────────┬───────────┘  └──────────────────────┘   │
└───────────┼──────────────────────────────────────────┘
            │
   ┌────────▼────────────────────────────────┐
   │  src/canvas/                            │
   │  ┌──────────────┐  ┌─────────────────┐  │
   │  │  projection  │  │  write-back     │  │
   │  │  ir → graph  │  │  graph → ir     │  │
   │  └──────────────┘  └─────────────────┘  │
   │  ┌──────────────────────────────────┐   │
   │  │  CanvasEditor (React component)  │   │
   │  │  powered by @xyflow/react        │   │
   │  └──────────────────────────────────┘   │
   └─────────────────────────────────────────┘
            │
   ┌────────▼────────────────────────────────┐
   │  src/editor/EditorShell.tsx             │
   │  mode toggle: "blocks" | "canvas"       │
   └─────────────────────────────────────────┘
```

---

## 2. Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| Canvas library | `@xyflow/react` (React Flow v12) | MIT, actively maintained, used by n8n and many visual tools, supports custom nodes/edges, pan/zoom, minimap, handles cycles |
| Auto-layout | `dagre` | Simple, well-tested directed-graph layout; sufficient for acyclic subgraphs; back-edges treated as reversed for layout then re-reversed for display |
| Package manager | pnpm (existing) | Consistent with project |
| New source dir | `src/canvas/` | Keeps canvas code isolated; editor shell (`src/editor/`) gains only the toggle |

---

## 3. Data Model

### 3.1 Layout storage in `.beep.json`

```ts
// appended to the Program type as an optional field
interface Program {
  // ... existing fields ...
  canvas?: CanvasLayout;
}

interface CanvasLayout {
  // keyed by node ID (see §3.2 for ID scheme)
  nodes: Record<string, NodeOverride>;
}

interface NodeOverride {
  x: number;   // pixels from canvas origin
  y: number;
}
```

No `edges` are stored — edge topology is fully derived from the IR on every
load. Only position overrides are persisted.

### 3.2 Node ID scheme

Each IR node gets a stable string ID so position overrides survive edits that
don't touch that node.

```
"stmt-{path}"        // path = dot-joined integer indices from program root
                     // e.g. "stmt-0.2.1" = program.stmts[0].stmts[2].stmts[1]
"expr-{path}"        // for expression composites in that position
"frame-{name}"       // for a function/task frame
"merge-{path}"       // for auto-generated merge nodes
"term-start"
"term-end"
```

Path-based IDs are deterministic and survive layout-only edits. When the IR
tree changes (block added/removed), affected IDs shift; those nodes simply lose
their override and get auto-layout positions on the next render.

### 3.3 Graph model (in memory, not persisted)

```ts
interface CanvasNode {
  id: string;
  kind: 'sequence' | 'condition' | 'loop' | 'merge' | 'frame' | 'terminal' | 'switch';
  label: string;
  binds: string[];          // variable names bound by this node
  irPath: number[];         // path into the IR tree for write-back
  position: { x: number; y: number };
  // React Flow passes these through; custom node renderers read them
  data: Record<string, unknown>;
}

interface CanvasEdge {
  id: string;
  source: string;           // node ID
  sourceHandle: string;     // port name: 'out' | 'true' | 'false' | 'body' | 'done' | 'value' | branch value
  target: string;
  targetHandle: string;     // port name: 'in' | 'value-in'
  kind: 'exec' | 'data' | 'back' | 'self';
  label?: string;           // 'yes' / 'no' / 'next' / 'done' / branch value
}
```

---

## 4. Projection: IR Tree → Graph

`src/canvas/project.ts` — a pure function, no side effects.

```ts
function projectProgram(program: Program, overrides: CanvasLayout): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
```

### 4.1 Traversal rules

The projection walks the statement list and recurses into blocks that contain
child statement lists (`if` branches, loop bodies, function bodies). It
produces nodes and edges according to these rules:

| IR node kind | Canvas nodes produced | Edges produced |
|---|---|---|
| Sequence of stmts | One node per stmt + chain of `exec` edges | `out → in` for each consecutive pair |
| `if` (one branch) | Condition node + body nodes + merge node | `true → body-start`, `false → merge`, `body-end → merge` |
| `if/else` | Condition node + true-body + false-body + merge | `true → true-start`, `false → false-start`, both ends → merge |
| `if/elif/.../else` | Switch node + N branch chains + merge | one exec edge per branch, all ends → merge |
| `while` | Loop-head node + body nodes + back-edge | `body → out`, `done → after-loop`; back-edge `body-end → loop-head.in` |
| `for each` | Same as `while` | Same |
| `repeat N times` | Same as `while` | Same |
| `keep doing until` | Same as `while` | Same |
| Task / action composite | One node (not expanded unless Expand was used) | `out → in` |
| Expression composite | One node with `value` output port | Exec `out → in`; Data `value → consuming-node.value-in` |
| Function def | Frame node wrapping body nodes | Frame has entry/exit ports; recursive call gets self-edge |
| Recursive call | Normal sequence node inside frame | Additional self-edge `out → frame.entry` with `kind:'self'` |

### 4.2 Merge node placement

Branches converge at a merge node only when both (all) branches have an
outgoing execution path. A branch that ends in `return`, `break`, or
`continue` has no outgoing execution edge; the merge node is omitted if all
branches terminate this way.

### 4.3 Data edge production

After collecting all nodes, the projection does a second pass:
1. Build a map `varName → producerNodeId` from all bind declarations in the IR.
2. For every use of a variable in an expression, emit a `data` edge from
   `producerNodeId.value` to `consumerNodeId.value-in`.
3. Expression composite nodes produced by hoisting: the data edge connects the
   composite node's `value` port to the statement that was hoisted before.

---

## 5. Write-back: Graph Edits → IR

`src/canvas/writeback.ts`

Write-back is only needed for edits made on the canvas. Each edit type maps to
an IR mutation:

| Canvas edit | IR mutation |
|---|---|
| Delete node | Remove statement at `irPath` |
| Drag block from palette onto canvas | Insert statement at the IR position corresponding to the drop target edge |
| Reconnect execution edge | Move statement to new position (remove from old, insert at new) |
| Add branch to Switch node | Append `elif` clause to the `if` chain |
| Remove branch from Switch node | Remove `elif` clause |

Write-back does **not** need to handle position drags — those write only to
`canvas.nodes` in the layout, not to the IR.

Every IR mutation goes through the existing `EditorContext.dispatch()` action
system so it participates in undo/redo automatically.

---

## 6. Custom Node Renderers

`src/canvas/nodes/` — one file per node kind.

Each renderer is a React component that React Flow passes `data` to. They share
a base style sheet in `src/canvas/nodes/base.css`.

```
nodes/
  SequenceNode.tsx   — rectangle, label, bind names
  ConditionNode.tsx  — diamond shape (CSS clip-path or SVG)
  LoopNode.tsx       — rounded rect + loop icon badge
  SwitchNode.tsx     — diamond with N labelled output handles
  MergeNode.tsx      — small filled diamond (◆), no label
  FrameNode.tsx      — React Flow group node, dashed border
  TerminalNode.tsx   — pill shape (Start / End / Return)
```

Port (handle) positions:
- Sequence: `in` top-centre, `out` bottom-centre.
- Condition: `in` top-centre, `true` right, `false` left (or bottom-left).
- Loop: `in` top-centre, `body` right, `done` bottom-centre. Back-edge target
  is a second handle on the top (`back-in`) so it doesn't collide with `in`.
- Merge: `in-0…N` top, `out` bottom.

---

## 7. Auto-Layout with Dagre

`src/canvas/layout.ts`

```ts
function autoLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  overrides: CanvasLayout,
): CanvasNode[]   // returns nodes with updated positions
```

Steps:
1. Build a `dagre.graphlib.Graph`.
2. Add all nodes with their approximate rendered size (width × height from a
   size table keyed by node kind).
3. Add all **forward** execution edges (kind `exec`). Skip back-edges and data
   edges — they would create cycles that break Dagre.
4. Run `dagre.layout()` with `rankdir: 'TB'` (top-to-bottom).
5. Copy computed `x, y` into `CanvasNode.position`, except for nodes that have
   an override in `overrides.nodes`.
6. Back-edges and self-edges are routed after layout by computing a curved
   Bezier path that arcs around the left side of the loop group.

---

## 8. EditorShell Integration

`src/editor/EditorShell.tsx` gains:

```tsx
const [mode, setMode] = useState<'blocks' | 'canvas'>(
  () => loadMode(file.id) ?? 'blocks'
);

// in render:
{mode === 'blocks' ? (
  <BlockEditor program={program} dispatch={dispatch} />
) : (
  <CanvasEditor program={program} dispatch={dispatch} />
)}

<ModeToggle mode={mode} onChange={m => { setMode(m); saveMode(file.id, m); }} />
```

`ModeToggle` is a segmented button ("Blocks | Canvas") in the existing toolbar,
styled to match the toolbar's current design tokens.

The `dispatch` passed to `CanvasEditor` is the same `EditorContext` dispatch used
by the block editor, so undo/redo is shared.

---

## 9. Canvas Toolbar

A secondary toolbar rendered inside `CanvasEditor`:

```
[ Re-layout ]  [ Fit (F) ]  [ 100% (0) ]  [ − ][ + ]  [ □ Minimap ]  [ ~ Data flow ]
```

- **Re-layout** — clears all overrides in `canvas.nodes`, re-runs auto-layout.
- **Fit (F)** — `reactFlow.fitView()`.
- **100% (0)** — `reactFlow.setViewport({zoom:1})`.
- **− / +** — step zoom by 25 %.
- **□ Minimap** — toggle React Flow's built-in `<MiniMap>`.
- **~ Data flow** — toggle visibility of data edges (class on the canvas root).

---

## 10. Keyboard and Accessibility

Canvas mode builds on React Flow's built-in keyboard navigation:
- Tab moves focus between nodes.
- Arrow keys pan the viewport when no node is focused.
- Delete / Backspace deletes the focused node (same IR mutation as §5).
- Enter opens the block's property panel (same panel as Block mode).
- Escape deselects.

Each custom node renderer uses `role="group"` with an `aria-label` matching the
node label. Edges are not in the tab order (they are decorative); screen-reader
users access program structure through Block mode or the existing outline panel.

The mode toggle carries `aria-pressed` and is part of the main toolbar's focus
ring.

---

## 11. Source Layout

```
src/
  canvas/
    index.ts              re-exports public surface
    project.ts            IR → graph projection
    writeback.ts          graph edits → IR mutations
    layout.ts             dagre auto-layout
    CanvasEditor.tsx       top-level canvas React component
    CanvasToolbar.tsx      secondary toolbar
    nodes/
      SequenceNode.tsx
      ConditionNode.tsx
      LoopNode.tsx
      SwitchNode.tsx
      MergeNode.tsx
      FrameNode.tsx
      TerminalNode.tsx
      base.css
    edges/
      ExecEdge.tsx         custom edge renderer for execution edges
      DataEdge.tsx         custom edge renderer for data edges
      BackEdge.tsx         curved back-edge with "next/again" label
      SelfEdge.tsx         self-loop for recursion
  editor/
    EditorShell.tsx        gains mode toggle + CanvasEditor branch (existing)
    ModeToggle.tsx         new: segmented button component
```

New dependencies (to be pinned in `package.json`):

```jsonc
"@xyflow/react": "12.3.6",
"dagre": "0.8.5"
```

---

## 12. Out of Scope for v1.2

The following are explicitly deferred:

- **Mutually recursive functions** (Req 7.4) — layout of cross-frame edges is
  complex; deferred to v1.3.
- **Inline expression editing on the canvas** — expressions are edited via the
  same side panel as Block mode; direct wire-connecting of expression values on
  the canvas is deferred.
- **Canvas-only blocks** (blocks that exist only in Canvas mode with no Block
  mode equivalent) — all blocks must round-trip through the IR.
- **Exporting a diagram image** — out of scope; users can screenshot.
- **Collaborative / multi-user canvas** — out of scope.
