# Requirements Document — BeepBlocks v1.1: Human-Action Blocks

## Introduction

v1 has two levels of blocks: one-click **tasks** ("Sort files into folders by type") and **primitives** (`if`, `for each`, `fs.join`, `text.lower`). Expanding a task drops straight from a sentence to code-shaped blocks: "Sort my downloads" expands into 147 blocks nested 8 deep, most of them extension literals in an `if/else` staircase. The algorithm is buried in plumbing.

v1.1 adds a middle level of **action blocks** phrased as familiar human actions ("move every file in Downloads into a folder named after its type", "look at the middle one", "keep the left half"). The goal is not another scripting language: by default, users build with tasks and actions and never write a `for` loop. Loops, variables and code-shaped primitives remain available behind an "advanced" switch and are what Expand reveals at the bottom level.

Everything in v1 that defines meaning stays as it is. Actions are composites: pure desugarings into the same primitives, so the simulator, the Python exporter and the conformance guarantee are unchanged.

This document only lists what v1.1 adds or changes. Requirements in `../beepblocks-v1/requirements.md` still apply unless noted here.

## Glossary

- **Level** — How close a block is to human language: **task** (one block does a whole job), **action** (one familiar step), **primitive** (v1 code-shaped blocks).
- **Action** — A composite phrased as a human action. Statement actions do something; expression actions produce a value ("the type of (file)").
- **Expression action** — An action used where a value is expected. Its desugaring is a value plus statements that must run first.
- **Hoisting** — Placing an expression action's statements immediately before the statement that uses its value.
- **Bulk action** — A statement action that does the same thing to every file in a group ("move every file … where …").
- **"It"** — The file a bulk action, group, or search is currently looking at, referred to in conditions as "its name", "its size", and so on.
- **Advanced blocks** — Loops, variables, lists, text, math and function primitives, hidden from the palette by default.
- **Step by block** — A playback mode that advances to the next visible block (or the next file of a bulk action) instead of the next primitive step.

## Requirements

### Requirement 1: Three Levels and Level-by-Level Expand

**User Story:** As a learner, I want to open a task and see a few plain steps, and only open a step further if I want to, so that I learn how it works without drowning in detail.

#### Acceptance Criteria

1. THE system SHALL classify every composite as a task or an action.
2. EACH composite desugaring SHALL only produce composites that are strictly simpler than itself (lower rank), so that repeated desugaring always ends in primitives.
3. WHEN the user chooses "Expand into actions" on a task, THE editor SHALL replace it with the blocks of one level of desugaring (actions and primitives).
4. THE editor SHALL also offer "Expand into basic blocks" on every composite, which expands all levels at once.
5. THE program's behavior SHALL be identical at every level of expansion (v1 Req 4.3 applies to each level).
6. Each Expand SHALL be a single undo step (v1 Req 4.4).

### Requirement 2: Action Vocabulary and Wording

**User Story:** As someone who is not a programmer, I want blocks that say what I would say, so that I can read a program like a list of instructions.

#### Acceptance Criteria

1. THE system SHALL provide the action blocks listed in design.md §5, covering: doing the same thing to every file in a group; making a folder if it's missing; picking out a group of files; counting files; finding one file (first, biggest, smallest, newest, oldest); the type of a file; searching a lined-up group by halving; repeating a number of times; and repeating until something is true.
2. Action labels SHALL use everyday verbs and nouns ("make", "move", "look at", "keep", "line up", "how many") and SHALL NOT show programming notation (`=`, `//`, `and`, list indices, variable declarations).
3. A bound value SHALL be named by its role ("file", "the middle one", "the answer") and SHALL remain renamable by the user (v1 binds).
4. EACH action SHALL have help text in plain language describing exactly what it does, including what happens when no file matches.
5. Primitive blocks that already read as human actions (move, copy, delete, rename, write text) SHALL be reused rather than wrapped.

### Requirement 3: Loop-Free by Default

**User Story:** As a beginner, I want to do things to many files without writing a loop, so that I think about what I want rather than how to iterate.

#### Acceptance Criteria

1. Every built-in task SHALL desugar into actions without any `for each` or `while` block at the action level.
2. THE "every file" bulk action SHALL support move, copy, delete and rename, an optional condition, an "include subfolders" choice, and (for move and copy) an option to make the destination folder if it's missing.
3. THE system SHALL provide "repeat (n) times" and "keep doing … until …" blocks; "keep doing … until" SHALL check its condition before each round.
4. Iterating one file at a time with several steps per file ("go through the files one by one") SHALL be available as an advanced block.

### Requirement 4: Conditions About "It"

**User Story:** As a user, I want to write conditions like "its extension is tmp" or "it's bigger than 1 MB", so that I don't have to name and pass around a variable.

