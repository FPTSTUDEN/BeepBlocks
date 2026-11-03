# Design Document — BeepBlocks v1.1: Human-Action Blocks

This document extends `../beepblocks-v1/design.md` (cited as "v1 §n"). Everything not mentioned here is unchanged.

## 1. Overview

v1.1 adds a level of **action** composites between v1's tasks and primitives, and a few editor-only views that make conditions and the primitive level readable. The core v1 rule is unchanged: **one IR, two interpreters**, and every composite is a pure desugaring into primitives. The simulator, the Python runtime and the conformance runner are not changed at all.

What changes:

| Area | Change |
|---|---|
| IR | Composites in expression positions (`compositeExpr`), composite ranks, format version 2 |
| Composites | Outer-first desugaring repeated until no composite is left; hoisting of expression actions; 11 action blocks; the 4 v1 tasks re-expressed through actions |
| Editor | Level-by-level Expand, "its …" property and condition blocks, "all of / any of", else-if arms, compact text lists, size units, a default and an advanced palette |
| Playground / app | "Step by block" playback (a list of stop indices computed by the app) |
| Exporter | One `# [block …]` comment per task and per action, nested ones included |

### 1.1 Example: "Find the first failing night" after one Expand

```
remember the files in [the top folder], lined up by name, as (files)
search (files) by halving, looking at the middle one as (log)
    decide:
        if (log)'s text contains "status: ERROR"
            keep the left half, including the middle
        else
            keep the right half
    when one is left, as (failed):
        show "First failing night: " + (failed)'s name
    if none is left:
        show "Every night passed."
```

Expanding "search … by halving" gives the v1 primitives (`low`, `high`, `mid`, `while low < high`), with the same probe sequence and the same position gutter.

## 2. Levels and Ranks

Every composite schema gains:

```ts
level: 'task' | 'action';
/** A desugaring may only emit composites with a strictly lower rank (checked by a unit test). */
rank: number;
```

| Rank | Composites |
|---|---|
| 3 | the four v1 tasks: `renameByPattern`, `sortByType`, `findAndAct`, `findFirst` |
| 2 | `everyFile` (it can emit `makeFolderIfMissing`) |
| 1 | every other action |
| 0 | primitives |

Because each desugaring step strictly lowers the rank, desugaring always terminates. A unit test desugars every variant of every composite by one step and checks the ranks of what it emits.

## 3. IR Changes (contract v2)

### 3.1 Expression composites

```ts
// src/ir/composites.ts
export interface CompositeExpr {
  id: NodeId;
  kind: 'compositeExpr';
  name: CompositeExprName;               // 'filesIn' | 'countFiles' | 'typeOf'
  fields: Record<string, FieldValue>;
  inputs: Record<string, Expr>;
  binds: Record<string, string>;          // e.g. { file: 'file' } visible in the condition input
}

// src/ir/types.ts
export type Expr = Lit | DateLit | ListLit | Var | Binary | Unary | OpExpr | CallExpr | CompositeExpr;
export type PrimitiveExpr = Exclude<Expr, CompositeExpr>;
```

An expression schema adds `returns: Type`. Expression composites have no `bodies`.

### 3.2 Desugar results

```ts
export interface CompositeDef extends CompositeSchema {
  desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[];
}
export interface CompositeExprDef extends CompositeExprSchema {
  /** `pre` runs before the enclosing statement; `value` replaces the node. */
  desugar(node: CompositeExpr, ctx: DesugarCtx): { pre: Stmt[]; value: Expr };
}

export type DesugarOneResult =
  | { kind: 'stmt'; stmts: Stmt[] }
  | { kind: 'expr'; pre: Stmt[]; value: Expr; anchor: NodeId; anchorRole: 'before' | 'whileCond' | 'shortCircuit' };
export type DesugarOne = (program: Program, compositeId: NodeId) => DesugarOneResult;
/** Expands every composite inside `compositeId` all the way down (editor "Expand into basic blocks"). */
export type DesugarFully = (program: Program, compositeId: NodeId) => DesugarOneResult;
```

`DesugarCtx` is unchanged.

### 3.3 Marker statements

`keepLeftHalf` and `keepRightHalf` are statement composites with no fields, inputs or binds. They are only valid inside the `decide` body of a `halvingSearch`, at any depth of `if`/`else` but not inside another composite or a loop. The search's own desugaring replaces them, so they never reach the general desugaring loop.

### 3.4 Validation rules (additions)

