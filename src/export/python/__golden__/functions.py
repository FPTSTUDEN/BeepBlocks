#!/usr/bin/env python3
r"""functions — exported from BeepBlocks

What it does:
  - Show fact(10) as text
  - Set xs to an empty list
  - Run add_all(xs, 5)
  - Show length of xs as text
  - Show count_files(the chosen folder) as text
  - Show first_name("docs" inside the chosen folder)
  - Show first_name("empty" inside the chosen folder)
  - Set i to 0
  - Repeat while i < 3
  - If i > 5 (otherwise something else)

Functions it uses:
  - Function fact(n)
  - Function add_all(items, x)
  - Function count_files(folder)
  - Function first_name(folder)
  - Function nothing()

How to run:
  python script.py "C:\path\to\folder"            # preview only (dry run, default)
  python script.py "C:\path\to\folder" --apply    # actually make the changes
  (On macOS and Linux, use python3 and a path like ~/folder.)

Changes are not undoable. Run the preview first.

Good to know:
  - The preview lists every change it would make, marked "[dry run]", and changes
    nothing. Only --apply touches your files.
  - If the script stops with an error part-way through, the changes it already made
    with --apply stay made; nothing is rolled back. Check the folder before running
    it again.
  - Names are compared ignoring upper/lower case, as on Windows. On a case-sensitive
    disk (usually Linux), two names that differ only in case (a.txt and A.txt) make
    the script stop with an INVALID_NAME error.
  - Unlike the playground, the script has no step limit, and items it creates get
    the computer's current time as their modified time.
"""
import argparse
import builtins as _bp_builtins
import math
import os
import re
import shutil
import sys
import time as _bp_time
import traceback as _bp_traceback
import warnings as _bp_warnings
from datetime import datetime, timedelta as _bp_timedelta, timezone
from pathlib import Path


# ======================= YOUR PROGRAM =======================


# [block id1] Function fact(n)
def fact(n):
    # [block id2] If n <= 1 (otherwise something else)
    if n <= 1:
        return 1
    else:
        return n * fact(n - 1)


# [block id3] Function add_all(items, x)
def add_all(items, x):
    # [block id4] Add x to the end of items
    items.append(x)


# [block id5] Function count_files(folder)
def count_files(folder):
    # [block id6] Give back length of all files in folder and its subfolders
    return len(fs.walk(folder, at="id7"))


# [block id8] Function first_name(folder)
def first_name(folder):
    # [block id9] For each p in items in folder
    for p in fs.list(folder, at="id10"):
        return fs.name(p)

    # [block id11] Give back "(none)"
    return "(none)"


# [block id12] Function nothing()
def nothing():
    pass


def main(fs):
    # [block id13] Show fact(10) as text
    print(str(fact(10)))

    # [block id14] Set xs to an empty list
    xs = []

    # [block id15] Run add_all(xs, 5)
    add_all(xs, 5)

    # [block id16] Show length of xs as text
    print(str(len(xs)))

    # [block id17] Show count_files(the chosen folder) as text
    print(str(count_files(fs.root())))

    # [block id18] Show first_name("docs" inside the chosen folder)
    print(first_name(fs.join(fs.root(), "docs", at="id19")))

    # [block id20] Show first_name("empty" inside the chosen folder)
    print(first_name(fs.join(fs.root(), "empty", at="id21")))

    # [block id22] Set i to 0
    i = 0

    # [block id23] Repeat while i < 3
    while i < 3:
        i = i + 1
        print(str(i))

    # [block id24] If i > 5 (otherwise something else)
    if i > 5:
        print("big")
    elif i > 2:
        print("medium")
    else:
        print("small")


# ============ BEEPBLOCKS RUNTIME (do not edit) ============