#### Acceptance Criteria

1. Inside the condition (and destination) of a bulk action, group, count or find block, THE palette SHALL offer property blocks that refer to the current file: its name, its name without extension, its extension, its size, when it was last changed, its text, and whether it's a folder.
2. THE palette SHALL offer ready-made condition blocks: "its name matches [pattern]", "its extension is [ext]", "it's bigger / smaller than [size]", "it was changed after / before [date]", "its text contains [text]".
3. Sizes SHALL be entered with a unit (bytes, KB, MB, GB, using the same decimal units the playground displays) and stored as bytes.
4. THE editor SHALL provide "all of these are true" and "any of these are true" blocks with one row per condition, with the same short-circuit meaning as `and`/`or`.
5. These blocks SHALL be views of ordinary IR (variables, ops, `and`/`or`); they SHALL NOT add new runtime semantics.

### Requirement 5: Expression Actions

**User Story:** As a user, I want to use "the type of (file)" or "the files in [folder] where …" wherever a value fits, so that I can combine actions.

#### Acceptance Criteria

1. THE IR SHALL support composites in expression positions.
2. An expression action's statements SHALL run immediately before the rest of the statement that uses it, in both the simulator and the exported script.
3. WHEN an expression action is used in a `while` condition, it SHALL be re-evaluated before every check of the condition.
4. WHEN an expression action is used in the right-hand side of `and`/`or` (or a later row of "all of" / "any of"), it SHALL only run if that side is evaluated.
5. Expanding an expression action SHALL insert its statements before the enclosing statement and replace the block with its value.

### Requirement 6: Readable Primitive Level

**User Story:** As a learner who expands all the way, I want the basic blocks to stay readable, so that the bottom level is still understandable.

#### Acceptance Criteria

1. THE editor SHALL show an `if` whose `else` contains only another `if` as an "else if" arm of the same block.
2. THE editor SHALL show a list made only of text values as a single compact block whose items are edited as one comma-separated field.
3. Both SHALL be views only: the IR, saved files, simulator and exporter are unchanged, and blocks round-trip to identical IR.

### Requirement 7: Palette and Advanced Blocks

**User Story:** As a beginner, I want a short palette of human-action blocks, and as an advanced user, I want everything.

#### Acceptance Criteria

1. THE default palette SHALL contain only tasks, actions, file operations, decisions and values (design.md §8.4).
2. A "Show advanced blocks" setting SHALL add the loop, variable, list, text, math and function categories; it SHALL persist with the other settings.
3. Programs that contain advanced blocks SHALL load, display and run regardless of the setting.

### Requirement 8: Step by Block

**User Story:** As a user stepping through a run, I want each step to be one thing I can see in the editor, so that I follow the algorithm instead of the bookkeeping.

#### Acceptance Criteria

1. THE playback controls SHALL offer two step modes: "by block" (default) and "every detail" (v1 behavior).
2. In "by block" mode, Step forward/back and Run SHALL move between snapshots where the highlighted editor block changes, where a bulk action or group moves on to its next file, where a search looks at a new middle, where a file changes, or where an error occurs.
3. The scrubber, counters and Output panel SHALL be unaffected by the step mode.

### Requirement 9: Exported Script

**User Story:** As a user reading the exported Python, I want it in the same sections as my blocks.

#### Acceptance Criteria

1. THE exporter SHALL emit a `# [block <id>] <label>` comment above the expansion of every task and action, nested ones included, so that the script is organized by action.
2. All of v1 Req 9 still applies.

### Requirement 10: Compatibility and Conformance

#### Acceptance Criteria

1. THE four v1 tasks SHALL keep their names, fields and behavior, and SHALL desugar through actions.
2. ALL v1 conformance fixtures SHALL keep identical final trees and output. Only node ids inside expansions may change, and each such golden change SHALL be reviewed by hand.
3. THE conformance coverage requirement (v1 Req 10.1) SHALL extend to every action × variant and to every hoisting position (statement, `while` condition, right side of `and`/`or`).
4. THE program format version SHALL increase to 2. Version 1 programs SHALL still load.

## Out of Scope for v1.1

- Collapsing primitives back into actions or tasks.
- New domains, export targets, or runtime ops.
- Natural-language input ("type what you want").
- Actions on text content beyond reading it (e.g. "replace every line where …").

## Open Questions

1. **"It" in Python.** The bound name defaults to `file`, so exported code reads `if file.ext == …`. Should the editor say "it" while Python says `file`? (Proposed: yes.)
2. **Starters.** Should starter projects open at the action level instead of as one task block? (Proposed: no; one click to run, one Expand to see the actions.)
3. **"Keep doing until" safety.** Should it warn when its body can't change anything its condition reads? (Proposed: no; the step limit already stops runaway loops with a clear message.)
