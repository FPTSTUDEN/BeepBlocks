# Requirements Document — BeepBlocks v1.2: Flow Canvas

## Introduction

v1.1 made programs readable as a stack of blocks. That model is excellent for
straight sequences, but three constructs remain hard to understand just by
reading a vertical pile:

- **Branching** — an `if / elif / else` staircase forces the reader to track
  indentation depth to see which branch is which.
- **Loops** — the "back-edge" (after the body, go back to the condition) is
  invisible; learners have to know what a loop *means* rather than *see* it.
- **Recursion** — a function that calls itself looks identical to any other call;
  there is no visual cue that "this restarts the whole thing."

v1.2 adds a **Flow Canvas** editing mode: an interactive node-and-wire diagram
where control-flow edges are literal arrows. Users switch between the existing
Block mode and the new Canvas mode at any time; both operate on the same IR and
produce identical programs.

The Python exporter, simulator, and conformance suite are **unchanged**.
Canvas mode is a view + edit layer only.

## Glossary

- **Canvas mode** — The new flow-diagram editing surface, as opposed to the
  existing "Block mode" (stack of blocks in a vertical list).
- **Flow node** — A box on the canvas representing one block (action, task,
  primitive, or expression).
- **Execution edge** — A directed arrow representing "this node runs next."
- **Data edge** — A coloured wire representing a value flowing from where it is
  produced to where it is used.
- **Port** — A named connection point on a node where edges attach.
  Sequence nodes have one `in` and one `out` port.
  Condition nodes have one `in`, one `true` port, and one `false` port.
  Loop nodes have one `in`, one `loop-body` port, and one `done` port.
  Expression nodes have a `value` output port.
- **Merge node** — A small junction node (◆) where two or more execution edges
  rejoin into one.
- **Back-edge** — An execution edge that points from a later node back to an
  earlier one, making a cycle (loops, recursion).
- **Function frame** — A rounded rectangle that visually contains all nodes of
  a function body; a recursive call inside it draws a self-edge back to the
  frame's entry port.
- **Auto-layout** — Automatic placement of nodes using a directed-graph layout
  algorithm (Dagre/ELK). Applied on first render and on demand.
- **Layout override** — A per-node `{x, y}` position stored in the `.beep.json`
  file when the user drags a node away from its auto-layout position.

## Requirements

### Requirement 1: Canvas / Block Mode Toggle

**User Story:** As a user, I want to switch between the familiar block stack and
the new flow diagram without losing any work, so I can use whichever view helps
me most at any moment.

#### Acceptance Criteria

1. THE editor SHALL provide a toggle ("Blocks / Canvas") visible at all times
   in the editor toolbar.
2. SWITCHING modes SHALL NOT change the program — the same IR is rendered in
   both views.
3. SWITCHING modes SHALL preserve the undo/redo stack; operations done in one
   mode SHALL be undoable in the other.
4. The toggle SHALL be accessible by keyboard (focusable, activatable with
   Enter/Space) and SHALL carry an ARIA label.
5. THE editor SHALL remember the last-used mode per file and restore it on
   re-open.

### Requirement 2: Node Representation

**User Story:** As a user reading a flow diagram, I want each block to look like
a clearly labelled box so I can tell at a glance what it does and what kind of
node it is.

#### Acceptance Criteria

1. EACH block in the program SHALL be rendered as exactly one flow node.
2. THE node SHALL display the same label as the block shows in Block mode
   (using the same label-generation logic, not a separate copy).
3. Node shape SHALL signal node kind:
   - Sequence (action / primitive with one in and one out): rectangle.
   - Condition (`if`, composite condition): diamond ◇.
   - Loop head (`while`, `for each`, `repeat`, `keep doing until`): rounded
     rectangle with a small loop icon.
   - Function frame: outer rounded rect surrounding child nodes.
   - Merge point: small filled diamond ◆.
   - Start / End of a scope: pill-shaped terminals.
