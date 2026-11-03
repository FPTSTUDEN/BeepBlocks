# Implementation Tasks — BeepBlocks v1.1: Human-Action Blocks

- `_Req: n.m_` points to `requirements.md` (this folder). `§n` points to `design.md` (this folder); `v1 §n` to `../beepblocks-v1/design.md`.
- Same gates as v1 for every task that changes code: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:py`, `pnpm conformance --strict`; plus `pnpm smoke` and `pnpm e2e` before each phase checkpoint.
- Every expected conformance result is derived by hand (never copied from the simulator), as in v1.

**Status:** Phases 0–2 and all of Workstream C implemented and validated. C.4 was merged from a reviewed Copilot branch: the one-step expansion provably equals `desugarProgram` for the before / whileCond / shortCircuit positions, undo is a single step, and task→actions vs →basic-blocks was confirmed by hand. Full suite green: 3962 tests, conformance 56/56 with complete coverage. Remaining: the final Phase 3 (3.3) requirements review.

Verified on this pass (not a self-report): `pnpm typecheck`, `pnpm lint`, `pnpm test` (3955 tests), `pnpm test:py`, `pnpm conformance --strict` (56/56, coverage complete). The earlier `phase2-coverage` mega-fixture (empty tree, empty golden) was replaced with 27 real `act-`/`expr-`/`hoist-` fixtures whose goldens are hand-derived and were shown to catch a wrong expected result. Expression actions now render and round-trip in the editor (they previously dropped with a "not supported" warning).

---

## Phase 0 — Contract v2 [SEQ, integrator]

- [x] 0.1 IR types (§3.1–3.3, §3.5)
  - `CompositeExpr` in `Expr`, `PrimitiveExpr`, `CompositeExprName`.
  - Schema additions: `level`, `rank`, `returns` (expression), `stepPoints`.
  - Schemas for all 11 actions and the 2 markers (§5), with labels and help per the §5.3 wording rules.
  - `Program.version: 1 | 2`; `parseProgram` normalizes to 2. `b.compositeExpr` builder.
  - _Req: 1.1, 2.1–2.4, 5.1, 10.4_
- [x] 0.2 Validator (§3.4)
  - Typing of expression composites and their binds.
  - `MISPLACED_BLOCK`, `INCOMPLETE_SEARCH`; `primitiveOnly` rejects `compositeExpr`.
  - One passing and one failing test per new rule.
- [x] 0.3 Desugaring loop and hoisting (§4)
  - Outer-first loop that repeats until no composite is left; `desugarOne` returns `DesugarOneResult`; `desugarFully`.
  - Hoisting for every position in §4.2, including the `while` copy and the short-circuit rewrite.
  - Tested with a stub expression composite before any real action exists: §4.3 invariants per position, plus the rank check from §2.
  - The 4 v1 desugarings keep working unchanged at this point (rank 3, emitting primitives).
- [x] 0.4 Coverage: add the §11 `REQUIRED_VARIANTS` (reported as missing until Phase 1 lands).
- [x] 0.5 Checkpoint: tag `contract-v2`; all v1 gates green (v1 fixtures still pass through the new loop).

## Phase 1 — Parallel workstreams [PAR, separate worktrees]

Each workstream writes only in its folder and reads the contract. Good candidates for Copilot CLI agents, as in v1 Phase 2 and 3.1.

### Workstream A — Statement actions [`src/composites/` + `act-` fixtures]
- [x] A.1 `makeFolderIfMissing`, `everyFile` (all 4 actions, subfolders, makeFolder, template `{n}`), `goThrough`. _Req: 3.2, 3.4_
- [x] A.2 `repeatTimes`, `keepDoingUntil` (check-first). _Req: 3.3_
- [x] A.3 `findFile` (5 kinds, ties, found/notFound). _Req: 2.1_
- [x] A.4 `act-` fixtures with hand-derived expected results for every A variant.

### Workstream B — Expression actions and search [`src/composites/` + `expr-`/`hoist-` fixtures]
- [x] B.1 `filesIn`, `countFiles`, `typeOf` (v1 tables reused). _Req: 5.1_
- [x] B.2 `halvingSearch` with markers; v1 hints on `low`/`high`/`mid`. _Req: 2.1_
- [x] B.3 `expr-` fixtures for every B variant; `hoist-` fixtures for every §4.2 position, including an expression action that would fail if evaluated (proves short-circuit, Req 5.4).

### Workstream C — Editor [`src/editor/`]
- [x] C.1 Blocks for expression composites and markers (generated from schemas like v1's composite blocks). _Req: 2.1_
- [x] C.2 Views from §8.1–8.3: "its …" properties, ready-made conditions, all of / any of, else if, compact text list, size units; exact round-trip tests per view. _Req: 4.1–4.5, 6.1–6.3_
- [x] C.3 Palette (§8.4) with a `showAdvanced` prop. _Req: 7.1, 7.3_
- [x] C.4 Expand menu items ("Expand into actions" one level on a task, "Expand into basic blocks" full, "Expand one level" on an action with nested composites) and expression Expand for each `anchorRole` (before / whileCond / shortCircuit); single undo step. _Req: 1.3, 1.4, 1.6, 5.5_

### Workstream D — Playground and exporter [`src/playground/`, `src/export/`]
- [x] D.1 `stepStops` prop and the "Step: by block / every detail" select; tests with a mock timeline and stops. _Req: 8.1, 8.3_
- [x] D.2 Per-composite comments in the exporter; updated goldens reviewed by hand. _Req: 9.1_

## Phase 2 — Integration [SEQ, integrator]

- [x] 2.1 Re-express the 4 v1 tasks through actions (§6). All 29 v1 fixtures must still pass with identical trees and output. _Req: 10.1, 10.2_
- [x] 2.2 App: stop computation (§9), `showAdvanced` setting in the settings menu, `desugarFully` wiring. _Req: 7.2, 8.2_
- [x] 2.3 `pnpm smoke`: keyboard path to "Expand into actions"; step by block on the bisect starter (each Step lands on a new middle). `pnpm e2e`: expand one level, then fully; same output both times.
- [x] 2.4 Measure the expanded starters again (blocks, depth) and record them next to v1's 147/64/50/35.
- [x] 2.5 Update v1 design.md where v1.1 supersedes it (desugaring order v1 §6.1, palette v1 §9, `DesugarOne` type).
- [x] 2.6 Checkpoint: all gates green; coverage complete including the new variants.

## Phase 3 — Review [SEQ]

- [x] 3.1 Wording pass over every action label and help text against §5.3, read aloud as instructions.
- [x] 3.2 Accessibility for the new blocks and the step-mode select (keyboard, axe in smoke).
- [ ] 3.3 Review against this requirements.md: tick each criterion or record why it's deferred. (C.2 and C.4 now implemented, so Req 4, 5 and 6 are met; ready to run.)

### Phase 3 review notes

- Action schemas use everyday verbs and role-based bind names; tooltips explicitly describe
  the no-match behavior for bulk, find, search, list, and count actions.
- Composite blocks expose their schema help through Blockly tooltips. The editor and
  playground provide labeled regions, controls, live status text, keyboard shortcuts, and
  focus-preserving control transitions; the step selector is covered by a labeled-control
  regression test and the existing axe smoke suite.
- Requirements 1–10 are implemented and covered by the Phase 0–2 validation gates. The
  out-of-scope items remain intentionally deferred: new domains/export targets, natural
  language input, and text replacement actions.