_bp_Exception = _bp_builtins.Exception
_bp_AttributeError = _bp_builtins.AttributeError
_bp_KeyboardInterrupt = _bp_builtins.KeyboardInterrupt
_bp_OSError = _bp_builtins.OSError
_bp_OverflowError = _bp_builtins.OverflowError
_bp_UnicodeDecodeError = _bp_builtins.UnicodeDecodeError
_bp_ValueError = _bp_builtins.ValueError
_bp_repr = _bp_builtins.repr
_bp_set_slot = _bp_builtins.object.__setattr__

_bp_MAX_SAFE_INT = 9007199254740991
_bp_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_bp_DRY_RUN_PREFIX = "[dry run] "


class _BPError(_bp_Exception):
    """A runtime error of the program, reported with the id of the block that caused it."""

    def __init__(self, code, node_id, message):
        _bp_Exception.__init__(self, message)
        self.code = code
        self.node_id = node_id
        self.message = message


# ------------------------------------------------------------------------------ paths


def _bp_rel_join(folder, name):
    return name if folder == "" else folder + "/" + name


def _bp_rel_parent(rel):
    i = rel.rfind("/")
    return "" if i < 0 else rel[:i]


def _bp_rel_name(rel):
    i = rel.rfind("/")
    return rel if i < 0 else rel[i + 1 :]


def _bp_rel_stem(rel):
    name = _bp_rel_name(rel)
    i = name.rfind(".")
    return name[:i] if 0 < i < len(name) - 1 else name


def _bp_rel_ext(rel):
    name = _bp_rel_name(rel)
    i = name.rfind(".")
    return name[i + 1 :] if 0 < i < len(name) - 1 else ""


def _bp_shown(rel):
    return "." if rel == "" else rel


def _bp_q(rel):
    return '"' + _bp_shown(rel) + '"'


class _BPPath:
    """A file or folder inside the chosen folder.

    Immutable. Stores the relative POSIX path as the program produced it ('' = the chosen
    folder). Equality and hashing ignore upper/lower case; str() gives the POSIX form, '.'
    for the chosen folder itself.
    """

    __slots__ = ("rel", "_key")

    def __init__(self, rel=""):
        _bp_set_slot(self, "rel", rel)
        _bp_set_slot(self, "_key", rel.lower())

    def __setattr__(self, name, value):
        raise _bp_AttributeError("paths cannot be changed")

    def __delattr__(self, name):
        raise _bp_AttributeError("paths cannot be changed")

    def __eq__(self, other):
        return isinstance(other, _BPPath) and self._key == other._key

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return self._key.__hash__()

    def __str__(self):
        return _bp_shown(self.rel)

    def __repr__(self):
        return "_BPPath(" + _bp_repr(self.rel) + ")"


def _bp_by_name(path):
    """Sort key of list.sortBy 'name': lowercase first, then code point."""
    name = _bp_rel_name(path.rel)
    return (name.lower(), name)


def _bp_by_ext(path):
    """Sort key of list.sortBy 'ext'."""
    ext = _bp_rel_ext(path.rel)
    return (ext.lower(), ext)


def _bp_name_key(name):
    return (name.lower(), name)


# ------------------------------------------------------------------------- name rules

_bp_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}  # fmt: skip
_bp_FORBIDDEN_CHARS = re.compile('[<>:"/\\\\|?*\\x00-\\x1f]')


def _bp_check_name(name):
    """Windows-strict name rules, applied on every OS. Returns a problem or None."""
    if len(name) == 0:
        return "A name cannot be empty."
    if len(name) > 255:
        return "A name can be at most 255 characters."
    if name == "." or name == "..":
        return '"' + name + '" is not allowed as a name.'
    bad = _bp_FORBIDDEN_CHARS.search(name)
    if bad is not None:
        c = bad.group(0)
        shown = "a control character" if c < " " else '"' + c + '"'
        return (
            '"' + name + '" contains ' + shown
            + ', which is not allowed in names (< > : " / \\ | ? *).'
        )
    if name.endswith(" ") or name.endswith("."):
        return '"' + name + '" cannot end with a space or a dot.'
    if name.split(".")[0].upper() in _bp_RESERVED_NAMES:
        return '"' + name + '" is reserved by Windows; please choose another name.'
    return None


