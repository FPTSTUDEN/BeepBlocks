# Implementation Tasks — BeepBlocks v1.2: Flow Canvas

- `_Req: n.m_` → `requirements.md` (this folder). `§n` → `design.md` (this folder).
- Gates for every task that changes code: `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, `pnpm test:py`, `pnpm conformance --strict`.
  Run `pnpm smoke` and `pnpm e2e` before each phase checkpoint.
- Existing conformance fixtures MUST continue to pass unchanged — the IR and
  exporter are not modified in v1.2.

---

## Phase 0 — Dependencies and Skeleton [SEQ, integrator]

Goal: install libraries, create the directory structure, and wire a no-op
CanvasEditor into EditorShell so the toggle exists and flips without crashing.
No real graph rendering yet.

- [ ] 0.1 Install dependencies (§11)
  - `pnpm add @xyflow/react@12.3.6 dagre@0.8.5`
  - `pnpm add -D @types/dagre@0.7.52`
  - Verify `pnpm typecheck` and `pnpm lint` still pass.
  - _Req: —_

- [ ] 0.2 Create `src/canvas/` directory structure (§11)
  - Create stub files (`index.ts`, `project.ts`, `writeback.ts`, `layout.ts`,
    `CanvasEditor.tsx`, `CanvasToolbar.tsx`) with empty exports.
  - Create `src/canvas/nodes/` and `src/canvas/edges/` with stub files.
  - _Req: —_

- [ ] 0.3 `ModeToggle` component (`src/editor/ModeToggle.tsx`) (§8)
  - Segmented button: "Blocks" | "Canvas".
  - Props: `mode: 'blocks'|'canvas'`, `onChange`.
  - Keyboard: Tab/Enter/Space to activate; `aria-pressed` on each option.
  - Styled to match the existing toolbar.
  - Unit test: renders both options; fires `onChange` with correct value;
    correct `aria-pressed` state.
  - _Req: 1.1, 1.4_

- [ ] 0.4 Mode persistence in `EditorShell` (§8)
  - `EditorShell.tsx` gains `mode` state; initialises from `localStorage`
    key `"beep-canvas-mode-{fileId}"`.
  - Renders `<ModeToggle>` in the toolbar; switching sets state and updates
    localStorage.
  - When mode is `"canvas"`, renders a placeholder `<CanvasEditor>` div
    (just a grey box) instead of `<BlockEditor>`.
  - Unit test: toggle switches between block and placeholder; mode is
    persisted and restored.
  - _Req: 1.1, 1.5_

- [ ] 0.5 Checkpoint 0
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm conformance --strict`.
  - `pnpm smoke`: toggle visible, clicking it switches between block view and
    grey placeholder, no console errors.
  - Commit: `feat(canvas): phase 0 scaffold — toggle + stub canvas`.

---

## Phase 1 — Projection and Auto-Layout [PAR — good candidates for Copilot CLI agents]

Goal: implement the pure projection and layout logic (no React yet) and unit-test
them thoroughly against the existing IR fixtures.

### Workstream A — IR → Graph Projection [`src/canvas/project.ts`]

- [ ] A.1 Node and edge TypeScript types (`src/canvas/types.ts`) (§3.3)
  - `CanvasNode`, `CanvasEdge`, `CanvasLayout`, `NodeOverride` interfaces.
  - Re-export from `src/canvas/index.ts`.
  - _Req: 2, 3, 4_

- [ ] A.2 Sequence projection
  - `projectProgram(program, overrides)` for a flat list of sequence statements.
  - Produces one node per statement, chained `exec` edges, `term-start` and
    `term-end` terminals.
  - Tests: single statement, three statements, empty program.
  - _Req: 2.1, 3.1_

- [ ] A.3 Conditional projection (`if`, `if/else`, `if/elif/else`)
  - `if` without else: condition node → body chain → merge node; `false` edge
    goes directly to merge.
  - `if/else`: condition node → true chain → merge; condition → false chain →
    merge.
  - `if/elif/else` (3+ branches): Switch node with N out-ports → N chains →
    merge.
  - Tests: each shape; a branch that ends in `return` (no merge edge from that
    branch).
  - _Req: 2.3, 3.3, 5.1–5.5_