4. Node colour SHALL match the category colour used in Block mode (file ops,
   control flow, search, math, etc.).
5. A node SHALL show its bound variable name(s) below the label in a muted
   style (e.g. "→ file" or "→ largest").
6. Nodes SHALL be readable at the default zoom level (100 %) without
   horizontal overflow on a 1 280 px viewport.

### Requirement 3: Execution Edges

**User Story:** As a learner, I want to see arrows that show exactly what runs
after what, including the back-edges in loops, so I can trace a program by
following arrows.

#### Acceptance Criteria

1. THE canvas SHALL draw an execution edge from every node's `out` (or
   `loop-body`, `true`, `false`) port to the first node that runs next.
2. LOOP back-edges SHALL be drawn as curved arrows that visually arc back to
   the loop-head node; they SHALL be styled differently from forward edges
   (dashed or a distinct colour) so the cycle is immediately recognisable.
3. Branching edges (`true` / `false`) SHALL be labelled "yes" / "no" at the
   source port.
4. Switch / multi-branch edges SHALL each carry the branch value as a label.
5. ALL edges SHALL have arrowheads indicating direction.
6. Edge routing SHALL avoid crossing node boxes where possible; the layout
   algorithm SHALL treat back-edges specially to minimise visual clutter.

### Requirement 4: Data Edges

**User Story:** As a learner, I want to see where a value comes from and where
it goes, so I understand how information moves through the program without
reading every line.

#### Acceptance Criteria

1. EVERY bound variable (produced by a node) SHALL have a `value` output port.
2. EVERY use of a bound variable SHALL have a corresponding input port on the
   consuming node.
3. Data edges SHALL be drawn in a distinct colour (blue) separate from
   execution edges (grey/black).
4. Data edges SHALL be drawn as thin curved lines to distinguish them visually
   from execution edges.
5. THE canvas SHALL allow hiding all data edges via a "Show data flow" toggle
   in the canvas toolbar, to reduce clutter when not needed.
6. Expression composite nodes SHALL show their `value` output port; the data
   edge SHALL connect to the port of the statement that consumes the value
   (after hoisting, the consumer is the hoisted-before statement).

### Requirement 5: Switch / Multi-Branch Node

**User Story:** As a user with multi-way branching logic, I want a Switch node
that fans out to each branch label, so I don't have to stack `elif` blocks and
lose track of which case is which.

#### Acceptance Criteria

1. THE system SHALL provide a **Switch** node usable in Canvas mode that maps
   directly to `if / elif / else` chains in the IR.
2. EACH branch port on the Switch node SHALL be labelled with its match value
   or "otherwise" for the default branch.
3. ADDING or removing a branch SHALL insert or remove an `elif` clause in the
   IR.
4. IN Block mode, a Switch displayed as an `if / elif / else` chain SHALL be
   visually annotated as "Switch on: [variable]" so the user understands the
   two views are the same thing.
5. ALL branches SHALL converge at a Merge node after their last action (unless
   a branch ends with a `return` or `break`, in which case that branch has no
   outgoing execution edge to the merge).

### Requirement 6: Loop Visualisation

**User Story:** As a learner, I want to see the loop-back arrow so I understand
that "after each file, the program comes back here", without needing to know
what a while-loop or for-loop is.

#### Acceptance Criteria

1. EVERY loop node (`while`, `for each`, `repeat n times`, `keep doing until`)
   SHALL render with a visible back-edge arrow that returns from the last node
   of the loop body to the loop head.
2. THE back-edge SHALL be labelled "next" or "again" in a muted style.
3. THE exit edge from the loop head (taken when the condition is false / count
   is exhausted) SHALL be labelled "done".
4. THE loop body nodes SHALL be visually grouped (light background tint) to
   make clear which nodes are inside the loop.
5. COLLAPSING a loop node (double-click on loop head) SHALL hide the body nodes
   and back-edge, showing only the loop head with a "⟳ N steps inside" badge.
   Expanding restores the full body.