# ------------------------------------------------------------------------- action log


def _bp_action(verb, frm, to=""):
    """One action log line, exactly like formatAction() in src/ir/timeline.ts."""
    head = verb.ljust(6) + " " + _bp_shown(frm)
    if verb == "RENAME":
        return head + " -> " + _bp_rel_name(to)
    if verb == "MOVE" or verb == "COPY":
        return head + " -> " + _bp_shown(_bp_rel_parent(to)) + "/"
    if verb == "MKDIR":
        return head + "/"
    return head


# ------------------------------------------------------------------------ file system


class _BPFileSystem:
    """The fs.* operations with the exact precondition checks of design.md §5.6.

    Every check happens before anything is changed, so a failed operation changes nothing.
    Subclasses provide the storage primitives (_h_*), working on "handles" (a real Path for
    _RealFS, an in-memory node for _PlanFS).
    """

    dry_run = False

    # ---- operations on the path text only (never touch the disk)

    def root(self):
        return _BPPath("")

    def join(self, folder, name, at=""):
        problem = _bp_check_name(name)
        if problem is not None:
            raise _BPError("INVALID_NAME", at, problem)
        return _BPPath(_bp_rel_join(folder.rel, name))

    def parent(self, path, at=""):
        if path.rel == "":
            raise _BPError("OUTSIDE_ROOT", at, "The chosen folder has no parent you can use.")
        return _BPPath(_bp_rel_parent(path.rel))

    def name(self, path):
        return _bp_rel_name(path.rel)

    def stem(self, path):
        return _bp_rel_stem(path.rel)

    def ext(self, path):
        return _bp_rel_ext(path.rel)

    # ---- lookups

    def _bp_chain(self, path, at):
        """Handles from the root to `path`, or None if it does not exist.

        Each segment matches a stored name exactly, otherwise a unique case-insensitive
        match. Two stored names that differ only in case (possible on a case-sensitive
        disk) raise INVALID_NAME.
        """
        h = self._h_root()
        chain = [h]
        if path.rel == "":
            return chain
        at_rel = ""
        for seg in path.rel.split("/"):
            if not self._h_is_dir(h):
                return None
            names = self._h_names(h)
            if seg not in names:
                low = seg.lower()
                hits = [n for n in names if n.lower() == low]
                if len(hits) == 0:
                    return None
                if len(hits) > 1:
                    raise _BPError(
                        "INVALID_NAME",
                        at,
                        f"The name \"{seg}\" matches more than one item in {_bp_q(at_rel)} "
                        f"({', '.join(sorted(hits))}) that differ only in upper/lower case.",
                    )
                seg = hits[0]
            h = self._h_child(h, seg)
            chain.append(h)
            at_rel = _bp_rel_join(at_rel, seg)
        return chain

    def _bp_node(self, path, at):
        chain = self._bp_chain(path, at)
        if chain is None:
            raise _BPError("NOT_FOUND", at, f"{_bp_q(path.rel)} does not exist.")
        return chain[-1]

    def _bp_folder(self, path, at):
        h = self._bp_node(path, at)
        if not self._h_is_dir(h):
            raise _BPError("NOT_A_FOLDER", at, f"{_bp_q(path.rel)} is a file, not a folder.")
        return h

    def _bp_file(self, path, at):
        h = self._bp_node(path, at)
        if self._h_is_dir(h):
            raise _BPError("NOT_A_FILE", at, f"{_bp_q(path.rel)} is a folder, not a file.")
        return h

    def _bp_parent_folder(self, path, at):
        chain = self._bp_chain(_BPPath(_bp_rel_parent(path.rel)), at)
        if chain is None or not self._h_is_dir(chain[-1]):
            raise _BPError("NOT_FOUND", at, f"The folder for {_bp_q(path.rel)} does not exist.")
        return chain[-1]

    def _bp_sorted_names(self, h):
        return sorted(self._h_names(h), key=_bp_name_key)

    # ---- reads

    def exists(self, path, at=""):
        return self._bp_chain(path, at) is not None

    def is_folder(self, path, at=""):
        return self._h_is_dir(self._bp_node(path, at))

    def list(self, folder, at=""):
        h = self._bp_folder(folder, at)
        return [_BPPath(_bp_rel_join(folder.rel, n)) for n in self._bp_sorted_names(h)]

    def walk(self, folder, at=""):
        out = []
        self._bp_walk(self._bp_folder(folder, at), folder.rel, out)
        return out

    def _bp_walk(self, h, rel, out):
        for n in self._bp_sorted_names(h):
            child = self._h_child(h, n)
            child_rel = _bp_rel_join(rel, n)
            if self._h_is_dir(child):
                self._bp_walk(child, child_rel, out)
            else:
                out.append(_BPPath(child_rel))

    def size(self, path, at=""):
        return self._h_size(self._bp_file(path, at))

    def modified(self, path, at=""):
        return self._h_mtime(self._bp_node(path, at))

    def read_text(self, path, at=""):
        data = self._h_bytes(self._bp_file(path, at))
        if b"\x00" in data:
            raise _BPError("NOT_TEXT", at, f"{_bp_q(path.rel)} is not a text file.")
        try:
            return data.decode("utf-8")
        except _bp_UnicodeDecodeError:
            raise _BPError("NOT_TEXT", at, f"{_bp_q(path.rel)} is not a text file.") from None

    def sort_by(self, items, key, descending=False, at=""):
        """list.sortBy. Keys 'size'/'modified' check every item in list order first."""
        if key == "name":
            return sorted(items, key=_bp_by_name, reverse=descending)
        if key == "ext":
            return sorted(items, key=_bp_by_ext, reverse=descending)
        keys = [self.size(p, at=at) if key == "size" else self.modified(p, at=at) for p in items]
        order = sorted(range(len(items)), key=lambda i: keys[i], reverse=descending)
        return [items[i] for i in order]

    # ---- changes

    def _bp_log(self, line):
        print((_bp_DRY_RUN_PREFIX if self.dry_run else "") + line)

    def write_text(self, path, text, at=""):
        if path.rel == "":
            raise _BPError("ROOT_PROTECTED", at, "The chosen folder itself cannot be written to.")
        parent = self._bp_parent_folder(path, at)
        chain = self._bp_chain(path, at)
        existing = None if chain is None else chain[-1]
        if existing is not None and self._h_is_dir(existing):
            raise _BPError(
                "NOT_A_FILE", at, f"{_bp_q(path.rel)} is a folder, so text cannot be written into it."
            )
        # 'surrogatepass' keeps text the program built (even with lone surrogates) writable;
        # such a file then reads back as NOT_TEXT, as in the simulator.
        data = text.encode("utf-8", "surrogatepass")
        self._h_write(parent, existing, _bp_rel_name(path.rel), data)
        self._bp_log(_bp_action("WRITE", path.rel))

    def make_folder(self, path, at=""):
        if path.rel == "":
            raise _BPError("ALREADY_EXISTS", at, "The chosen folder already exists.")
        parent = self._bp_parent_folder(path, at)
        if self._bp_chain(path, at) is not None:
            raise _BPError("ALREADY_EXISTS", at, f"{_bp_q(path.rel)} already exists.")
        self._h_mkdir(parent, _bp_rel_name(path.rel))
        self._bp_log(_bp_action("MKDIR", path.rel))

    def rename(self, path, new_name, at=""):
        problem = _bp_check_name(new_name)
        if problem is not None:
            raise _BPError("INVALID_NAME", at, problem)
        chain = self._bp_chain(path, at)
        if chain is None:
            raise _BPError("NOT_FOUND", at, f"{_bp_q(path.rel)} does not exist.")
        if path.rel == "":
            raise _BPError("ROOT_PROTECTED", at, "The chosen folder itself cannot be renamed.")
        h, parent = chain[-1], chain[-2]
        old = self._h_name(h)
        low = new_name.lower()
        for n in self._h_names(parent):
            if n != old and n.lower() == low:
                raise _BPError("ALREADY_EXISTS", at, f'There is already an item named "{n}" there.')
        self._h_rename(h, parent, new_name)
        result = _BPPath(_bp_rel_join(_bp_rel_parent(path.rel), new_name))
        self._bp_log(_bp_action("RENAME", path.rel, result.rel))
        return result

    def _bp_transfer_checks(self, path, folder, verb, at):
        chain = self._bp_chain(path, at)
        if chain is None:
            raise _BPError("NOT_FOUND", at, f"{_bp_q(path.rel)} does not exist.")
        if path.rel == "":
            raise _BPError("ROOT_PROTECTED", at, f"The chosen folder itself cannot be {verb}.")
        dest_chain = self._bp_chain(folder, at)
        if dest_chain is None:
            raise _BPError("NOT_FOUND", at, f"{_bp_q(folder.rel)} does not exist.")
        dest = dest_chain[-1]
        if not self._h_is_dir(dest):
            raise _BPError("NOT_A_FOLDER", at, f"{_bp_q(folder.rel)} is a file, not a folder.")
        h = chain[-1]
        for d in dest_chain:
            if self._h_same(d, h):
                raise _BPError("INVALID_MOVE", at, f"A folder cannot be {verb} into itself.")
        name = self._h_name(h)
        low = name.lower()
        for n in self._h_names(dest):
            if n.lower() == low:
                raise _BPError(
                    "ALREADY_EXISTS", at, f"{_bp_q(_bp_rel_join(folder.rel, name))} already exists."
                )
        return h, chain[-2], dest, name

    def move(self, path, folder, at=""):
        h, src_parent, dest, name = self._bp_transfer_checks(path, folder, "moved", at)
        self._h_move(h, src_parent, dest, name)
        result = _BPPath(_bp_rel_join(folder.rel, name))
        self._bp_log(_bp_action("MOVE", path.rel, result.rel))
        return result

    def copy(self, path, folder, at=""):
        h, _src_parent, dest, name = self._bp_transfer_checks(path, folder, "copied", at)
        self._h_copy(h, dest, name)
        result = _BPPath(_bp_rel_join(folder.rel, name))
        self._bp_log(_bp_action("COPY", path.rel, result.rel))
        return result

    def delete(self, path, at=""):
        chain = self._bp_chain(path, at)
        if chain is None:
            raise _BPError("NOT_FOUND", at, f"{_bp_q(path.rel)} does not exist.")
        if path.rel == "":
            raise _BPError("ROOT_PROTECTED", at, "The chosen folder itself cannot be deleted.")
        h = chain[-1]
        if self._h_is_dir(h) and len(self._h_names(h)) > 0:
            raise _BPError(
                "NOT_EMPTY", at, f"{_bp_q(path.rel)} is not empty; only empty folders can be deleted."
            )
        self._h_delete(h, chain[-2])
        self._bp_log(_bp_action("DELETE", path.rel))


