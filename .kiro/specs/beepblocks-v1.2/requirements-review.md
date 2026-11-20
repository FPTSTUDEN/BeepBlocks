# BeepBlocks v1.2 Requirements Review

Reviewed 2026-11-20 against `requirements.md`, implementation, focused tests,
browser checks, and strict conformance. “Gap” means the criterion is not met;
“Partial” means only the stated portion is evidenced. This is not an all-clear
sign-off.

| Criterion | Result and concrete check |
|---|---|
| 1.1 | Pass — `App.test.tsx` switches between Blocks and Canvas; toolbar toggle is visible. |
| 1.2 | Pass — both editor branches receive the same `project.program`; switching does not dispatch a program edit. |
| 1.3 | Gap — Blockly and Canvas use separate undo histories; switching modes does not share undo/redo. |
| 1.4 | Pass — native buttons are focusable/Enter/Space activatable and expose `aria-label` and `aria-pressed`; the canvas has the required application role/name. |
| 1.5 | Partial — persistence is tested per project title; identical titles share a key rather than using a stable file identity. |
| 2.1 | Partial — statement projection and sequence count are tested; parity for every IR/block shape is not established. |
| 2.2 | Gap — canvas labels are mapped in projection, not derived from the Block editor’s shared label-generation logic. |
| 2.3 | Pass — custom renderers implement sequence, condition, loop, frame, merge, and terminal shapes; node tests cover representative shapes. |
| 2.4 | Partial — categories have distinct canvas colors, but equivalence to each Block-mode category color is not verified. |
| 2.5 | Pass — bound names render below sequence labels; node test checks the bind name. |
| 2.6 | Unverified — no 1,280 px viewport overflow check is present. |
| 3.1 | Partial — sequence and branch edges are projected; complete “every node’s next execution” coverage is not verified. |
| 3.2 | Pass — back edges are dashed/colored and routed with Bezier controls; `project.test.ts` checks left routing and `BackEdge` renders a label. |
| 3.3 | Gap — condition ports exist, but explicit “yes”/“no” labels are not rendered. |
| 3.4 | Gap — a projected Switch node with match-value branches is not implemented. |
| 3.5 | Pass — custom edge tests check arrow markers. |
| 3.6 | Partial — Dagre excludes cycles and back edges are routed left heuristically; complex crossing avoidance is not verified. |
| 4.1 | Gap — sequence nodes do not expose a `value` output handle. |
| 4.2 | Gap — consuming nodes do not expose corresponding variable input handles. |
| 4.3 | Pass — data edges use a distinct blue stroke. |
| 4.4 | Pass — data edges use a curved path. |
| 4.5 | Pass — Canvas toolbar toggles the `hide-data-edges` class; Canvas editor test checks it. |
| 4.6 | Gap — expression-composite value-node/consumer-port behavior is not implemented or verified. |
| 5.1 | Gap — `SwitchNode` exists, but IR `if` chains are projected as condition nodes rather than Switch nodes. |
| 5.2 | Gap — match values and “otherwise” are not projected as branch labels. |
| 5.3 | Blocked — IR `If` has no `elif` representation; task 3.4 records the compatibility blocker. |
| 5.4 | Pass — Block mode annotates qualifying same-variable equality chains with “Switch on: [variable]”; a 3-branch chain and plain if/else are tested. |
| 5.5 | Partial — ordinary if/else merge edges and a return branch are tested; generalized multi-branch convergence is not. |
| 6.1 | Partial — `while` and `forEach` produce back edges; composite repeat/until loop forms are not projected as loop nodes. |
| 6.2 | Pass — back-edge renderer labels the route “again” by default. |
| 6.3 | Gap — loop exit edges are not labelled “done”. |
| 6.4 | Gap — loop-body nodes do not have the required grouped background tint. |
| 6.5 | Pass — double-click collapse hides loop body nodes/edges; Canvas editor test verifies body removal. |
| 7.1 | Partial — direct recursive calls at the function body’s top level get a self-edge; nested call detection is not established. |
| 7.2 | Pass — self-edge uses a distinct edge type/marker; edge renderer tests cover markers. |
| 7.3 | Partial — direct-recursion detection sets the frame badge; nested recursion and collapsed-frame visibility are not verified. |
| 7.4 | Pass — mutually recursive functions are explicitly deferred in design §12. |
| 8.1 | Pass — Chromium E2E drags a node, checks autosaved coordinates, reloads, and checks position restoration. |
| 8.2 | Partial — React Flow owns live edge updates during drags; no dedicated assertion checks rerouting while dragging. |
| 8.3 | Pass — Chromium E2E deletes a node and verifies undo restores it. |
| 8.4 | Partial — a Canvas-specific palette supports the tested “Move file” item; it is not the same full palette as Block mode. |
| 8.5 | Pass — Chromium E2E reconnects an execution edge and checks statement order. |
| 8.6 | Partial — Canvas edits have local undo; history is not shared with Block mode (see 1.3). |
| 8.7 | Partial — cross-scope reorder rejection is unit-tested and invalid attempts show inline status; browser rejection/error feedback is not asserted. |
| 9.1 | Pass — Dagre auto-layout is used; unit tests verify top-to-bottom sequence order. |
| 9.2 | Pass — Re-layout clears overrides and is exposed by the toolbar. |
| 9.3 | Pass — React Flow zoom is constrained to 25–300%; pinch/scroll use React Flow defaults. |
| 9.4 | Pass — toolbar Fit/100% controls and F/0 shortcuts are wired. |
| 9.5 | Pass — MiniMap toggle is tested in Canvas editor tests. |
| 10.1 | Pass — Chromium E2E opens a v1 project without canvas metadata, auto-layouts, and saves canvas metadata. |
| 10.2 | Pass — strict conformance remains unchanged and passes 56/56 fixtures. |
| 10.3 | Pass — project round-trip tests assert canvas metadata does not alter program IR. |
| 10.4 | Partial — v1 projects are exercised; v2-without-canvas is supported by the parser but lacks a dedicated browser round-trip test. |
| 10.5 | Pass — Canvas is optional project metadata; project format version remains 1 and no IR/exporter version change was made. |

## Validation

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test` — 3,991 tests passed across 42 files.
- `pnpm conformance --strict` — 56/56 fixtures passed; all 13 error codes covered.
- `pnpm smoke` — passed; existing browser smoke axe audits were clean.
- `pnpm e2e` — Chromium passed; Firefox had a transient timeout on the first
  starter in the combined run. A separate `pnpm e2e firefox` rerun passed all
  four starters. Chromium Phase 4 checks passed, including its axe audit,
  compact zoom, and v1 file round-trip.
- `pnpm test:py` — not run; Python environment setup was declined. No venv was
  created.

## Remaining work

The Phase 4 items 4.1–4.4 are implemented and verified. The Phase 4 checkpoint
is blocked by the skipped Python suite and the prior-phase gaps above, notably
shared undo across modes, Switch projection/branch editing, and data ports.