- [ ] A.4 Loop projection (`while`, `for each`, `repeat`, `keep doing until`)
  - Loop-head node with `body`, `done`, `back-in` ports.
  - Body nodes chained inside; back-edge from last body node to `back-in`.
  - `done` edge to first node after the loop.
  - Tests: loop with single body stmt; loop with nested if inside body;
    empty body.
  - _Req: 6.1–6.5_

- [ ] A.5 Function frame and recursion
  - Function definition → Frame node containing projected body nodes.
  - Recursive call detection: call target matches enclosing function name →
    emit additional self-edge `kind:'self'` from call node to `frame.entry`.
  - Tests: non-recursive function; directly recursive function; Frame node
    has `(calls itself)` badge data set.
  - _Req: 7.1–7.3_

- [ ] A.6 Data edges
  - Second-pass variable resolution: collect all bind declarations, emit
    `data` edges for each variable use.
  - Expression composite nodes: `value` output port; data edge to consumer.
  - Tests: variable produced and consumed in same scope; variable in loop;
    expression composite desugared value.
  - _Req: 4.1–4.6_

- [ ] A.7 Layout overrides applied
  - `projectProgram` applies stored `x,y` overrides from `CanvasLayout.nodes`
    to the matching nodes by ID.
  - Nodes with no override get position `{x:0, y:0}` (layout fills them in).
  - Test: override for one node survives a full projection round-trip.
  - _Req: 8.1_

### Workstream B — Auto-Layout [`src/canvas/layout.ts`]

- [ ] B.1 `autoLayout(nodes, edges, overrides)` (§7)
  - Build Dagre graph from nodes and forward `exec` edges only (skip back/self/
    data edges).
  - Run `dagre.layout({ rankdir:'TB', nodesep:40, ranksep:60 })`.
  - Copy computed positions; skip nodes that have an override.
  - Return updated nodes array.
  - Tests: linear chain produces top-to-bottom y positions; condition node is
    above its branch nodes; overridden node position unchanged.
  - _Req: 9.1_

- [ ] B.2 Back-edge routing
  - After Dagre layout, compute Bezier control points for back-edges that arc
    around the left side of the loop group.
  - Store control points in the edge's `data.bezier` field for the custom
    edge renderer.
  - Test: back-edge control points are to the left of the leftmost node in the
    loop group.
  - _Req: 3.6, 6.1_