class _RealFS(_BPFileSystem):
    """Works on the real disk (--apply)."""

    dry_run = False

    def __init__(self, root):
        self._root = Path(os.path.abspath(root))

    def _h_root(self):
        return self._root

    def _h_names(self, h):
        return os.listdir(h)

    def _h_child(self, h, name):
        return h / name

    def _h_name(self, h):
        return h.name

    def _h_is_dir(self, h):
        return os.path.isdir(h)

    def _h_size(self, h):
        return os.stat(h).st_size

    def _h_mtime(self, h):
        return int(os.stat(h).st_mtime)

    def _h_bytes(self, h):
        return h.read_bytes()

    def _h_same(self, a, b):
        return a == b

    def _h_write(self, parent, existing, name, data):
        (existing if existing is not None else parent / name).write_bytes(data)

    def _h_mkdir(self, parent, name):
        (parent / name).mkdir()

    def _h_rename(self, h, parent, new_name):
        os.rename(h, parent / new_name)

    def _h_move(self, h, src_parent, dest, name):
        # The target was checked not to exist, so shutil.move never merges or overwrites.
        shutil.move(str(h), str(dest / name))

    def _h_copy(self, h, dest, name):
        # copy2 / copytree keep modified times, like the simulator.
        if os.path.isdir(h):
            shutil.copytree(h, dest / name)
        else:
            shutil.copy2(h, dest / name)

    def _h_delete(self, h, parent):
        if os.path.isdir(h):
            os.rmdir(h)
        else:
            os.remove(h)


