# Requirements Document — BeepBlocks v1

## Introduction

BeepBlocks is a client-only web application where users compose programs from Scratch-style blocks and watch them execute step by step on an interactive, sandboxed "playground" that models a familiar environment. v1 ships one playground theme — a **file explorer** — backed by an in-memory file system.

The product's core promise: **what the user sees in the playground is exactly what the exported script does.** Programs are exported to readable Python that performs the same operations on a real folder the user chooses, so users can prototype an operation safely and then apply it to their own files.

The architecture is built on a single **Intermediate Representation (IR)**. The block editor produces IR; the simulator interprets IR; the exporter translates IR to Python. High-level "composite" blocks are defined as desugarings into low-level "primitive" IR, so both levels share one semantic definition.

Target users are people with little or no programming experience who want to understand and automate tasks, and learners who want to see how basic algorithms (traversal, binary search) work on concrete objects.

## Glossary

- **IR** — Intermediate Representation; the typed, language-neutral program tree that is the single source of truth for program semantics.
- **Primitive** — An IR node with directly defined semantics (e.g. `if`, `while`, `renameFile`).
- **Composite** — A high-level IR node (e.g. "rename files matching a pattern") defined entirely by its desugaring into primitives.
- **Desugaring** — The deterministic transformation of a composite into an equivalent primitive IR subtree.
- **Expand** — The editor action that replaces a composite block with the blocks of its desugaring.
- **Sandbox FS** — The in-memory file tree the simulator operates on.
- **Scenario** — A named starting state for the Sandbox FS (a fixture), plus default parameters.
- **Snapshot** — The complete simulator state after one execution step (FS, variables, active node, counters).
- **Timeline** — The ordered list of snapshots produced by a run.
- **Theme (domain)** — A playground type defining the modeled environment and its primitives (v1: file explorer).
- **Theme (visual)** — Appearance settings (color scheme, accent, icon style).
- **Destructive operation** — An operation that deletes or overwrites data.
- **Conformance suite** — Fixtures that verify the simulator and exported Python produce identical results.

## Requirements

### Requirement 1: Intermediate Representation

**User Story:** As the system, I need a single program representation so that the editor, simulator, and exporter can never disagree about what a program means.

#### Acceptance Criteria

1. THE system SHALL represent every program as an IR tree defined by TypeScript types with documented semantics for each node.
2. THE IR SHALL be serializable to and from JSON without loss of information.
3. THE IR SHALL include the following general-purpose primitives: variables and assignment; number, string, boolean, and list literals; arithmetic; comparison; boolean logic; `if`/`else`; `while`; `for each`; list indexing, length, and append; string operations (concatenation, contains, starts/ends with, pattern match, pattern replace); user-defined functions with parameters, return values, and recursion.
4. THE IR SHALL include the following file-system primitives: list folder contents; walk folder recursively; get file property (name, base name, extension, size, modified date, is-folder, parent path); read text content; create folder; rename; move; copy; delete; write text content; check existence.
5. EACH IR node that performs a destructive operation SHALL be marked as destructive in its node definition.
6. EACH IR node SHALL carry a stable unique ID so that snapshots, highlights, and exported comments can reference the originating block.
7. THE system SHALL validate IR before execution or export AND report validation errors with the ID of the offending node.

### Requirement 2: Composite Blocks and Desugaring

**User Story:** As a beginner, I want high-level blocks for common tasks so that I can accomplish something useful without first learning loops and conditions.

#### Acceptance Criteria

1. THE system SHALL provide the following composites in v1:
   - **Rename by pattern** — rename every file in a folder whose name matches a pattern, using a replacement template.
   - **Sort into folders by type** — move each file in a folder into a subfolder named after its file type/extension, creating subfolders as needed.
   - **Find files and act** — recursively find files matching criteria (name pattern, extension, size, modified date) and apply a chosen action (move, copy, delete, rename) to each.
   - **Find first where (bisect)** — given a list of files sorted by a property, find the first file satisfying a condition using binary search.
2. EACH composite SHALL be defined solely by a deterministic desugaring into primitive IR.
3. THE simulator and exporter SHALL operate on desugared IR, so that a composite and its expansion produce identical behavior and identical exported code semantics.
4. EACH composite SHALL expose its parameters as editable fields on the block.

### Requirement 3: Block Editor