- [ ] B.3 Checkpoint A+B
  - All projection and layout tests pass.
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`.
  - Commit: `feat(canvas): projection and auto-layout (phase 1)`.

---

## Phase 2 — Custom Node Renderers [PAR]

Goal: implement all custom React node components so a real graph renders.
No editing yet — read-only canvas.

### Workstream C — Node Renderers [`src/canvas/nodes/`]

- [ ] C.1 `base.css` and design tokens
  - CSS variables for node colours matching Block mode categories
    (file-ops, control-flow, search, math, composite).
  - Base styles for all node kinds: border, border-radius, padding, font.
  - _Req: 2.4_

- [ ] C.2 `SequenceNode.tsx`
  - Rectangle, label centred, bind names below in muted text.
  - Two handles: `in` (top-centre) and `out` (bottom-centre).
  - Colour from category token.
  - `role="group"`, `aria-label` = node label.
  - _Req: 2.1–2.5_

- [ ] C.3 `ConditionNode.tsx` and `SwitchNode.tsx`
  - Condition: diamond shape (SVG or CSS clip-path); handles `in` top,
    `true` right, `false` left.
  - Switch: diamond with dynamic handles, one per branch; labels on handles.
  - Both carry `aria-label` = "Condition: {label}".
  - _Req: 2.3, 5.1–5.5_

- [ ] C.4 `LoopNode.tsx`
  - Rounded rect with loop icon (⟳) badge.
  - Handles: `in` top, `body` right, `done` bottom, `back-in` top-left.
  - On collapse (double-click): hide body, show "⟳ N steps inside" badge.
  - _Req: 6.1–6.5_

- [ ] C.5 `FrameNode.tsx`, `TerminalNode.tsx`, `MergeNode.tsx`
  - Frame: React Flow group node (use `type:'group'`); dashed border;
    "(calls itself)" badge if `data.recursive`.
  - Terminal: pill shape, label "Start" / "End" / "Return".
  - Merge: small filled diamond ◆, no label, handles `in-0`…`in-N` and `out`.
  - _Req: 7.1–7.3, 2.3_

### Workstream D — Edge Renderers [`src/canvas/edges/`]

- [ ] D.1 `ExecEdge.tsx` — straight/orthogonal, grey, arrowhead. _Req: 3.5_
- [ ] D.2 `DataEdge.tsx` — curved, blue, thin, arrowhead. _Req: 4.3–4.4_
- [ ] D.3 `BackEdge.tsx`
  - Curved arc using pre-computed Bezier from `data.bezier`.
  - Dashed stroke, distinct colour (orange or purple).
  - "next" / "again" label midpoint.
  - _Req: 3.2, 6.2_
- [ ] D.4 `SelfEdge.tsx`
  - Self-loop for recursion: arc that exits bottom-right and re-enters top-right
    of the Frame node.
  - ↩ icon on the arrowhead.
  - _Req: 7.1–7.2_

### Workstream E — CanvasEditor assembly

- [ ] E.1 `CanvasEditor.tsx` (§8, §9)
  - Accepts `program: Program` and `dispatch`.
  - Calls `projectProgram` + `autoLayout` on each `program` change (memoised).
  - Renders `<ReactFlow>` with custom node and edge types registered.
  - Passes `nodes` and `edges` as controlled props (read-only for now).
  - `<MiniMap>` hidden by default; `<Controls>` replaced by `CanvasToolbar`.
  - _Req: 2, 3, 4, 9_

- [ ] E.2 `CanvasToolbar.tsx` (§9)
  - Re-layout, Fit (F), 100% (0), −/+, Minimap toggle, Data-flow toggle.
  - Keyboard shortcuts `F` and `0` registered on the canvas root via
    `useKeyPress`.
  - _Req: 9.2–9.5_

- [ ] E.3 Loop collapse/expand
  - `LoopNode` double-click toggles `collapsed` in local state.
  - Collapsed: hide all body nodes and edges (filter from the nodes/edges
    arrays passed to ReactFlow).
  - Badge shows "⟳ N steps inside" (N = body statement count).
  - _Req: 6.5_

- [ ] E.4 Data-flow toggle
  - Toolbar "~ Data flow" button adds/removes CSS class `hide-data-edges`
    on canvas root.
  - `.hide-data-edges .data-edge { display: none; }` in `base.css`.
  - _Req: 4.5_

- [ ] E.5 Checkpoint C+D+E (read-only canvas works)
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`.
  - `pnpm smoke`: switching to canvas mode renders a real graph for the
    "sort by type" starter program; all node shapes visible; minimap and
    data-flow toggles work; zoom in/out works; Fit and Re-layout work.
  - `pnpm e2e`: extend existing e2e suite with 2 canvas smoke tests
    (Chromium only for now): toggle switches view; graph has ≥ 1 node.
  - Commit: `feat(canvas): read-only canvas rendering (phase 2)`.

---

## Phase 3 — Editing on the Canvas [SEQ, integrator]

Goal: wire canvas interactions back to IR mutations so users can edit in canvas
mode.

- [x] 3.1 Node deletion
  - `onNodesDelete` callback: dispatch `REMOVE_STATEMENT` action with the
    deleted node's `irPath`.
  - Test: deleting a sequence node removes the correct statement from the IR;
    undo restores it.
  - _Req: 8.3, 8.6_

- [x] 3.2 Node insertion from palette
  - Palette component (existing `src/editor/Palette.tsx`) gains a
    `draggable` mode active when in canvas mode.
  - `onDrop` on the canvas root: compute target IR position from drop
    coordinates (find nearest edge), dispatch `INSERT_STATEMENT`.
  - Test: drop a "Move file" action onto an exec edge; it appears at the
    correct IR position.
  - _Req: 8.4, 8.6_