class _BPPlanNode:
    """An item of the dry-run overlay. Unloaded details are read from `disk` on demand."""

    __slots__ = ("name", "is_dir", "disk", "kids", "mtime", "data")

    def __init__(self, name, is_dir, disk):
        self.name = name
        self.is_dir = is_dir
        self.disk = disk  # real Path this item came from, or None if planned
        self.kids = None  # {stored name: node}; None = not loaded yet (same as on disk)
        self.mtime = None  # None = read from disk
        self.data = None  # planned file content (bytes); None = read from disk


class _PlanFS(_BPFileSystem):
    """Dry run (default): reads the real folder, but applies every change to an in-memory
    overlay only, so later steps see the planned changes. Never modifies the disk."""

    dry_run = True

    def __init__(self, root):
        self._root = _BPPlanNode("", True, Path(os.path.abspath(root)))

    def _bp_kids(self, h):
        if h.kids is None:
            h.kids = {}
            for n in os.listdir(h.disk):
                p = h.disk / n
                h.kids[n] = _BPPlanNode(n, os.path.isdir(p), p)
        return h.kids

    def _bp_now(self):
        return int(_bp_time.time())

    def _h_root(self):
        return self._root

    def _h_names(self, h):
        return [n for n in self._bp_kids(h)]

    def _h_child(self, h, name):
        return self._bp_kids(h)[name]

    def _h_name(self, h):
        return h.name

    def _h_is_dir(self, h):
        return h.is_dir

    def _h_size(self, h):
        return len(h.data) if h.data is not None else os.stat(h.disk).st_size

    def _h_mtime(self, h):
        return h.mtime if h.mtime is not None else int(os.stat(h.disk).st_mtime)

    def _h_bytes(self, h):
        return h.data if h.data is not None else h.disk.read_bytes()

    def _h_same(self, a, b):
        return a is b

    def _h_write(self, parent, existing, name, data):
        node = existing
        if node is None:
            node = _BPPlanNode(name, False, None)
            self._bp_kids(parent)[name] = node
        node.data = data
        node.mtime = self._bp_now()

    def _h_mkdir(self, parent, name):
        node = _BPPlanNode(name, True, None)
        node.kids = {}
        node.mtime = self._bp_now()
        self._bp_kids(parent)[name] = node

    def _h_rename(self, h, parent, new_name):
        kids = self._bp_kids(parent)
        del kids[h.name]
        h.name = new_name
        kids[new_name] = h

    def _h_move(self, h, src_parent, dest, name):
        del self._bp_kids(src_parent)[name]
        self._bp_kids(dest)[name] = h

    def _h_copy(self, h, dest, name):
        self._bp_kids(dest)[name] = self._bp_clone(h)

    def _bp_clone(self, h):
        # Unloaded details stay unloaded: the disk never changes, so they read the same later.
        c = _BPPlanNode(h.name, h.is_dir, h.disk)
        c.mtime = h.mtime
        c.data = h.data
        if h.kids is not None:
            c.kids = {}
            for k in h.kids:
                c.kids[k] = self._bp_clone(h.kids[k])
        return c

    def _h_delete(self, h, parent):
        del self._bp_kids(parent)[h.name]