**User Story:** As a user, I want to build programs by dragging blocks so that I don't need to write syntax.

#### Acceptance Criteria

1. THE editor SHALL be implemented with Blockly and SHALL map every block to exactly one IR node type.
2. THE palette SHALL organize blocks into categories, with composites in a "Tasks" category shown first and primitives in categories by kind (Logic, Loops, Variables, Text, Lists, Math, Functions, Files).
3. WHEN the user edits the workspace, THE editor SHALL regenerate the IR and re-validate it.
4. WHEN the IR is invalid, THE editor SHALL mark the offending blocks and display a plain-language explanation.
5. THE block labels SHALL use plain-language phrasing (e.g. "for each file in [folder]") rather than programming jargon where possible.
6. THE editor SHALL support undo and redo.

### Requirement 4: Expand Composite (One-Way)

**User Story:** As a learner, I want to open up a high-level block and see the low-level blocks it is made of so that I can learn how it works and customize it.

#### Acceptance Criteria

1. WHEN the user chooses "Expand" on a composite block, THE editor SHALL replace it in place with the primitive blocks of its desugaring, preserving parameter values.
2. THE expanded blocks SHALL be fully editable primitive blocks.
3. THE program's behavior SHALL be identical before and after expansion.
4. THE expand action SHALL be undoable via the editor's undo.
5. THE system SHALL NOT be required to collapse primitive blocks back into a composite in v1.

### Requirement 5: Sandbox File System and Scenarios

**User Story:** As a user, I want a safe, realistic fake file system so that I can experiment without risk to my real files.

#### Acceptance Criteria

1. THE Sandbox FS SHALL be an in-memory tree of folders and files, each file having a name, size, modified date, and optional text content.
2. THE system SHALL NEVER read from or write to the user's real file system during simulation.
3. THE system SHALL provide at least four built-in scenarios, one suited to each v1 composite (e.g. a messy downloads folder, a photo folder with inconsistent names, a nested project tree, a folder of dated nightly logs).
4. THE user SHALL be able to edit a scenario's starting state (add, rename, delete files and folders; edit size, date, content).
5. WHEN the user resets, THE Sandbox FS SHALL return to the scenario's starting state.

### Requirement 6: Simulator

**User Story:** As a user, I want my program to run on the playground step by step so that I can see exactly what it does.

#### Acceptance Criteria

1. THE simulator SHALL interpret primitive IR against the Sandbox FS and produce a Timeline of Snapshots.
2. EACH Snapshot SHALL contain the Sandbox FS state, all variable values, the ID of the active IR node, and operation counters.
3. THE simulator SHALL replicate real-world error conditions with the same semantics as the exported Python, including: source not found, destination already exists, folder not empty, and invalid name.
4. WHEN an error occurs, THE simulator SHALL stop, record the error in the final Snapshot, and identify the responsible node.
5. THE simulator SHALL enforce a configurable step limit AND stop with a clear message when the limit is exceeded (e.g. infinite loop).
6. THE simulator SHALL be deterministic: the same IR and starting state SHALL always produce the same Timeline.
7. THE simulator SHALL run without blocking the UI for programs within the step limit.

### Requirement 7: Playground Visualization (File Explorer Theme)

**User Story:** As a user, I want to see files change as the program runs so that I understand what each step does.

#### Acceptance Criteria

1. THE playground SHALL display the Sandbox FS as an explorer view with a folder tree and a file list showing name, type icon, size, and modified date.
2. WHILE stepping, THE system SHALL highlight the active block in the editor and the affected file(s) in the playground.
3. THE playground SHALL visually distinguish created, renamed/moved, modified, and deleted items relative to the previous step.
4. WHEN a variable refers to a file or folder, THE playground SHALL display a tag with the variable name on that item (e.g. `current`, `low`, `mid`, `high`).
5. THE playground SHALL display operation counters, at minimum: steps executed, file operations performed, and comparisons/checks performed.
6. THE playground SHALL provide a variables panel listing current variable names and values.
7. THE user SHALL be able to click an item in the playground to highlight the blocks that acted on it during the run.

### Requirement 8: Execution Controls

**User Story:** As a user, I want to control playback so that I can examine the program at my own pace.

#### Acceptance Criteria