### Requirement 7: Recursion Visualisation

**User Story:** As an intermediate learner, I want to see when a function calls
itself, so I understand what recursion looks like before I need to understand
why it works.

#### Acceptance Criteria

1. A recursive call node (a call whose target is the enclosing function) SHALL
   render with a self-edge: an arrow that exits the call node and re-enters the
   function frame's entry port.
2. THE self-edge SHALL be styled with a distinct marker (↩ icon or spiral
   arrowhead) to distinguish it from an ordinary back-edge.
3. THE function frame SHALL display a small "(calls itself)" badge when it
   contains at least one recursive call, visible even when the frame is
   collapsed.
4. MUTUALLY recursive functions (A calls B, B calls A) are out of scope for
   v1.2.

### Requirement 8: Editing on the Canvas

**User Story:** As a user, I want to rearrange nodes on the canvas and connect
them by drawing wires, so I can build programs visually without switching to
Block mode.

#### Acceptance Criteria

1. THE user SHALL be able to drag any node to a new position; the position SHALL
   be stored as a layout override in `.beep.json` and SHALL survive save/reload.
2. DRAGGING a node SHALL update connected edges in real time (live re-routing).
3. THE user SHALL be able to delete a node by selecting it and pressing Delete /
   Backspace, with the same effect as deleting the block in Block mode.
4. THE user SHALL be able to add a node by dragging a block from the palette
   (the same palette as Block mode) onto the canvas; it SHALL be inserted at the
   correct position in the IR based on where it is dropped relative to existing
   edges.
5. THE user SHALL be able to reconnect an execution edge by dragging its
   arrowhead to a new target port; the IR SHALL update to match.
6. ALL edits on the canvas SHALL be undoable in a single undo step (consistent
   with v1 Req 4.4).
7. THE canvas SHALL prevent wiring that would produce an invalid program (e.g.
   connecting the `out` of a node that is inside a loop to a node outside it);
   invalid connection attempts SHALL be rejected with a brief inline error.

### Requirement 9: Auto-Layout and Zoom

**User Story:** As a user, I want the diagram to lay itself out clearly when I
open it, so I don't have to drag every node into place manually.

#### Acceptance Criteria

1. ON first render (no stored layout overrides), nodes SHALL be placed by an
   auto-layout algorithm that produces a top-to-bottom execution flow for
   straight sequences and left-to-right fan-out for branches.
2. THE user SHALL be able to trigger auto-layout at any time via a "Re-layout"
   button; existing layout overrides SHALL be cleared.
3. THE canvas SHALL support pinch-to-zoom and scroll-to-zoom; zoom range SHALL
   be 25 % – 300 %.
4. THE canvas SHALL provide "Fit to screen" (keyboard shortcut `F`) and "Reset
   zoom" (keyboard shortcut `0`) buttons.
5. MINIMAP — a small overview panel in the corner — SHALL show all nodes at a
   reduced scale and highlight the current viewport rectangle; it SHALL be
   toggleable.

### Requirement 10: File Format Compatibility

**User Story:** As a user with existing `.beep.json` files, I want them to open
in Canvas mode without any migration step, so I don't have to do extra work.

#### Acceptance Criteria

1. CANVAS layout data SHALL be stored under an optional top-level key
   `"canvas"` in `.beep.json`; files without this key SHALL open in Canvas mode
   with a fresh auto-layout.
2. The `"canvas"` key SHALL be ignored by the simulator, Python exporter, and
   conformance runner.
3. Files saved from Canvas mode SHALL load correctly in Block mode and vice
   versa; the IR MUST be identical regardless of which mode saved the file.
4. v1 and v1.1 files (format versions 1 and 2) SHALL open in Canvas mode
   without error; a missing `"canvas"` key is treated as an empty object.
5. THE format version SHALL NOT be bumped for Canvas; layout is cosmetic
   metadata, not IR data.
