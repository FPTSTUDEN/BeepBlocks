# Design Document — BeepBlocks v1

## 1. Overview

BeepBlocks is a client-only React + TypeScript web app. Users build programs with Blockly blocks, run them step by step against an in-memory file system, and export them to a standalone Python script.

Everything revolves around one **IR** (intermediate representation):

```
 Blockly workspace ──(ws→IR)──▶  IR (may contain composites)
        ▲                            │
        │ (IR→ws, used by Expand)    │ desugar()
        │                            ▼
        └────────────────────  Primitive IR ──┬──▶ Simulator ──▶ Timeline ──▶ Playground UI
                                              └──▶ Python exporter ──▶ script.py
```

Guiding principles:

1. **One semantic definition.** The simulator and exporter both consume *desugared primitive IR*. Composites never reach either of them.
2. **Python is the reference semantics for general primitives.** Arithmetic, comparison, text, and list operations behave exactly like the Python the exporter emits. The simulator emulates Python, not JavaScript.
3. **File-system primitives are defined by this document.** They are implemented twice, in TypeScript (simulator) and in a small Python runtime embedded in every exported script. Both implementations follow §5 exactly.
4. **Strictest-common-denominator FS rules.** Name validity and case-insensitive uniqueness follow Windows rules on every OS, so a program that works in the sandbox works on Windows, macOS, and Linux.
5. **Static typing gates execution.** Programs must type-check before they run or export. That removes most runtime places where JS and Python could diverge.
6. **Conformance is enforced by tests**, not by convention (§11).

## 2. Technology

| Concern | Choice |
|---|---|
| Build | Vite |
| Package manager | pnpm 10.33 |
| UI | React 19 + TypeScript 6.0 (strict) |
| Block editor | Blockly (+ `@blockly/keyboard-navigation`) |
| App state | Zustand |
| Simulation off main thread | Web Worker |
| Unit tests | Vitest |
| Conformance runner | Node (`tsx`) + local Python 3.9+ |
| Styling | CSS modules + CSS custom properties for themes |

Exact dependency versions are pinned in the scaffold task.

## 3. Module Layout and Ownership

```
src/
  ir/                     # CONTRACT — owned by integrator, read-only for workstreams
    types.ts              # IR node types, value types, Type
    ops.ts                # op signatures (name, arg types, return type, destructive, counter)
    composites.ts         # composite node shape + registry interface
    validate.ts           # structural validation + typecheck
    ids.ts                # node-id helpers
    serialize.ts          # JSON (de)serialization + versioning
  domains/fileExplorer/
    fsTypes.ts            # CONTRACT — SandboxFS types, Scenario type
    fs.ts                 # immutable sandbox FS model + name rules       [Sim]
    scenarios/*.json      # built-in scenarios                             [Sim]
  sim/                    # interpreter, Python value semantics, worker    [Sim]
  composites/             # 4 desugarings + registry                       [Composites]
  export/python/          # emitter, runtime.py, header generation         [Export]
  editor/                 # Blockly blocks, ws→IR, IR→ws, Expand           [Editor]
  playground/             # explorer renderer, tags, counters, controls    [Playground]
  app/                    # shell, store, persistence, visual themes       [Integrator]
conformance/
  fixtures/<name>/{program.json, tree.json, expected.json?}
  run.ts                                                                   [Integrator]
```

Import rules (enforced with ESLint `no-restricted-imports`):
- `ir/` and `domains/*/fsTypes.ts` import nothing from the app.
- `sim`, `export`, `composites`, `editor`, and `playground` may import `ir/` and `fsTypes.ts`. They must not import each other, except:
  - `editor` may import `composites` (for Expand).
  - `playground` may import `domains/fileExplorer/fs.ts` read helpers.
- Only `app/` wires modules together.

## 4. Intermediate Representation

### 4.1 Types

```ts
// src/ir/types.ts
export type NodeId = string;

export type Type =
  | { t: 'number' }          // Python int | float
  | { t: 'text' }
  | { t: 'bool' }
  | { t: 'path' }
  | { t: 'list'; of: Type };

export interface Program {
  format: 'beepblocks-ir';
  version: 1;
  functions: FunctionDef[];
  body: Stmt[];
}

export interface FunctionDef {
  id: NodeId;
  kind: 'function';
  name: string;                         // valid Python identifier, not reserved
  params: { name: string; type: Type }[];
  returns: Type | null;                 // null = no return value
  body: Stmt[];
}

// ---------- Statements ----------
export type Stmt =
  | Assign | If | While | ForEach | Return | Do | Print | CompositeStmt;

export interface Assign  { id: NodeId; kind: 'assign'; name: string; value: Expr; hint?: VarHint }
export interface If      { id: NodeId; kind: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] }
export interface While   { id: NodeId; kind: 'while'; cond: Expr; body: Stmt[] }
export interface ForEach { id: NodeId; kind: 'forEach'; name: string; list: Expr; body: Stmt[] }
export interface Return  { id: NodeId; kind: 'return'; value: Expr | null }
export interface Do      { id: NodeId; kind: 'do'; expr: OpExpr | CallExpr }  // expression statement
export interface Print   { id: NodeId; kind: 'print'; value: Expr }          // value must be text

// Visualization hint: a number variable that indexes into a list variable (e.g. bisect low/mid/high)
export interface VarHint { indexInto: string }

// ---------- Expressions ----------
export type Expr =
  | Lit | DateLit | ListLit | Var | Binary | Unary | OpExpr | CallExpr;

export interface Lit     { id: NodeId; kind: 'lit'; value: number | string | boolean }
export interface DateLit { id: NodeId; kind: 'date'; iso: string }  // 'YYYY-MM-DD', UTC midnight → number (epoch s)
export interface ListLit { id: NodeId; kind: 'list'; itemType: Type; items: Expr[] }
export interface Var     { id: NodeId; kind: 'var'; name: string }
export interface Binary  { id: NodeId; kind: 'binary'; op: BinOp; left: Expr; right: Expr }
export interface Unary   { id: NodeId; kind: 'unary'; op: 'not' | 'neg'; arg: Expr }
export interface OpExpr  { id: NodeId; kind: 'op'; op: OpName; args: Expr[] }
export interface CallExpr{ id: NodeId; kind: 'call'; fn: string; args: Expr[] }

export type BinOp =
  | '+' | '-' | '*' | '/' | '//' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | 'and' | 'or';
```

Number literals carry an `isFloat` flag implied by their JSON form. The serializer stores `{ value: 3, float: true }` for `3.0`, so the int/float distinction survives a round trip.

### 4.2 Op registry

Every domain-independent and domain-specific operation is an `OpExpr` whose `op` is a key in the op registry. The registry lives in `ir/ops.ts` and holds **signatures only**. Implementations live in `sim/` and `export/` and are keyed by op name. A completeness test fails if either side is missing an op.