# ------------------------------------------------------------------- number and text


def _bp_whole(x, what, at):
    if isinstance(x, float):
        raise _BPError("INVALID_NUMBER", at, what + " must be a whole number, but got a decimal number.")
    return x


def _bp_div(a, b, at=""):
    if b == 0:
        raise _BPError("DIVISION_BY_ZERO", at, "Cannot divide by zero.")
    return a / b


def _bp_floordiv(a, b, at=""):
    if b == 0:
        raise _BPError("DIVISION_BY_ZERO", at, "Cannot divide by zero.")
    return a // b


def _bp_mod(a, b, at=""):
    if b == 0:
        raise _BPError("DIVISION_BY_ZERO", at, "Cannot divide by zero.")
    return a % b


def _bp_floor(x, at=""):
    """math.floor; like the simulator, refuses results it cannot represent (INT_OVERFLOW)."""
    if not isinstance(x, float):
        return x
    if math.isinf(x) or math.isnan(x):
        raise _BPError("INT_OVERFLOW", at, f"{x} cannot be rounded down to a whole number.")
    r = math.floor(x)
    if r > _bp_MAX_SAFE_INT or r < -_bp_MAX_SAFE_INT:
        raise _BPError(
            "INT_OVERFLOW",
            at,
            "This whole number got too large for the simulator (more than 9007199254740991).",
        )
    return r