- An expression composite's type is its schema's `returns`. Inputs and binds are checked as for statement composites.
- `MISPLACED_BLOCK`: a marker outside a `halvingSearch.decide` body (or inside a loop or another composite within it).
- `INCOMPLETE_SEARCH`: some path through `decide` ends without a marker. Every path must end in exactly one marker, and a marker must be the last statement on its path.
- `primitiveOnly` now also rejects `compositeExpr`.
- Names reserved as before. Bind defaults (`file`, `middle`, `answer`) are ordinary user names.

### 3.5 Format

`Program.version` becomes `1 | 2`. The app writes 2. A v1 program is a valid v2 program, so `parseProgram`/`parseProject` accept both and normalize to 2. A v1 app reading a v2 file already fails with "This project uses format version 2" (v1 §13).

## 4. Desugaring Algorithm

### 4.1 Outer-first, repeated until no composites remain

v1 desugared innermost first, in one pass. v1.1 desugars **outermost first and repeats**:

```
loop:
  walk the scope's statements in order
  the first composite found (statement or expression, outermost first) is desugared in place
  repeat until no composite is left
```

Outer-first is required because:
1. `halvingSearch` must see its markers before anything else touches them.
2. An outer action creates the positions (loop bodies, `if` conditions) that inner expression actions are hoisted into.

Determinism and hygiene stay as in v1: one `used` name set per scope, shared by every step. Temporaries may be numbered differently from v1 (`n_2` vs `n`) because the order changed. This only affects exporter goldens, which are re-reviewed by hand (§11).

`desugarOne` performs exactly one step on the named composite. `desugarFully` repeats until no composite is left inside the original composite's replacement.

### 4.2 Hoisting expression composites

When the composite being desugared is a `compositeExpr` X with result `{ pre, value }`, X is replaced by `value`, and `pre` is placed according to X's position. The positions are tried in this order:

| Position of X | Placement of `pre` |
|---|---|
| Right operand of `and`/`or` (at any depth inside that operand) | The binary is rewritten first (below), then hoisted normally |
| Condition of `while` W | `pre` before W **and** a copy of `pre` (with fresh derived ids `X/again/…`) as the last statements of W's body |
| Anywhere else in statement S (assign value, `if` condition, `forEach` list, `do`, `print`, `return`, call arguments, op arguments) | `pre` immediately before S |

**Short-circuit rewrite.** `L and R`, where R contains X, inside statement S:

```
ok = L                     # fresh temp, derived id X/sc.left
if ok:                     # X/sc.if
    ok = R                 # X/sc.right, R still contains X → hoisted into this statement next
S with (L and R) replaced by ok
```

`or` is the same with `if not ok`. Nested chains rewrite one level per step. The result keeps short-circuit behavior: R's statements run only when R is evaluated.

**Evaluation order.** `pre` runs before every other part of S, as Req 5.2 requires. Errors raised inside `pre` report X's derived ids, which resolve to X's block in the editor.

**No `break`.** IR has no `break`/`continue`, so the `while` copy at the end of the body always runs before the next check. A `return` inside the body leaves the loop anyway.

### 4.3 Invariants (tested)

For every composite variant and every hoisting position:
- the desugared program passes `validateProgram(p, { primitiveOnly: true })`;
- every created node has a derived id unique in the program;
- each input expression appears exactly once (v1 §6.1), except where documented (the `while` copy re-evaluates X by design, using fresh ids).

## 5. Action Vocabulary

Notation: `F` = folder input, `C` = condition input (sees the bind), `D` = destination input (sees the bind). Unset optional inputs and fields are not emitted.

### 5.1 Statement actions