```ts
export interface OpSignature {
  name: OpName;
  args: Type[];                 // positional, fixed arity
  returns: Type | null;         // null → statement-only
  destructive: boolean;         // Req 1.5
  counter: 'none' | 'read' | 'fileOp';
  label: string;                // plain-language summary used by blocks/header
}
```

### 4.3 Scoping and typing rules

- Top-level `body` variables are program-scope. Functions see **only their parameters and locals**, so they never read top-level variables. This avoids Python's `global` semantics.
- Assigning a variable fixes its type for that scope. Reassigning a different type is a validation error.
- `forEach` binds its loop variable in the enclosing scope, as Python does. The list is evaluated once, before the first iteration.
- Conditions (`if`, `while`, `and`, `or`, `not`) require `bool`.
- `print` requires `text`. Use `text.from` to convert.
- Ordering comparisons (`<` etc.) require both sides to be `number` or both `text`. `==` and `!=` require equal types.
- `+` accepts number+number, text+text, or list+list of the same element type.
- Variable and function names must be valid Python identifiers. They must not be Python keywords, builtins we use (`print`, `len`, `str`, `int`, `float`, `range`, `sorted`, `min`, `max`, `abs`, …), or module-level names of the exported script (`fs`, `main`, `re`, `os`, `sys`, `Path`, `_RealFS`, `_PlanFS`, …), and must not start with `_bp` in any letter case (which covers `_BPError` and friends). User names are emitted verbatim, so a clash would overwrite the runtime; a unit test extracts every module-level name from `runtime.py` and checks that `checkIdentifier` rejects it.
- Every `function` with `returns ≠ null` must return a value on all paths. The validator checks this conservatively.
- The validator reports `{ nodeId, code, message }`. Messages are plain language, e.g. "This 'if' needs a yes/no condition, but got a number."

### 4.4 Node IDs

- IDs coming from the editor are Blockly block IDs.
- Desugared nodes get deterministic IDs: `${compositeId}/${localName}`, e.g. `abc12/loop`, `abc12/rename`.
- To map a snapshot's active node to an editor block, strip `/…` suffixes until an ID exists in the workspace. That way a collapsed composite still lights up while its internals run.
- `when-run` (`RUN_BLOCK_ID` in `ir/ids.ts`) is the editor's fixed id for the "when run" hat block and is reserved: no program node may use it.

## 5. Primitive Semantics

### 5.1 Values (simulator representation)

```ts
type Value =
  | { t: 'int'; v: number }      // safe-integer range; overflow → error INT_OVERFLOW (known divergence §12)
  | { t: 'float'; v: number }
  | { t: 'text'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'path'; v: string }     // relative POSIX path from root; '' = root
  | { t: 'list'; v: Value[] };
```

Arithmetic follows Python:
- int ∘ int stays int for `+ - * // %`. `/` always yields float. Any float operand makes the result float.
- `//` and `%` use floor semantics, so the sign follows the divisor.
- Division by zero raises `DIVISION_BY_ZERO`.

Text conversion (`text.from`) follows Python `str()`:
- ints print as decimal.
- floats use Python `repr`: shortest round-trip, `1.0`, `1e-05`, `1e+16`. A dedicated `formatPyFloat` in `sim/` is unit-tested against a table generated by Python.
- bools print as `True` / `False`.
- paths print as their relative POSIX string, with `.` for root.

### 5.2 General ops