- [x] 3.3 Edge reconnection
  - `onConnect` callback: when user drags an edge arrowhead to a new target,
    compute old and new IR positions, dispatch `MOVE_STATEMENT`.
  - Invalid connections (cross-scope, connecting into a closed frame):
    `isValidConnection` returns false; show inline React Flow error handle.
  - Test: reconnecting the out-edge of a node to a different target reorders
    statements; invalid connection is rejected with error.
  - _Req: 8.5, 8.7_

- [!] 3.4 Switch branch add/remove
  - Right-click context menu on Switch node: "Add branch" / "Remove branch".
  - "Add branch": dispatch `INSERT_ELIF` (new action); default branch value
    is an empty string placeholder.
  - "Remove branch": dispatch `REMOVE_ELIF` on the clicked branch port.
  - Test: adding a branch increases elif count in IR; removing decreases it.
  - _Req: 5.3_
  - Blocked: the current IR `If` has only `then` and `else`; adding `elif` would change the existing IR contract, which this phase must preserve.

- [x] 3.5 Drag-to-reposition (layout override)
  - `onNodeDragStop` callback: write updated `{x,y}` into `program.canvas.nodes`
    via a new `UPDATE_CANVAS_LAYOUT` dispatch action (does not affect IR tree).
  - Dispatch is not added to the undo stack (position changes are cosmetic).
  - Test: dragging a node and saving persists the override; re-opening the file
    restores the position.
  - _Req: 8.1–8.2_

- [x] 3.6 Checkpoint 3 (except blocked 3.4)
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm conformance --strict`.
  - `pnpm e2e`: 4 canvas editing tests (Chromium): delete a node; insert from
    palette; drag a node and confirm position survives reload; undo restores
    deleted node.
  - Commit: `feat(canvas): canvas editing (phase 3)`.

Implementation note: This repository has no `src/editor/Palette.tsx` or shared mutation-action reducer. Canvas edits use the existing `editorChanged` store path, node positions persist in optional `ProjectFile.canvas` (outside the IR), and the new canvas-only palette currently exposes the requested “Move file” template.

---

## Phase 4 — Block-mode Switch annotation and Polish [SEQ]

- [ ] 4.1 Block mode Switch annotation (§4.3, Req 5.4)
  - In Block mode, an `if/elif/else` chain whose condition is `switch on
    [variable]` gains a small "Switch" badge in the block header (read-only
    visual hint; the block itself is unchanged).
  - Test: a 3-branch if/elif/else renders the badge; a simple if/else does not.

- [ ] 4.2 Responsive nodes at small zoom
  - At zoom < 50 %, SequenceNode and ConditionNode shrink to icon-only
    representation (drop label text, keep colour and shape).
  - Test: snapshot at 40 % zoom matches icon-only style.
  - _Req: 2.6_

- [ ] 4.3 Accessibility pass
  - Audit canvas mode with axe-core (via `pnpm e2e`): no critical violations.
  - Each node has `role="group"` and a unique `aria-label`.
  - ModeToggle has `aria-pressed`; canvas root has `role="application"` with
    `aria-label="Flow canvas"`.
  - _Req: 1.4_

- [ ] 4.4 `.beep.json` compatibility
  - Open a v1 file (no `canvas` key) in canvas mode: auto-layout runs, no
    error thrown.
  - Save and reload: `canvas` key present but IR unchanged.
  - Run existing conformance suite on the saved file: 56/56 pass.
  - _Req: 10.1–10.5_

- [ ] 4.5 Final requirements review (Phase 4 checkpoint)
  - Walk all acceptance criteria in `requirements.md` (Req 1–10) and verify
    each with a concrete observable check (manual smoke or automated test).
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:py`,
    `pnpm conformance --strict`, `pnpm smoke`, `pnpm e2e`.
  - Write a brief review document and commit it.
  - Commit: `docs(v1.2): final requirements review — all criteria met`.

---

## Known Warts (non-blocking, log for v1.3)

- Mutually recursive functions are out of scope (Req 7.4).
- Inline expression editing on the canvas is deferred (design §12).
- Back-edge routing is heuristic (arc-left); deeply nested loops may overlap.
- `onConnect` write-back for complex cross-scope moves may need refinement.