1. THE system SHALL provide Run, Pause, Step Forward, Step Back, and Reset controls.
2. THE system SHALL provide a timeline scrubber to jump to any Snapshot.
3. THE system SHALL provide adjustable playback speed.
4. WHEN the program is edited after a run, THE system SHALL mark the current Timeline as stale.

### Requirement 9: Python Export

**User Story:** As a user, I want to export my program as a Python script so that I can perform the same operations on my real files.

#### Acceptance Criteria

1. THE exporter SHALL translate desugared IR into a single Python 3.9+ script using only the standard library (e.g. `pathlib`, `shutil`, `re`, `argparse`).
2. THE exported script SHALL perform the same operations as the simulator, relative to a root folder supplied as a command-line argument, and SHALL NOT recreate the scenario's starting state.
3. THE exported script SHALL run in dry-run mode by default, printing each action it would take, AND SHALL only modify files when invoked with an explicit `--apply` flag.
4. WHEN the program contains destructive operations, THE script header SHALL list them in plain language.
5. THE exported script SHALL be readable: meaningful variable names from the program, consistent formatting, and comments referencing the originating blocks.
6. THE exported script SHALL include a header explaining what it does and how to run it.
7. THE user SHALL be able to download the script as a `.py` file and copy it to the clipboard.
8. THE exporter SHALL refuse to export invalid IR and show the validation errors.

### Requirement 10: Simulator–Exporter Conformance

**User Story:** As the product, I need proof that the playground and the exported script behave the same so that users can trust the export.

#### Acceptance Criteria

1. THE project SHALL include a conformance suite of IR programs, each paired with a starting file tree, covering every primitive and every composite.
2. FOR EACH fixture, THE suite SHALL run the simulator AND run the exported Python (with `--apply`) against a real temporary folder built from the same starting tree.
3. THE suite SHALL pass only if the resulting file trees (structure, names, content) match exactly AND error outcomes match.
4. THE conformance suite SHALL be runnable with a single command.

### Requirement 11: Themes

**User Story:** As a user, I want to choose how the playground looks, and as the product, we want to add new playground domains later.

#### Acceptance Criteria

1. THE architecture SHALL define a domain-theme interface (state model, primitives, renderer, scenarios, exporter mappings) so that additional domains (e.g. text document) can be added without changing the IR core.
2. v1 SHALL ship exactly one domain theme: file explorer.
3. THE system SHALL provide visual theme presets (at minimum light and dark) AND allow customizing the accent color.
4. THE visual theme choice SHALL persist across sessions.

### Requirement 12: Project Persistence

**User Story:** As a user, I want my work saved so that I don't lose it.

#### Acceptance Criteria

1. THE system SHALL autosave the current project (program and scenario) to browser local storage.
2. THE user SHALL be able to export a project as a JSON file and import it again.
3. WHEN an imported project fails validation, THE system SHALL report the problem and not overwrite the current project.

### Requirement 13: Non-Functional

#### Acceptance Criteria

1. THE application SHALL run entirely client-side with no backend.
2. THE application SHALL be built with React and TypeScript.
3. THE application SHALL work in current versions of Chrome, Edge, and Firefox on desktop.
4. THE UI SHALL meet WCAG 2.1 AA for color contrast AND support keyboard navigation for execution controls, palette, and playground.
5. Visual changes SHALL NOT rely on color alone (e.g. diff states also use icons or labels).
6. THE codebase SHALL keep the IR, simulator, exporter, editor, and playground UI in separate modules that depend only on the IR types and documented interfaces.

## Out of Scope for v1

- Collapsing primitives back into composites / round-trip editing (planned for a future version)
- Text-document and other domain themes
- Export targets other than Python
- Running exported scripts from the browser or accessing the real file system
- Additional composites (find duplicates, sort-algorithm visualization)
- Accounts, cloud sync, and sharing via URL
- Mobile/touch-optimized layout

## Open Questions

1. **Name** — resolved: **BeepBlocks** (project files `.beep.json`; see `naming-brainstorm.md` for the alternatives considered).
2. **Pattern syntax** — should "rename by pattern" use simple wildcards (`*.jpg`, `photo_{n}`) for beginners, with regex only in primitives? (Proposed: wildcards + numbered templates in composites; regex available in primitives.)
3. **Bisect condition cost** — should the bisect scenario simulate "expensive checks" (e.g. counting each content read) to make the efficiency lesson visible? (Proposed: yes, via the checks counter.)