_bp_INT_TEXT = re.compile(r"[+-]?[0-9]+")
_bp_FLOAT_TEXT = re.compile(r"[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?")


def _bp_to_number(text, at=""):
    """text.toNumber: int if it looks like an int, else float, else INVALID_NUMBER."""
    if _bp_INT_TEXT.fullmatch(text):
        return int(text)
    if _bp_FLOAT_TEXT.fullmatch(text):
        return float(text)
    raise _BPError("INVALID_NUMBER", at, f'"{text}" is not a number.')


def _bp_pad(number, width, at=""):
    """text.padNumber: str(n).zfill(width), whole numbers only."""
    _bp_whole(number, "The number to pad", at)
    _bp_whole(width, "The width", at)
    return str(number).zfill(width)


def _bp_date(t, at=""):
    """text.date: the UTC date (YYYY-MM-DD) of epoch seconds `t`."""
    try:
        d = datetime.fromtimestamp(t, timezone.utc)
    except (_bp_OverflowError, _bp_ValueError, _bp_OSError):
        # Windows refuses some timestamps (e.g. negative ones) that the arithmetic handles.
        try:
            d = _bp_EPOCH + _bp_timedelta(seconds=t)
        except (_bp_OverflowError, _bp_ValueError):
            raise _BPError(
                "INVALID_NUMBER", at, f"{t} is not a time that can be shown as a date."
            ) from None
    return d.strftime("%Y-%m-%d")


def _bp_epoch(iso):
    """A date block: epoch seconds of 'YYYY-MM-DD' at midnight UTC."""
    y, m, d = iso.split("-")
    return (datetime(int(y), int(m), int(d), tzinfo=timezone.utc) - _bp_EPOCH) // _bp_timedelta(
        seconds=1
    )


def _bp_wildcard(text, pattern):
    """text.wildcard: * = any run, ? = one character, whole name, ignoring case."""
    parts = []
    for ch in pattern.lower():
        if ch == "*":
            parts.append(".*")
        elif ch == "?":
            parts.append(".")
        else:
            parts.append(re.escape(ch))
    return re.fullmatch("".join(parts), text.lower(), re.DOTALL) is not None


def _bp_regex(pattern):
    with _bp_warnings.catch_warnings():
        _bp_warnings.simplefilter("ignore")
        return re.compile(pattern, re.ASCII)


def _bp_regex_match(text, pattern):
    """text.regexMatch: search semantics."""
    return _bp_regex(pattern).search(text) is not None