| Op | Signature | Notes |
|---|---|---|
| `text.from` | (any scalar) → text | Python `str()` |
| `text.toNumber` | text → number | int if it parses as int, else float; failure → `INVALID_NUMBER` |
| `text.length` | text → number | Unicode code points (Python `len`) |
| `text.lower` / `text.upper` | text → text | Python `lower()`/`upper()` |
| `text.contains` / `startsWith` / `endsWith` | text, text → bool | |
| `text.replace` | text, old, new → text | literal, all occurrences |
| `text.padNumber` | number, width → text | zero-pad an int (`{n:3}` templates) |
| `text.wildcard` | text, pattern → bool | `*` and `?` only, **case-insensitive**, whole-string match |
| `text.regexMatch` | text, pattern → bool | search semantics; restricted regex subset (§5.4) |
| `text.regexReplace` | text, pattern, repl → text | `\1`-style group refs |
| `list.length` | list → number | |
| `list.get` | list, index → T | **0-based**; out of range → `INDEX_OUT_OF_RANGE`; negative indices rejected |
| `list.append` | list, T → (stmt) | mutates in place |
| `list.contains` | list, T → bool | |
| `list.range` | start, stop → list<number> | Python `range(start, stop)` |
| `list.sortBy` | list<path>, key: text, descending: bool → list<path> | key ∈ `name`, `size`, `modified`, `ext`; stable; returns new list; `name`/`ext` sort uses lowercase then code-point order |
| `list.sort` | list<number\|text>, descending → list | stable, Python ordering |
| `math.floor`, `math.abs`, `math.min`, `math.max` | | Python semantics; no `round` (banker's rounding confuses beginners) |

### 5.3 File-system ops (file explorer domain)

All paths are relative to the root folder the script runs on. A path is only built through `fs.root`, `fs.join`, `fs.parent`, `fs.list`, `fs.walk`, and the return values of `rename`/`move`/`copy`. Because of that, **no program can reach outside the root**, which is an important safety property of exported scripts.

**Path equality is case-insensitive.** It compares `lower()` of the relative string. Combined with case-insensitive unique names, it's exact on every OS.

| Op | Signature | Counter | Destructive | Semantics / errors |
|---|---|---|---|---|
| `fs.root` | () → path | none | no | the root folder |
| `fs.join` | path, text → path | none | no | child path; name validated → `INVALID_NAME` |
| `fs.parent` | path → path | none | no | root's parent → `OUTSIDE_ROOT` |
| `fs.name` | path → text | none | no | last segment (`report.final.pdf`) |
| `fs.stem` | path → text | none | no | pathlib `stem` (`report.final`; `.bashrc` → `.bashrc`) |
| `fs.ext` | path → text | none | no | pathlib `suffix` without dot, original case; `''` if none |
| `fs.exists` | path → bool | read | no | |
| `fs.isFolder` | path → bool | read | no | `NOT_FOUND` if missing |
| `fs.list` | path → list<path> | read | no | direct children (files and folders), sorted by lowercase name then code point; `NOT_FOUND`, `NOT_A_FOLDER` |
| `fs.walk` | path → list<path> | read | no | all **files** under folder, depth-first, children in `fs.list` order; computed eagerly |
| `fs.size` | path → number | read | no | bytes; `NOT_A_FILE` for folders |
| `fs.modified` | path → number | read | no | integer epoch seconds (UTC) |
| `fs.readText` | path → text | read | no | UTF-8, newlines preserved verbatim; invalid UTF-8 or NUL byte → `NOT_TEXT` |
| `fs.writeText` | path, text → (stmt) | fileOp | **yes** | create or overwrite; parent must exist; existing folder → `NOT_A_FILE` |
| `fs.makeFolder` | path → (stmt) | fileOp | no | parent must exist (`NOT_FOUND`); exists → `ALREADY_EXISTS` |
| `fs.rename` | path, text → path | fileOp | no | same parent, new name; `INVALID_NAME`; sibling with same lowercase name → `ALREADY_EXISTS` (except a case-only rename of itself) |
| `fs.move` | path, path(folder) → path | fileOp | no | destination folder must exist and be a folder; `dest/name` exists → `ALREADY_EXISTS`; moving a folder into itself or a descendant → `INVALID_MOVE` |
| `fs.copy` | path, path(folder) → path | fileOp | no | files and folders (deep); same collision rules as move |
| `fs.delete` | path → (stmt) | fileOp | **yes** | file, or **empty** folder only; non-empty → `NOT_EMPTY` (no recursive delete in v1) |

**Name rules** (`fs.join`, `fs.rename`, scenario editor) follow Windows and apply everywhere:
- 1–255 characters.
- None of `< > : " / \ | ? *` and no control chars (`< 0x20`).
- Must not end with a space or `.`, and must not be `.` or `..`.
- Must not be a reserved name (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`), case-insensitive, with or without an extension.

**Modified times.**
- `writeText` and `makeFolder` set the modified time to a **simulation clock**. The clock starts at `max(mtime in scenario) + 60` and advances 1 second per file op.
- `rename`, `move`, and `copy` **preserve** modified times (copy behaves like Python `shutil.copy2` / `copytree`, including every item inside a copied folder).
- The simulator does not update a folder's own modified time when its contents change.
- The Python runtime uses the real clock. Times written *during* the run, and folder times, are a known divergence (§12) and are excluded from conformance comparisons.

**File content model.**
- A sandbox file has either `content: string` (a text file) or `binarySize: number` (opaque bytes, e.g. a photo).
- `size` is the UTF-8 byte length of the content, or `binarySize`.
- Reading an opaque file raises `NOT_TEXT`.
- Conformance materializes opaque files as `binarySize` NUL bytes, so Python raises `NOT_TEXT` too.

### 5.4 Regex subset

Allowed:
- literals and `.`
- classes `[...]` / `[^...]`
- `\d \w \s \D \W \S`
- quantifiers `* + ? {m} {m,} {m,n}` and their lazy forms
- groups `(...)` and `(?:...)`
- `|`, `^`, `$`

Anything else (lookarounds, backreferences in patterns, named groups, flags) fails validation. A group that can repeat more than once (`*`, `+`, `{m,}`, `{m,n}` with n > 1, `{m}` with m > 1) must not contain a capturing group: JS clears inner captures on every repetition while Python keeps the last one, so `\1` would differ. `?`, `{0,1}` and `{1}` are allowed, and so is capturing the whole repeat, e.g. `((?:a|b)+)`. The simulator uses JS `RegExp` with the `u` flag. Python uses `re` with `re.ASCII`, so `\d`/`\w`/`\s` mean the same in both. Replacement strings use `\1`–`\9` and `\\`. The simulator translates them for JS.

### 5.5 Error codes

`NOT_FOUND, ALREADY_EXISTS, NOT_EMPTY, INVALID_NAME, NOT_A_FOLDER, NOT_A_FILE, NOT_TEXT, INVALID_MOVE, ROOT_PROTECTED, OUTSIDE_ROOT, INDEX_OUT_OF_RANGE, DIVISION_BY_ZERO, INVALID_NUMBER, INT_OVERFLOW, STEP_LIMIT, RECURSION_LIMIT`

(Invalid regex patterns are caught at validation time because patterns must be literals, so there is no runtime pattern error.)

Error messages are free text and are **not** compared by conformance; `code` and `nodeId` are.

Each error carries `{ code, nodeId, message }`. **`nodeId` is the id of the innermost node that raised the error** — normally the `op` / `binary` / `call` expression, not its enclosing statement. The Python runtime raises `_BPError(code, node_id, message)`. Its entry point prints exactly `Error at block <nodeId> (<CODE>): <message>` as the first stderr line and exits with code 1. `STEP_LIMIT` and `RECURSION_LIMIT` are simulator-only, and `INT_OVERFLOW` cannot happen in Python (§12).

### 5.6 Precise semantics (contract-v1 addendum)

The simulator and the Python runtime are written independently, so every rule below is **normative**. Where §5.1–§5.3 are less specific, this section wins.

**Values and lists**
- Lists have **reference semantics**, as in Python. `b = a` makes both names refer to the same list, and `list.append(a, x)` is visible through `b`. `ListLit`, `+` on lists, `list.range`, `list.sort`, `list.sortBy`, `fs.list`, and `fs.walk` create new lists. Snapshots store deep copies of values, so later mutations don't rewrite history.
- `forEach` iterates over a **snapshot copy** of the list taken before the first iteration. Appending during the loop does not add iterations. The exporter emits `for x in list(xs):`.
- `==`/`!=` on lists compare element-wise (Python `==`), with path elements compared case-insensitively.
- An int result outside the safe-integer range raises `INT_OVERFLOW` (simulator only).
- Negating int `0` gives `0`, never `-0`. Float `-0.0` prints as `-0.0`.
- Ordering of text (`<`, `list.sort`, sort keys) is by **Unicode code point**, as in Python, not UTF-16.

**Number ops**
- `math.floor` returns an **int** (Python `math.floor`). `math.abs` keeps the int/float type.
- `math.min(a, b)` / `math.max(a, b)` return the **first** argument when the two are equal, as Python does (`min(1, 1.0)` is `1`).
- `list.get`, `list.range`, and `text.padNumber` require **int** arguments. A float, even `2.0`, raises `INVALID_NUMBER`. `list.get` with a negative index or one ≥ length raises `INDEX_OUT_OF_RANGE`.
- `text.padNumber(n, w)` is Python `str(n).zfill(w)`, so `-5` padded to 3 gives `-05`.
- `text.toNumber(s)`: if `s` matches `^[+-]?\d+$` the result is an int. Otherwise, if it matches `^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$` the result is a float. Otherwise it raises `INVALID_NUMBER`. There's no whitespace trimming, no `_`, no `inf`/`nan`, and only ASCII digits.
- `text.date(t)` is the UTC date `YYYY-MM-DD` of epoch seconds `t` (int or float), i.e. `datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d')`.

**Text ops**
- `text.wildcard(s, p)`: `*` matches any run of characters (including an empty one), `?` matches exactly one code point, and every other character matches itself. The match covers the whole string and compares `lower()` of both sides. Implement it by translating the pattern to an escaped regex on both sides, not with `fnmatch`, which treats `[` specially.
- `text.regexMatch` uses search semantics (`re.search` / `RegExp.test`). `text.regexReplace` replaces all matches. In the replacement, `\1`–`\9` is the group text, with an unmatched group giving `''`, and `\\` is a backslash.

**Paths**
- A path value keeps the case the program produced it with. Equality ignores case. Lookups on disk resolve each segment case-insensitively.
- `fs.join(p, name)` validates `name` with the name rules and returns `p + '/' + name` (or just `name` when `p` is the root). It does not check existence.
- `fs.list(p)` and `fs.walk(p)` return `p` joined with each **stored** child name.
- The paths returned by `fs.rename` / `fs.move` / `fs.copy` are, respectively: the parent of `p` joined with `newName`; the destination folder path as given joined with the item's **stored** name; and the same for copy.
- `fs.name`, `fs.stem`, and `fs.ext` look only at the last segment of the path string and never touch the disk. On the root, `fs.name` and `fs.stem` return `''`. `fs.parent` of a top-level item returns the root.
- `fs.walk` is pre-order. Within a folder, children are visited in `fs.list` order: a file is yielded when it's reached, and a subfolder is descended into at its position. Folders themselves are never yielded. A whole walk counts as **one** read.
- Resolving a path in which some earlier segment is a file behaves as "does not exist".

**Check order.** The first failing check determines the error code. Every name check happens before any disk check.

| Op | Checks in order |
|---|---|
| `fs.join` | name valid → `INVALID_NAME` |
| `fs.parent` | path is root → `OUTSIDE_ROOT` |
| `fs.isFolder`, `fs.modified` | exists → `NOT_FOUND` |
| `fs.list`, `fs.walk` | exists → `NOT_FOUND`; is folder → `NOT_A_FOLDER` |
| `fs.size`, `fs.readText` | exists → `NOT_FOUND`; is file → `NOT_A_FILE`; (readText) opaque / invalid UTF-8 / contains NUL → `NOT_TEXT` |
| `fs.writeText` | path is root → `ROOT_PROTECTED`; parent exists and is a folder → `NOT_FOUND`; target is a folder → `NOT_A_FILE` |
| `fs.makeFolder` | path is root → `ALREADY_EXISTS`; parent exists and is a folder → `NOT_FOUND`; target exists (any type) → `ALREADY_EXISTS` |
| `fs.rename` | new name valid → `INVALID_NAME`; source exists → `NOT_FOUND`; source is root → `ROOT_PROTECTED`; a sibling (other than the source itself) has the same lowercase name → `ALREADY_EXISTS` |
| `fs.move`, `fs.copy` | source exists → `NOT_FOUND`; source is root → `ROOT_PROTECTED`; destination exists → `NOT_FOUND`; destination is a folder → `NOT_A_FOLDER`; destination is the source or inside it → `INVALID_MOVE`; `destination/name` exists (including the source itself) → `ALREADY_EXISTS` |
| `fs.delete` | exists → `NOT_FOUND`; is root → `ROOT_PROTECTED`; folder is empty → `NOT_EMPTY` |
| `list.sortBy` | for keys `size`: every item exists → `NOT_FOUND` and is a file → `NOT_A_FILE`; for `modified`: every item exists → `NOT_FOUND` (checked in list order; `name`/`ext` never touch the disk) |

- `list.sortBy` sort keys are `name`: `(lower(name), name)`; `ext`: `(lower(ext), ext)`; `size` / `modified`: the number. Sorting is stable. Ties keep their input order, and `descending` reverses the comparison without breaking stability (Python `sorted(..., reverse=True)` is also stable).
- `list.sortBy` with key `size` or `modified` counts as one read.

**Output**
- `print` text containing `\n` produces one output line per `\n`-separated segment. Conformance splits both sides on `\n` only, after undoing Python's `\n` → `\r\n` stdout translation on Windows, so a `\r` inside printed text compares the same on every OS.
- The exported script reconfigures stdout and stderr to UTF-8 (`errors="replace"`) so that names print the same on any console.

## 6. Composites

### 6.1 Shape and registry

```ts
// src/ir/composites.ts
export interface CompositeStmt {
  id: NodeId;
  kind: 'composite';
  name: CompositeName;                       // 'renameByPattern' | 'sortByType' | 'findAndAct' | 'findFirst'
  fields: Record<string, string | number | boolean | null>;  // literal config (patterns, enums); null = unset optional field
  inputs: Record<string, Expr>;              // expression sockets (e.g. folder)
  bodies: Record<string, Stmt[]>;            // statement slots (e.g. found / notFound)
  binds: Record<string, string>;             // user-visible names it introduces (e.g. { candidate: 'log' })
}

export interface CompositeDef {
  name: CompositeName;
  label: string;
  fields: FieldSchema[];
  inputs: Record<string, Type>;
  bodies: string[];
  binds: Record<string, Type>;               // visible inside inputs/bodies
  desugar(node: CompositeStmt, ctx: DesugarCtx): Stmt[];
}

export interface DesugarCtx {
  freshName(base: string): string;           // 'file' → 'file' or 'file_2' if taken (deterministic)
  id(local: string): NodeId;                 // `${node.id}/${local}`
}
```

`desugarProgram(program)` replaces composites recursively, innermost first, and is pure and deterministic. v1.1 supersedes this order with an outer-first repeated desugaring pass so action composites can introduce and control the positions where expression actions are hoisted. Hygiene works like this: the temporaries a composite introduces (`n`, `items`, `low`…) get names from `freshName`, which avoids every name already used in the enclosing scope. `binds` names are chosen by the user, so the user can reference them.

Further desugaring rules (contract-v1):
- **Each input expression is emitted exactly once.** If the desugaring needs an input value in more than one place (e.g. `folder` in both `fs.list(folder)` and `fs.join(folder, group)`), it first assigns it to a fresh temporary and uses the temporary everywhere. Copying an expression subtree would duplicate node IDs (`DUPLICATE_ID`) and evaluate it more than once. Inputs that are evaluated repeatedly *by design* (the `findFirst` condition, evaluated once per probe) are placed once inside the loop body.
- Every node a desugaring creates gets a derived ID `ctx.id(local)`, with `local` unique within the composite. User-supplied subtrees (inputs, bodies) keep their own IDs.
- Inputs that the chosen variant does not use (e.g. `destination` when `findAndAct` has `action = delete`) are not emitted by the desugaring, even if the socket is filled, so they are never evaluated.
- The output must pass `validateProgram(p, { primitiveOnly: true })` with no errors.
- `findAndAct` criteria (all inclusive):
  - `extension`: compares `lower(fs.ext(item))` to the lowercase field value, with any leading `.` stripped.
  - `minSize` / `maxSize`: `size ≥ min` / `size ≤ max`.
  - `modifiedAfter D`: `modified ≥ midnight UTC of D`.
  - `modifiedBefore D`: `modified < midnight UTC of D`.
  - `namePattern`: `text.wildcard(fs.name(item), pattern)`.
- `findAndAct` with `recursive = false` acts only on files (not folders) directly in `folder`.
- `findAndAct` with `action = rename` uses the same template language as `renameByPattern`, and its `{n}` counts matched files in iteration order. It skips the rename when the new name equals the current name.

### 6.2 Desugarings

The pseudocode below uses Python-like notation, with IR ops written as calls.

**Rename by pattern.** Fields: `match` (wildcard), `template`. Input: `folder`.
Template placeholders, parsed at desugar time:
- `{name}` = stem
- `{ext}` = extension with its dot, or `''`
- `{n}` / `{n:3}` = 1-based counter, optionally zero-padded
- `{date}` = modified date as `YYYY-MM-DD` (via `text.date` helper)
- literal `{{` and `}}`

```
n = 0                                   # only if template uses {n}
for item in fs.list(folder):
    if not fs.isFolder(item) and text.wildcard(fs.name(item), MATCH):
        n = n + 1
        new_name = <concatenation built from template>
        if new_name != fs.name(item):
            fs.rename(item, new_name)
```

**Sort into folders by type.** Field: `grouping` ∈ `extension | category`. Input: `folder`.
- With `category`, a fixed table maps extensions to `Images`, `Documents`, `Audio`, `Video`, `Archives`, `Code`, or `Other`. It desugars to an `if/else` chain over `list.contains([...], ext)`.
- Files with no extension go to `No extension` (extension mode) or `Other` (category mode).

```
for item in fs.list(folder):
    if not fs.isFolder(item):
        ext = text.lower(fs.ext(item))
        group = <ext or category chain>
        target = fs.join(folder, group)
        if not fs.exists(target):
            fs.makeFolder(target)
        fs.move(item, target)
```

**Find files and act.**
- Fields: `recursive: bool`, `namePattern?`, `extension?`, `minSize?`, `maxSize?`, `modifiedAfter?`, `modifiedBefore?`, `action` ∈ `move | copy | delete | rename`, `renameTemplate?`.
- Inputs: `folder`, and `destination` (for move/copy).
- Criteria that aren't set are left out. Criteria that are set are combined with `and`.

```
items = fs.walk(folder)                 # or: files of fs.list(folder) when not recursive
for item in items:
    if <criteria>:
        <action>                        # move/copy guarded by: fs.parent(item) != destination
```

**Find first where (bisect).**
- Fields: `sortBy` ∈ `name | modified | size`.
- Input: `folder`. Expression input: `condition` (bool), which may reference the bound `candidate`.
- Bodies: `found` (may reference the bound `match`) and `notFound`.

```
files = []                              # files (not folders) of fs.list(folder)
for item in fs.list(folder):
    if not fs.isFolder(item):
        list.append(files, item)
items = list.sortBy(files, SORT_BY, False)
low = 0                                 # hint: indexInto 'items'
high = list.length(items)               # hint: indexInto 'items'
while low < high:
    mid = (low + high) // 2             # hint: indexInto 'items'
    candidate = list.get(items, mid)
    if <condition>:
        high = mid
    else:
        low = mid + 1
if low < list.length(items):
    match = list.get(items, low)
    <found>
else:
    <notFound>
```

The block's help text says the condition must be "false, false, …, then true from some point on". That's the monotonic requirement for bisect, written in plain words.

## 7. Simulator

### 7.1 Sandbox FS model (`domains/fileExplorer/fs.ts`)

```ts
// fsTypes.ts (contract)
export interface FsFile   { type: 'file'; name: string; modified: number; content?: string; binarySize?: number }
export interface FsFolder { type: 'folder'; name: string; modified: number; children: readonly FsNode[] } // sorted per §5.3
export type FsNode = FsFile | FsFolder;
export interface SandboxFS { root: FsFolder }

export interface Scenario {
  id: string; title: string; description: string;
  tree: SandboxFS;
  suggestedComposite?: CompositeName;
}
```

The FS is **immutable with structural sharing**. Each mutation copies only the path from root to the changed node, so storing one FS reference per snapshot is cheap.

### 7.2 Interpreter

- A tree-walking interpreter over desugared IR, written as a generator (`function*`) so it can yield snapshots.
- Snapshots are emitted:
  - after every statement completes,
  - after every condition evaluation of `if`/`while`/`forEach` (so stepping shows checks),
  - after every FS op with `counter ≠ none`.
- The step limit defaults to 10,000 snapshots and is configurable. Exceeding it stops with `STEP_LIMIT`.
- The recursion limit is 200 user call frames, which gives `RECURSION_LIMIT`.
- Runs in a Web Worker. The protocol types (`WorkerRequest`, `WorkerResponse`) and the snapshot types below are defined in **`src/ir/timeline.ts`** (not `sim/`), generic over the domain state `S`, so `playground/` and `export/` can use them without importing `sim/`.

```ts
// main → worker
{ type: 'run'; program: Program /* desugared */; state: S; options: { stepLimit: number } }
// worker → main
{ type: 'done'; timeline: Timeline<S> }   // structured clone preserves shared subtrees
{ type: 'invalid'; errors: ValidationError[] }
{ type: 'crash'; message: string }
```

### 7.3 Snapshot format

See `src/ir/timeline.ts` for the authoritative definitions. Summary:

```ts
export interface Snapshot<S> {
  index: number;
  nodeId: NodeId;                       // active node
  event: 'stmt' | 'cond' | 'fsRead' | 'fsOp' | 'call' | 'return' | 'error' | 'done';
  state: S;                             // file explorer: SandboxFS
  frames: { fn: string | null; vars: Record<string, Value> }[];   // [0] = program scope
  hints: Record<string, VarHint>;       // per visible variable
  counters: { steps: number; reads: number; fileOps: number; comparisons: number };
  action?: Action;                      // set when event = 'fsOp'
  readPaths?: string[];                 // set when event = 'fsRead' (click-to-trace)
  output: number;                       // count of output lines so far (lines live in timeline.output)
  error?: { code: ErrorCode; nodeId: NodeId; message: string };
}

export interface Action {
  op: 'RENAME' | 'MOVE' | 'COPY' | 'DELETE' | 'MKDIR' | 'WRITE';
  from: string;                         // relative POSIX path
  to?: string;                          // RENAME/MOVE/COPY: the NEW FULL relative path
  destructive: boolean;
}

export interface Timeline<S> { snapshots: Snapshot<S>[]; output: OutputLine[]; outcome: 'done' | 'error' }
export type OutputLine = { kind: 'print'; text: string } | { kind: 'action'; text: string };
```

- `formatAction(action)` in `timeline.ts` produces the §7.4 line; both sides must use the same format.
- `rename`, `move`, and `copy` preserve modified times (copy is deep, like `shutil.copy2`/`copytree`); `writeText` and `makeFolder` set it to the simulation clock (§5.3).
- Wildcard `*` and `?` match any character **including newlines** (Python side: compile with `re.DOTALL` for wildcards only; user regexes use `re.ASCII` alone).
- Floats can become `inf`/`nan` (e.g. `1e308 * 10`); they print as Python does (`inf`, `nan`). `math.floor` of a non-finite float is a known divergence (§12).

- `comparisons` counts every evaluated `== != < <= > >=`.
- `reads` counts FS ops with `counter: 'read'`.
- The UI derives the before→after diff from `action` together with the previous snapshot's FS.

### 7.4 Action log line format

This is shared exactly with the Python runtime and checked by conformance:

```
RENAME <from> -> <to-name>
MOVE   <from> -> <to-folder>/
COPY   <from> -> <to-folder>/
DELETE <path>
MKDIR  <path>/
WRITE  <path>
```

- Paths are relative POSIX, and the root is `.`.
- Columns are padded to width 6 after the verb.
- In Python dry-run mode, each line is prefixed with `[dry run] `.

## 8. Python Exporter

### 8.1 Script layout

```python
#!/usr/bin/env python3
"""
<Program title> — exported from BeepBlocks

What it does:
  <one plain-language line per top-level block, from op/composite labels>

⚠ This script can DELETE or OVERWRITE files:      (only if destructive ops exist)
  - Delete files matching *.tmp (block abc12)

How to run:
  python script.py "C:\path\to\folder"            # preview only (dry run, default)
  python script.py "C:\path\to\folder" --apply    # actually make the changes

Changes are not undoable. Run the preview first.
"""
import argparse, re, shutil, sys
from pathlib import Path

# ======================= YOUR PROGRAM =======================

def rename_photos(folder):          # function blocks → def
    ...

def main(fs):
    # [block abc12] Rename files matching "IMG_*.jpg" to "photo_{n:3}{ext}"
    n = 0
    for item in fs.list(fs.root()):
        ...

# ============ BEEPBLOCKS RUNTIME (do not edit) ============
# _BPError, _BPPath, _RealFS, _PlanFS, helpers ...

if __name__ == "__main__":
    _bp_entry(main)
```

The program comes first so users read their logic before the runtime.

### 8.2 Emission rules

- General ops become idiomatic Python wherever Python semantics already match: `a + b`, `len(x)`, `x.lower()`, `items[i]` (after a bounds check helper only where needed: `_bp_get(items, i, "id")`), `str(x)`, `range(a, b)`, `a // b`.
- Ops whose semantics need help go through the runtime with readable names: `fs.rename(item, new_name)`, `_bp_wildcard(name, "*.jpg")`, `_bp_regex_replace(...)`.
- Every FS op call passes its node ID as the last keyword argument (`fs.rename(item, new_name, at="abc12/rename")`), so errors report the block.
- Top-level statements are emitted inside `main(fs)`. Functions become top-level `def`s.
- Each statement originating from a top-level block or composite gets a `# [block <id>] <label>` comment. Desugared composites emit the comment once, above their expansion.
- Output is formatted with 4-space indentation and no trailing whitespace. A golden-file test locks the formatting.

### 8.3 Python runtime (`export/python/runtime.py`)

This is a real `.py` file, so it can be linted and unit-tested with Python directly. Because `?raw` imports work only under Vite (the conformance runner uses Node via `tsx`), `pnpm gen:runtime` regenerates `export/python/runtime.gen.ts`, which exports the file's text as a string constant. The emitter imports only `runtime.gen.ts`, and a unit test fails if the generated file is out of date.

- `_BPPath`: an immutable relative path. Its `__eq__`/`__hash__` are case-insensitive, and `__str__` returns the relative POSIX form (`.` for root).
- Runtime FS methods use snake_case names (`read_text`, `write_text`, `make_folder`, `is_folder`, …); the emitter maps each IR op (`fs.writeText`) to its method (`fs.write_text`).
- `_RealFS(root)` implements every `fs.*` op from §5.3 on the real disk:
  - It **checks preconditions explicitly before acting**. For example, `Path.rename` silently overwrites on POSIX but raises on Windows, so the runtime checks first.
  - It reads and writes with `encoding="utf-8", newline=""`, so line endings are never translated.
  - `fs.modified` returns `int(st_mtime)`.
  - `fs.list` sorts with the same key as the simulator.
- `_PlanFS(root)` is the **dry-run** implementation:
  - It lazily loads real metadata into an in-memory overlay and applies every mutation to the overlay only.
  - Later reads therefore see planned changes. For example, "create folder, then move into it" previews correctly.
  - Content reads of untouched files come from disk. Content reads of overlay files come from memory.
- Every mutation prints its action log line (§7.4). `_PlanFS` adds the `[dry run]` prefix.
- `_bp_entry(main)`:
  - parses `root` (must exist and be a folder) and `--apply`,
  - builds `_RealFS` or `_PlanFS`,
  - runs `main`,
  - catches `_BPError` and prints the error, exiting with code 1.

## 9. Block Editor

- **Block ↔ IR mapping.** There's one Blockly block type per statement kind, expression kind, op, and composite, generated from `ir/ops.ts` signatures plus per-op label strings. Output and input `check`s use the type names (`number`, `text`, `bool`, `path`, `list`), so most type errors are prevented while dragging.
- **Palette order:** In v1, Tasks (composites), Files, Logic, Loops, Variables, Lists, Text, Math, Functions. v1.1 uses a human-action default palette and appends the v1 primitive categories when `showAdvanced` is enabled.
- **`wsToIr(workspace)`** is a custom traversal (not a Blockly code generator). Disconnected stacks other than the main "when run" stack are ignored, and the user gets a warning.
- **`irToWs(program, layout)`** is used for loading projects and for Expand.
- **Expand:** v1.1 replaces this with level-aware expansion:
  1. `desugarOne` expands one composite level, while `desugarFully` expands all levels.
  2. Convert the resulting primitive subtree to blocks with `irToWs`, keeping desugared IDs.
  3. Splice the blocks in place inside one Blockly event group, so a single undo reverts it.
- **Validation:** runs on workspace change, debounced at 300 ms. Blocks with errors get a Blockly warning icon and the plain-language message.
- **Variables:** Blockly variables carry their type. Blocks that create bound names (`candidate`, `match`) show those names as editable fields.
- **Keyboard** (`@blockly/keyboard-navigation`, verified with real key events in `pnpm smoke`):
  - Tab moves palette → palette flyout → workspace. Arrow keys move the cursor between blocks, inputs, and fields; → enters a block's inputs.
  - T opens the palette, / shows all shortcuts. Enter on a field opens its editor (dropdown, text, checkbox, date). Ctrl+Enter (Alt/⌘+Enter) opens the block's menu, which includes the v1.1 level-aware expand actions on composites.
  - Blockly binds keydown on its injection div (and the dropdown div), not on `document`, so keys pressed elsewhere in the page never trigger editor shortcuts (tests pin this; there is deliberately no global key guard).
- **Non-colour cues:** the running block has a solid 5 px outline, blocks marked by "Show block"/click-to-trace a dashed 3 px outline, and the keyboard-focused block or field a dotted 3 px outline (`.blocklyActiveFocus`). "Show block" scrolls the first marked block into view and announces "Showing the block." in the editor's status region; during playback the running block is scrolled into view only when it is completely off-screen. Block colours keep white text ≥ 4.5:1 (unit-tested).

## 10. Playground UI (file explorer theme)

Layout, left to right: **Editor | Playground**. Below the playground sits the timeline bar.

- **Explorer view:**
  - Folder tree plus a file list with icon, name, size (human-readable), and modified date (UTC, `YYYY-MM-DD HH:mm`).
  - When a bisect `items` hint is active, the file list sorts by the composite's `sortBy` key.
- **Diff states** relative to the previous snapshot, each shown with an icon and text label, not just color:
  - created (＋ "new")
  - renamed/moved (→ "moved"/"renamed")
  - modified (✎ "changed")
  - deleted (shown faded with strike-through and "deleted" for one step)
- **Position gutter:** whenever the file list is showing a list variable that has a `VarHint` (bisect `items`, or a hinted list being iterated by the active `forEach`), each row shows its 0-based position, with a final "end = length" marker row. Unhinted lists get no gutter. This makes half-open ranges (`low ≤ i < high`, `range(0, n)`) visible instead of abstract.
- **Variable tags:**
  - A `path` variable becomes a pill tag on that item.
  - A `number` variable with a `VarHint` becomes a tag on `items[value]`. If the value equals the list length, it shows as "end" after the last row.
  - Tags whose path no longer exists are listed as "(missing)" in the variables panel.
- **Panels:**
  - Variables: name, type, value.
  - Counters: steps, reads, file changes, comparisons, plus "list size" during bisect.
  - Output: print lines and action lines.
- **Controls:**
  - Run, Pause, Step back, Step forward, and Reset.
  - A scrubber (range input) and a speed selector (0.25×–8×).
  - Keyboard shortcuts: Space = run/pause, ←/→ = step, Home = reset. They work anywhere inside the playground region except where a widget handles the key itself (text fields, the folder tree, and the file list; see "Keyboard" below).
  - There is a single Run button, in this timeline bar (not duplicated in the top bar). While the program is invalid, the app passes `runBlockedReason`: Run and Space are disabled and the reason is shown as visible text next to the button, since a disabled button can't take focus to reveal a tooltip.
- **Click-to-trace.** Clicking an item highlights every block whose snapshot touched that path. The trace comes from `action.from/to` and from `fsRead` events tagged with their path.
- **Stale marker.** Editing the program after a run greys the timeline (grayscale, no opacity) and shows "Program changed — run again" (Req 8.4).
- **Scenario editor.** An "Edit scenario" mode makes the explorer editable: add, rename, and delete items, and set size, date, and content. Reset restores the scenario's saved tree.
- **Keyboard** (Req 13.4; walked through with real key events in `pnpm smoke`):
  - Skip links ("Skip to the block editor", "Skip to the playground") are the first Tab stops.
  - Folder tree (ARIA tree): ↑/↓ move, → expands or enters, ← collapses or goes to the parent, Home/End first/last, Enter/Space selects. The tree consumes these keys, so they never step the timeline.
  - File list (ARIA listbox): ↑/↓/Home/End move, Enter/Space trace the item (run view) or edit it (scenario mode). In folder view → opens a folder row and ←/Backspace go up one folder; in list view ←/→ remain timeline shortcuts. Each row's text includes its badges, tags, and sr-only "size"/"modified" labels (the column header is `aria-hidden`).
  - Playback controls keep focus inside the playground: when the focused control becomes disabled, focus moves to its counterpart (Run ↔ Pause, Step back ↔ Step forward). While a run starts, focus waits on the toolbar and moves to Pause once the timeline arrives.
  - The Output list is focusable, so it can be scrolled from the keyboard.
- **Announcements:** one polite live region says "Step N of M: …" when stepping manually, on pause, on done, on error, and "Reset to the starting files." on reset; automatic playback steps are not announced. The error banner (`role=alert`) and stale message (`role=status`) stay mounted and only change their text, so screen readers announce them. The error banner has a "Show block" button (`onShowBlock`). The stale message also describes the explorer and panels (`aria-describedby`).
- **Scenario editor focus:** after a rename, focus stays in the name field; after a delete, it moves to the parent folder in the tree. Choosing a folder or item does not move focus.

### 10.1 Domain theme interface (Req 11.1)

```ts
export interface DomainTheme<S> {
  id: string; title: string;
  ops: OpSignature[];                    // domain ops merged into the registry
  composites: CompositeDef[];
  blocks: BlockDefinitionSet;
  scenarios: Scenario[];                 // generic over S in future domains
  Renderer: React.ComponentType<{ snapshot: Snapshot; prev?: Snapshot; timeline: Timeline }>;
  simOps: Record<string, SimOpImpl<S>>;
  pyRuntime: string;
}
```

v1 registers one theme, `fileExplorer`. The IR core, interpreter loop, and exporter skeleton don't depend on it.

### 10.2 Visual themes

- CSS custom properties hold the light and dark presets.
- Text sits on three backgrounds: `--bp-bg`, `--bp-surface`, and `--bp-highlight-bg` (the active row's tint). `--bp-highlight` is a stroke/marker colour only (running block, keyboard cursor), never behind text; it reaches 3:1 on bg.
- The accent color is user-chosen. It is used for text, tags and focus rings, so the applied accent is the user's color blended toward the preset foreground just enough to reach 4.5:1 against all three text backgrounds (the settings menu shows the adjusted color when that happens). Foreground-on-accent is black or white, whichever contrasts more, which is always at least 4.58:1.
- Preset text colors reach 4.5:1 on all three backgrounds, and borders 3:1 on bg and surface (unit-tested, including 10 extreme accents per mode).
- No text is dimmed with `opacity` (it would undo the contrast guarantees): deleted rows use the muted colour plus strike-through, and the stale state uses grayscale plus the "Program changed" message.
- The Blockly theme is derived from the same variables.
- Settings persist in `localStorage` under the key `beepblocks.settings`.
- `pnpm smoke` runs axe-core (WCAG 2.1 A/AA rules) in several page states in both presets and fails on any violation.

## 11. Conformance Suite

```
conformance/fixtures/<name>/
  program.json      # IR (composites allowed)
  tree.json         # SandboxFS
  expected.json     # optional golden: { tree?, error?: {code,nodeId}, output? }
```

`pnpm conformance` runs these steps for each fixture:

1. Validate, then desugar.
2. **Simulate.** Record the final FS, the error if any, and the output lines.
3. **Export.** Write `script.py` to a temp dir.
4. **Apply run.** Materialize `tree.json` into a fresh temp folder, setting mtimes with `os.utime`. Run `python script.py <dir> --apply` and read back the resulting tree.
5. **Dry-run.** Run on another fresh copy without `--apply`, then assert the folder is **unchanged**.
6. Compare and require all of the following to be equal:
   - the tree: structure, names (case-sensitive), file content bytes, and binary sizes. Mtimes are compared only for files the program never touched.
   - the error: `code` + `nodeId`, or none on both sides.
   - the output: apply-mode output vs simulator output, and dry-run output vs simulator output with the `[dry run] ` prefix stripped.
7. If `expected.json` exists, also compare against it. This catches cases where both implementations are wrong in the same way.

Coverage requirement: every op, every error code except `STEP_LIMIT`/`RECURSION_LIMIT`, and every composite × field variant appears in at least one fixture. `conformance/coverage.ts` checks this and fails if something is missing.

Starter fixtures: `starter-<scenario id>` runs each starter project (§13.1) on its full built-in scenario. `pnpm gen:starters` writes their `program.json` and `tree.json` from `src/app/starters.ts`, and `conformance/starters.test.ts` fails if they drift. Their `expected.json` (output and error) is derived by hand and never generated. The runner deletes a fixture's temp folder once it passes, since starter trees hold ~100 MB of binary files.

## 12. Known Divergences (documented, not tested)

| Area | Simulator | Python | Mitigation |
|---|---|---|---|
| Step limit | stops at N steps | runs to completion | header notes it; sandbox shows the warning |
| Recursion | 200 frames | ~1000 frames | rarely reached in practice |
| Integers beyond 2^53 | `INT_OVERFLOW` error | arbitrary precision | validator warns on large literals |
| Times of items written during the run | simulation clock | wall clock | excluded from comparisons |
| External interference | none | other processes may change files | dry-run preview, precondition checks |
| Folder modified times | unchanged by content changes | OS updates them | folder times never compared |
| Names differing only in case on a case-sensitive disk (e.g. `a.txt` and `A.txt` on Linux) | impossible (sandbox forbids it) | `_RealFS` raises `INVALID_NAME` ("ambiguous name") when resolving such a segment | documented in the script header |
| Partial failure | stops, sandbox resettable | earlier changes remain on disk | header warning; dry-run default |
| Non-finite / out-of-range numbers (`math.floor(inf)`, `text.date` of a huge time, `list.range` > 1,000,000 items) | `INT_OVERFLOW` / `INVALID_NUMBER` / `STEP_LIMIT` | Python raises its own exception (exit 2) | rare; excluded from conformance |

## 13. Persistence

```ts
interface ProjectFile {
  format: 'beepblocks-project';
  version: 1;
  title: string;
  program: Program;                      // un-desugared (composites preserved)
  layout: Record<NodeId, { x: number; y: number }>;   // top-level stacks only
  scenario: Scenario;
}
```

- Autosave goes to `localStorage` (`beepblocks.project`), debounced at 1 s, and is flushed on `beforeunload`. If storage refuses the write, a banner suggests "Save file".
- Import/export uses `.beep.json` files.
- An import is fully validated (format, version, IR structure, scenario) before it replaces the current project. On failure, the errors are shown and nothing changes (Req 12.3).
- A saved program may be work in progress: the editor emits `null` for empty sockets. Loading therefore checks the program with `validateStructure` (the structural phase of the validator, with empty sockets allowed) rather than the full validator; Run and Export still require a fully valid program. Scenario trees are checked with the same name rules as the scenario editor (unique case-insensitive names, exactly one of `content`/`binarySize`, integer mtimes), and folder children are re-sorted into §5.3 order on load.

### 13.1 Starter projects

`src/app/starters.ts` defines one starter per built-in scenario, each built around the scenario's `suggestedComposite`:

| Scenario | Starter | Program |
|---|---|---|
| `messy-downloads` | Sort my downloads | `sortByType` (category) on the root |
| `camera-photos` | Rename camera photos | `renameByPattern` `IMG_*` → `{date}_{n:3}{ext}` |
| `project-tree` | Clear out temporary files | if `Trash` is missing, make it; then `findAndAct` (recursive, extension `tmp`, move to `Trash`) |
| `nightly-logs` | Find the first failing night | `findFirst` by name where the log contains `status: ERROR`; prints the match (6 log reads) |

- First run (no autosave) opens the first starter instead of an empty program.
- "New…" opens a dialog listing every starter ("Open", one click) plus "Blank project" on the current scenario. The dialog itself is the confirmation that the current project is replaced.

## 14. Error Handling Summary

| Layer | Behavior |
|---|---|
| Editor | Blocks with validation errors are marked; Run and Export are disabled while the IR is invalid, with a visible explanation. The app validates again before desugaring, because the editor's IR can contain empty sockets |
| Simulator | Runtime errors end the timeline with an `error` snapshot; the playground shows a banner and the responsible block is highlighted |
| Worker crash | Caught on main thread; "The simulator stopped unexpectedly" banner; the app stays usable |
| Exporter | Refuses invalid IR; lists the errors (Req 9.8) |
| Import | Validated before applying; no partial state |
| Python script | `_BPError` → stderr message with block ID, exit 1; unexpected exceptions → generic message plus traceback |

## 15. Testing Strategy

- **Unit tests (Vitest):**
  - IR validator and typechecker
  - Python value semantics, including the `formatPyFloat` table, `//`, `%`, and int/float
  - each FS op and every one of its error paths
  - each desugaring, using golden IR snapshots
  - `wsToIr`/`irToWs` round trip
  - exporter golden files
- **Python runtime tests:** `python -m unittest` on `runtime.py` against a temp dir, covering `_RealFS` and `_PlanFS`.
- **Conformance:** §11. This is the release gate.
- **Completeness tests:** every op in `ir/ops.ts` has a sim implementation, a Python emission, a block definition, and fixture coverage.
- **Browser smoke (`pnpm smoke`, installed Edge over CDP):** first run, starters, a real-key keyboard walkthrough, export, themes, and axe-core WCAG 2.1 AA audits (§10, §10.2).
- **End-to-end (`pnpm e2e`, Playwright: Chromium and Firefox, one run per engine; the installed Edge is covered by `pnpm smoke`):** for every starter in each engine: run, pause, scrub, step; the Output panel equals the starter fixture's golden; Expand (mouse) and re-run gives the same output (the check waits for a new, non-stale playback); both exported scripts (before and after Expand) dry-run unchanged and `--apply` to the simulator's tree on a real copy of the scenario.
- **UI:** component tests for timeline controls and tag placement. Manual accessibility check covering keyboard-only use and contrast.

## 16. Parallel Implementation Plan (preview for tasks.md)

| Phase | Work | Parallel? |
|---|---|---|
| 0 | Scaffold: Vite/React/TS, lint rules, `ir/` contract, `fsTypes.ts`, op registry, stub modules, 3 seed conformance fixtures, conformance runner skeleton | Sequential (integrator) |
| 1 | **Sim** (fs model, interpreter, worker, scenarios) · **Export** (emitter, runtime.py) · **Composites** (4 desugarings) · **Editor** (blocks, ws↔IR, Expand) · **Playground** (renderer, panels, controls on a mock timeline) | **Parallel** — each confined to its folder, contract read-only |
| 2 | App shell, store, persistence, visual themes, wiring; full conformance fixtures; fix drift | Sequential (integrator) |
| 3 | Accessibility pass, scenario polish, end-to-end manual verification | Sequential |

Any change to `ir/` during Phase 1 goes through the integrator and is announced to every workstream.