| Name | Block label | Fields / inputs / binds | Desugars to (rank) |
|---|---|---|---|
| `everyFile` | **[move / copy / delete / rename]** every file in [F] *(including subfolders)* where [C] *into [D] (making the folder if it's missing)* / *to [template]* | action, includeSubfolders, makeFolder; F, C?, D (move/copy); bind `file` | 2 |
| `makeFolderIfMissing` | **make folder** [path] **if it's missing** | path | 1 |
| `goThrough` *(advanced)* | **go through** the files in [F] *(including subfolders)* **one by one**, as (file) | includeSubfolders; F; bind `file`; body | 1 |
| `repeatTimes` | **repeat** [n] **times** | n (number); body | 1 |
| `keepDoingUntil` | **keep doing** … **until** [C] | C (bool); body | 1 |
| `findFile` | **find the [first / biggest / smallest / newest / oldest] file** in [F] *(including subfolders)* where [C], as (file) | which, includeSubfolders; F, C?; binds `file` (in C), `found` (in found body); bodies found, notFound | 1 |
| `halvingSearch` | **search** [line] **by halving, looking at the middle one** as (middle) | line (list of path); binds `middle` (in decide), `answer` (in found); bodies decide, found, notFound | 1 |
| `keepLeftHalf` | **keep the left half, including the middle** | marker | — |
| `keepRightHalf` | **keep the right half** | marker | — |

Semantics:

- **`everyFile`.** `items = fs.walk(F)` or `fs.list(F)` (then folders skipped), evaluated once. Each file that satisfies C (all of them when C is unset) gets the action, in listing order (v1 §5.3).
  - move/copy: `D` is evaluated per file (it may use `file`). With `makeFolder`, a `makeFolderIfMissing(D)` comes first. A file already directly inside D is skipped, as in v1's `findAndAct`.
  - rename: the v1 template language (v1 §6.2). `{n}` counts files that satisfy C, and the rename is skipped when the name is unchanged.
  - delete: `fs.delete(file)`.
- **`makeFolderIfMissing(P)`.** `p = P; if not fs.exists(p): fs.makeFolder(p)`. If P exists as a file, the later move fails with v1's errors, unchanged.
- **`goThrough`.** `for file in items: if not fs.isFolder(file): body`.
- **`repeatTimes(n)`.** `k = n; while k > 0: body; k = k - 1`. Non-integral n is a validation error if literal; otherwise `math.floor` is applied.
- **`keepDoingUntil(C)`.** `while not C: body`. It checks before each round, so the body runs zero times if C is already true. The step limit (v1 Req 6.5) catches runaway loops.
- **`findFile`.**
  - `first`: scan in listing order and stop at the first match. Implemented with `i`, `n`, `hit` and `while i < n and not hit` (no `break` in IR).
  - `biggest`/`smallest`/`newest`/`oldest`: a full scan keeping the best so far. Ties keep the earlier file in listing order.
  - After the scan, `found` runs with the bound file, otherwise `notFound`.
- **`halvingSearch(line)`.** Exactly v1 `findFirst` from `low = 0` onward (v1 §6.2). `middle = line[mid]`, `decide` runs with `keepLeftHalf` → `high = mid` and `keepRightHalf` → `low = mid + 1`, then `found` with `answer = line[low]` if `low < len(line)`, otherwise `notFound`. Hints `indexInto: line` on `low`/`high`/`mid` keep the v1 position gutter.

### 5.2 Expression actions

| Name | Block label | Returns | Desugars to `{ pre; value }` |
|---|---|---|---|
| `filesIn` | **the files in** [F] *(including subfolders)* where [C], **lined up by** [listing order / name / date / size] *(largest/newest first)* | list of path | collect loop into a fresh list `files`, then `list.sortBy` if a key is set; value `files` |
| `countFiles` | **how many files** in [F] *(including subfolders)* where [C] | number | counting loop; value `count` |
| `typeOf` | **the type of** [file] *(by [category / extension])* | text | `ext = lower(ext(file))`, then the v1 category chain or the extension rule; value `type` |

`typeOf` uses exactly v1's tables (`CATEGORIES`, `Other`, `No extension`).

### 5.3 Wording rules (for labels, help and future actions)

1. Lead with an everyday verb or question: make, move, copy, delete, rename, find, look at, keep, line up, how many, the type of.
2. Never show `=`, `//`, `%`, `and`/`or`, list positions, or the word "variable". Those appear only in advanced blocks.
3. Name bound values by role (`file`, `middle`, `answer`); the user can rename them.
4. Optional parts read as an aside in parentheses and are hidden when unset (Blockly inputs shown on demand).
5. Help text says what happens with no matches ("does nothing", "runs 'if none is left'").

## 6. The v1 Tasks, Re-expressed

Fields and behavior are unchanged (Req 10.1). Each input is evaluated once (v1 §6.1), via a temporary where it's needed twice.

| Task | One level down |
|---|---|
| `sortByType(grouping)` | `folder = F`; `everyFile(move, F = folder, D = fs.join(folder, typeOf(file, grouping)), makeFolder = yes)` |
| `renameByPattern(match, template)` | `everyFile(rename, F, C = its name matches MATCH, template)` |
| `findAndAct(…)` | `everyFile(action, F, includeSubfolders = recursive, C = all of the set criteria, D, template)` (criteria as in v1 §6.1, rendered with the §8.2 condition blocks) |
| `findFirst(sortBy, C, found, notFound)` | `files = filesIn(F, lined up by sortBy)`; `halvingSearch(files, decide = if C: keepLeftHalf else keepRightHalf, found, notFound)` with `middle`/`answer` bound to the task's `candidate`/`match` names |

`sortByType` previously computed `target` once per file and created it if missing. The new version does the same through `makeFolderIfMissing(D)` and then `fs.move(file, D)`, which produces the same MKDIR/MOVE output lines in the same order.

## 7. Expand

- **Menu items** (block context menu, also reachable with Ctrl+Enter, v1 §9):
  - tasks: "Expand into actions" (one step), "Expand into basic blocks" (all the way);
  - actions: "Expand into basic blocks". An action with nested actions also offers "Expand one level".
- **Statement result:** as in v1 (one event group, single undo).
- **Expression result:** `value` replaces the block in its socket and `pre` is inserted according to `anchorRole`:
  - `before`: before the anchor statement;
  - `whileCond`: before the `while` and at the end of its body;
  - `shortCircuit`: the rewrite from §4.2.

  The editor applies the whole change inside one event group.
- `irToWs` places the new blocks; positions of other top-level stacks are unchanged.

## 8. Editor Views (no IR change)

Each view is a Blockly block whose `wsToIr` output is a fixed IR shape. `irToWs` recognizes the shape and picks the view, falling back to the generic primitive blocks otherwise. Ids of every node in the shape are stored in the block's extra state, so round trips are exact (tested for every view).

### 8.1 "It" property blocks

Within a condition or destination input that sees a bind `b` of the **nearest enclosing** bulk/find/group block:

| Block | IR shape |
|---|---|
| its name | `fs.name(var b)` |
| its name without extension | `fs.stem(var b)` |
| its extension | `fs.ext(var b)` |
| its size | `fs.size(var b)` |
| when it was last changed | `fs.modified(var b)` |
| its text | `fs.readText(var b)` |
| it's a folder | `fs.isFolder(var b)` |

If the block is moved outside such an input, it turns into the generic block with a "(file) is not available here" warning (v1 validation: unknown variable).

### 8.2 Ready-made conditions

| Block | IR shape |
|---|---|
| its name matches [pattern] | `text.wildcard(fs.name(var b), lit)` |
| its extension is [ext] | `text.lower(fs.ext(var b)) == lit` (leading dot stripped, lower-cased as in v1 `findAndAct`) |
| it's bigger than / at least / smaller than / at most [size] | `fs.size(var b) > / >= / < / <= lit` |
| it was changed after / on or after / before [date] | `fs.modified(var b) > / >= / < date` |
| its text contains [text] | `text.contains(fs.readText(var b), lit)` |

### 8.3 Other views

- **all of / any of:** a left-folded chain of `and`/`or` with one row per operand, with a mutator to add or remove rows. Short-circuit order is top to bottom.
- **else if:** an `if` whose `else` is exactly one `if` is drawn as an extra arm, recursively. The single block's mutator adds or removes arms. Each arm's `if` id is kept.
- **compact text list:** a `list` of text `lit`s only, edited as one comma-separated field. A comma inside an item is written `\,`. The item ids are kept and new ones are generated for added items.
- **size literal:** a number `lit` in a size position, shown with a unit dropdown (bytes, KB, MB, GB; decimal, matching the playground's `humanSize`). Stored as an integer number of bytes. A non-integral result is rounded down, and the block says so.

### 8.4 Palette

Default (in this order):

| Category | Blocks |
|---|---|
| Tasks | the 4 v1 tasks |
| Files | every file …, make folder if missing, move, copy, delete, rename, write text |
| Groups | the files in …, how many files …, find the … file, the type of … |
| Search | search by halving, keep the left half, keep the right half |
| Repeat | repeat n times, keep doing … until |
| Decisions | if / else if, all of, any of, not, compare, the "its …" properties and ready-made conditions |
| Remember | remember [value] as (name), (name), show [text] (print) |
| Values | text, number, size, date, yes/no, the top folder, folder [name] in [folder], put together (text join) |

Advanced (when "Show advanced blocks" is on, appended after the default categories): Loops (for each, while, go through one by one), Lists, Text, Math, Functions, plus the generic primitive forms of everything above.

`showAdvanced: boolean` is added to `Settings` (`beepblocks.settings`, default false) and to the settings menu. The flyout is rebuilt when it changes. Blocks already in the workspace are unaffected (Req 7.3).

## 9. Step by Block

The playground stays presentational. The app computes **stops**, the snapshot indices that "by block" mode visits, and passes them as a new optional prop:

```ts
// PlaygroundProps
stepStops?: readonly number[] | null;   // null/undefined = every snapshot (v1)
```

Index *i* is a stop when any of these holds:
1. `resolveToExisting(nodeId_i)` (the visible editor block) differs from that of the previous snapshot;
2. `nodeId_i` is a **step point** of a visible composite: each schema lists local ids such as `loop` for `everyFile`/`goThrough`/`filesIn`/`countFiles`/`findFile`, `probe` for `halvingSearch`, and `round` for `repeatTimes`/`keepDoingUntil`;
3. the snapshot is an `fsOp`, `error` or `done` event;
4. it's the first or last snapshot.

Step forward/back, Space and Run move between stops. The scrubber still covers every snapshot. Stops are recomputed when the timeline or the set of workspace block ids changes (e.g. after Expand, without re-running). The controls get a "Step: by block / every detail" select, stored in the app store (not persisted).

## 10. Exporter

The only change is in comments: every composite in the original program (tasks and actions, at any depth of the desugaring) gets its own `# [block <id>] <label>` line above its expansion, indented at the expansion's position. The exporter learns where an expansion starts from the derived ids: the first emitted statement whose id has the composite's id as a prefix. Hoisted `pre` statements carry the expression composite's id, so its comment appears above them. Formatting and the golden test (v1 §8.2) stay. Goldens are updated and reviewed by hand.

## 11. Conformance and Coverage

- **Existing fixtures (29):** final trees and output must be identical. All 15 error fixtures are primitive-only programs, so no expected error node id should move. If one does, it's reviewed by hand, never regenerated.
- **New `REQUIRED_VARIANTS`** (checked by `coverage.ts`):
  - `everyFile action=move|copy|delete|rename`, `includeSubfolders=yes|no`, `makeFolder`, `condition=none|set`, `template {n}`;
  - `makeFolderIfMissing missing|exists`; `goThrough`;
  - `repeatTimes 0|3`; `keepDoingUntil zero-rounds|several`;
  - `findFile first|biggest|smallest|newest|oldest`, `found|notFound`, `tie`;
  - `halvingSearch found|notFound`;
  - `filesIn sortBy=none|name|modified|size`, `descending`;
  - `countFiles`; `typeOf grouping=category|extension`;
  - hoisting positions `assign|if|forEach|print|while|and-right|or-right|nested` (an expression action inside another's input).
- Fixture names use prefixes `act-` (statement actions), `expr-` (expression actions), `hoist-` (positions). All expected files are derived by hand, as in v1.
- Unit tests (not fixtures): §2 rank check, §4.3 invariants, and §8 round trips for every view.

## 12. Module Ownership

| Module | v1.1 work |
|---|---|
| `src/ir/` | `CompositeExpr`, schemas (level, rank, returns, step points), markers, validator rules, format v2. Contract, done first by the integrator |
| `src/composites/` | outer-first desugaring loop, hoisting, short-circuit rewrite, 11 action desugarings, tasks via actions, `desugarOne`/`desugarFully` |
| `src/editor/` | expression composite blocks, §8 views, palette and advanced switch, Expand menu items and expression Expand |
| `src/playground/` | `stepStops` prop, step-mode select |
| `src/app/` | stop computation, `showAdvanced` setting, wiring `desugarFully` |
| `src/export/` | per-composite comments |
| `conformance/` | new variants, `act-`/`expr-`/`hoist-` fixtures |

The simulator (`src/sim/`), the Python runtime (`runtime.py`) and the conformance runner logic are not changed.

## 13. Integration measurements

The v1 baseline starter measurements were 147/64/50/35 primitive blocks for the four
starters. The v1.1 measurements below are labeled explicitly because the starter order
and expansion shapes changed during integration.
With v1.1, the corresponding counts are recorded as original program / one-level action
expansion / fully primitive expansion:

| Starter | Original | Actions | Primitive | Max depth (original/actions/primitive) |
|---|---:|---:|---:|---:|
| Sort my downloads | 2 | 8 | 152 | 2 / 4 / 11 |
| Rename camera photos | 2 | 6 | 50 | 2 / 4 / 9 |
| Clear out temporary files | 16 | 21 | 37 | 5 / 5 / 7 |
| Find the first failing night | 13 | 20 | 64 | 5 / 5 / 5 |

Counts include statement and expression nodes in the starter IR and were measured from
`src/app/starters.ts` using the Phase 2 desugarings. The primitive counts can differ from
the v1 baseline where the v1 starter used a different task expansion shape; behavior and
conformance output remain unchanged.