def _bp_regex_replace(text, pattern, replacement):
    r"""text.regexReplace: all matches; \1-\9 = group text ('' if unmatched), \\ = backslash."""
    parts = []
    lit = ""
    i = 0
    while i < len(replacement):
        c = replacement[i]
        e = replacement[i + 1] if i + 1 < len(replacement) else ""
        if c == "\\" and e != "" and e in "123456789":
            if lit != "":
                parts.append((False, lit))
            lit = ""
            parts.append((True, int(e)))
            i += 2
        elif c == "\\" and e == "\\":
            lit += "\\"
            i += 2
        else:
            lit += c
            i += 1
    if lit != "":
        parts.append((False, lit))

    def substitute(m):
        out = []
        for is_group, v in parts:
            if is_group:
                g = m.group(v)
                out.append("" if g is None else g)
            else:
                out.append(v)
        return "".join(out)

    return _bp_regex(pattern).sub(substitute, text)


# ------------------------------------------------------------------------------ lists


def _bp_get(items, index, at=""):
    """list.get: 0-based, no negative positions."""
    _bp_whole(index, "The position", at)
    if index < 0 or index >= len(items):
        if len(items) == 0:
            message = f"Position {index} does not exist: the list is empty."
        else:
            message = f"Position {index} does not exist: positions go from 0 to {len(items) - 1}."
        raise _BPError("INDEX_OUT_OF_RANGE", at, message)
    return items[index]


def _bp_range(start, stop, at=""):
    """list.range: whole numbers start, start+1, ..., stop-1."""
    _bp_whole(start, "The start", at)
    _bp_whole(stop, "The end", at)
    return list(range(start, stop))


def _bp_eq(a, b):
    """== on lists, element by element (unlike Python's list ==, NaN never equals itself)."""
    if isinstance(a, list):
        if not isinstance(b, list) or len(a) != len(b):
            return False
        for i in range(len(a)):
            if not _bp_eq(a[i], b[i]):
                return False
        return True
    return a == b


def _bp_contains(items, item):
    """list.contains for numbers and lists (same equality as ==)."""
    for x in items:
        if _bp_eq(x, item):
            return True
    return False


# ------------------------------------------------------------------------------ entry


def _bp_entry(main):
    global fs
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except _bp_Exception:
            pass
    parser = argparse.ArgumentParser(
        description="Runs this BeepBlocks program on a folder. "
        "Without --apply it only shows what it would do."
    )
    parser.add_argument("folder", help="the folder to work on")
    parser.add_argument(
        "--apply", action="store_true", help="actually make the changes (default: preview only)"
    )
    args = parser.parse_args()
    if not os.path.isdir(args.folder):
        parser.error(f'"{args.folder}" is not an existing folder.')
    fs = _RealFS(args.folder) if args.apply else _PlanFS(args.folder)
    try:
        main(fs)
    except _BPError as e:
        sys.stdout.flush()
        message = e.message.replace("\r", "\\r").replace("\n", "\\n")
        sys.stderr.write(f"Error at block {e.node_id} ({e.code}): {message}\n")
        if args.apply:
            sys.stderr.write("Changes made before this error were kept.\n")
        else:
            sys.stderr.write("This was a preview: nothing was changed.\n")
        sys.exit(1)
    except _bp_KeyboardInterrupt:
        sys.stdout.flush()
        sys.stderr.write("Stopped.\n")
        sys.exit(130)
    except _bp_Exception:
        sys.stdout.flush()
        sys.stderr.write(
            "Unexpected error: the script stopped because of a problem it did not expect "
            "(for example a file that is open in another program, or missing permissions).\n"
        )
        _bp_traceback.print_exc()
        sys.exit(2)
    if not args.apply:
        sys.stdout.flush()
        sys.stderr.write(
            "This was a preview: nothing was changed. Run again with --apply to make the changes.\n"
        )


if __name__ == "__main__":
    _bp_entry(main)
