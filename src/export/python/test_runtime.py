"""Unit tests for runtime.py on real temporary folders (run with `pnpm test:py`).

Every fs operation and every one of its errors is checked for both _RealFS (--apply) and
_PlanFS (dry run). For _PlanFS, tearDown also asserts that the folder on disk is unchanged.
"""
import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import runtime as rt  # noqa: E402

P = rt._BPPath
HERE = Path(__file__).resolve().parent

T_A = 1_600_000_000
T_B = 1_600_000_100
T_DOCS_X = 1_600_000_200
T_DEEP = 1_600_000_300


def disk_snapshot(root):
    """{relpath: (kind, bytes or None, mtime)} for every item below root."""
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        for n in dirnames + filenames:
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            st = os.stat(p)
            if os.path.isdir(p):
                out[rel] = ("dir", None, None)
            else:
                out[rel] = ("file", Path(p).read_bytes(), int(st.st_mtime))
    return out


def case_sensitive_disk(folder):
    probe = os.path.join(folder, "CaseProbe")
    Path(probe).write_bytes(b"")
    try:
        return not os.path.exists(os.path.join(folder, "caseprobe"))
    finally:
        os.remove(probe)


class FsCases:
    """Shared cases; subclasses set FS."""

    FS = None

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="bp-rt-")
        r = Path(self.tmp)
        (r / "a.txt").write_bytes(b"hello\r\nworld\n")
        os.utime(r / "a.txt", (T_A, T_A))
        (r / "B.jpg").write_bytes(b"\x00" * 100)
        os.utime(r / "B.jpg", (T_B, T_B))
        (r / "bad.bin").write_bytes(b"\xff\xfeok")
        (r / "docs").mkdir()
        (r / "docs" / "x.md").write_bytes("caf\u00e9".encode("utf-8"))
        os.utime(r / "docs" / "x.md", (T_DOCS_X, T_DOCS_X))
        (r / "docs" / "sub").mkdir()
        (r / "docs" / "sub" / "deep.txt").write_bytes(b"deep")
        os.utime(r / "docs" / "sub" / "deep.txt", (T_DEEP, T_DEEP))
        (r / "docs" / "a.md").write_bytes(b"")
        (r / "empty").mkdir()
        self.before = disk_snapshot(self.tmp)
        self.fs = self.FS(self.tmp)
        self.out = io.StringIO()
        self._redirect = contextlib.redirect_stdout(self.out)
        self._redirect.__enter__()

    def tearDown(self):
        self._redirect.__exit__(None, None, None)
        if self.FS is rt._PlanFS:
            self.assertEqual(disk_snapshot(self.tmp), self.before, "dry run modified the disk")
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- helpers

    def p(self, rel):
        return P(rel)

    def err(self, code, fn, *args):
        with self.assertRaises(rt._BPError) as cm:
            fn(*args, at="n1")
        self.assertEqual(cm.exception.code, code)
        self.assertEqual(cm.exception.node_id, "n1")

    def lines(self):
        return self.out.getvalue().splitlines()

    def action(self, line):
        return (rt._bp_DRY_RUN_PREFIX if self.FS is rt._PlanFS else "") + line

    def strs(self, paths):
        return [str(x) for x in paths]

    @property
    def real(self):
        return self.FS is rt._RealFS

    def disk(self, rel):
        return Path(self.tmp, *rel.split("/"))

    # ---- path-only ops

    def test_path_ops(self):
        fs = self.fs
        root = fs.root()
        self.assertEqual(str(root), ".")
        doc = fs.join(root, "Docs", at="j")
        self.assertEqual(str(doc), "Docs")
        f = fs.join(doc, "report.final.PDF", at="j")
        self.assertEqual(str(f), "Docs/report.final.PDF")
        self.assertEqual(fs.name(f), "report.final.PDF")
        self.assertEqual(fs.stem(f), "report.final")
        self.assertEqual(fs.ext(f), "PDF")
        self.assertEqual(fs.parent(f, at="x"), doc)
        self.assertEqual(fs.parent(doc, at="x"), root)
        self.assertEqual(fs.name(root), "")
        self.assertEqual(fs.stem(root), "")
        self.assertEqual(fs.ext(root), "")
        for name, stem, ext in [(".bashrc", ".bashrc", ""), ("a.", "a.", ""), ("noext", "noext", "")]:
            q = P(name)
            self.assertEqual((fs.stem(q), fs.ext(q)), (stem, ext))
        self.err("OUTSIDE_ROOT", fs.parent, root)
        for bad in ["", ".", "..", "a/b", "a\\b", "a:b", "a*", "x?", "<", ">", "|", '"', "a\tb",
                    "end.", "end ", "CON", "con.txt", "Lpt9.log", "x" * 256]:
            self.err("INVALID_NAME", fs.join, root, bad)
        self.assertEqual(str(fs.join(root, "x" * 255, at="j")), "x" * 255)
        self.assertEqual(str(fs.join(root, "CONSOLE.txt", at="j")), "CONSOLE.txt")

    def test_path_equality(self):
        self.assertEqual(P("Docs/A.TXT"), P("docs/a.txt"))
        self.assertEqual(hash(P("Docs/A.TXT")), hash(P("docs/a.txt")))
        self.assertNotEqual(P("docs/a.txt"), P("docs/b.txt"))
        self.assertNotEqual(P("a"), "a")
        self.assertIn(P("A"), [P("b"), P("a")])
        with self.assertRaises(AttributeError):
            P("a").rel = "b"

    # ---- reads

    def test_exists(self):
        fs = self.fs
        self.assertTrue(fs.exists(P(""), at="e"))
        self.assertTrue(fs.exists(P("A.TXT"), at="e"))
        self.assertTrue(fs.exists(P("DOCS/SUB/deep.TXT"), at="e"))
        self.assertFalse(fs.exists(P("nope"), at="e"))
        self.assertFalse(fs.exists(P("a.txt/inside"), at="e"))

    def test_is_folder(self):
        fs = self.fs
        self.assertTrue(fs.is_folder(P(""), at="e"))
        self.assertTrue(fs.is_folder(P("Docs"), at="e"))
        self.assertFalse(fs.is_folder(P("a.txt"), at="e"))
        self.err("NOT_FOUND", fs.is_folder, P("nope"))

    def test_list(self):
        fs = self.fs
        self.assertEqual(
            self.strs(fs.list(P(""), at="l")), ["a.txt", "B.jpg", "bad.bin", "docs", "empty"]
        )
        self.assertEqual(self.strs(fs.list(P("DOCS"), at="l")), ["DOCS/a.md", "DOCS/sub", "DOCS/x.md"])
        self.assertEqual(fs.list(P("empty"), at="l"), [])
        self.err("NOT_FOUND", fs.list, P("nope"))
        self.err("NOT_A_FOLDER", fs.list, P("a.txt"))

    def test_list_order_is_lowercase_then_code_point(self):
        fs = self.fs
        for n in ["b", "A_", "a", "Z", "\u00e9"]:
            fs.write_text(P("empty/" + n), "", at="w")
        # lower: a, a_, b, z, é ; ties broken by code point
        self.assertEqual(
            [fs.name(x) for x in fs.list(P("empty"), at="l")], ["a", "A_", "b", "Z", "\u00e9"]
        )

    def test_walk(self):
        fs = self.fs
        self.assertEqual(
            self.strs(fs.walk(P(""), at="w")),
            ["a.txt", "B.jpg", "bad.bin", "docs/a.md", "docs/sub/deep.txt", "docs/x.md"],
        )
        self.assertEqual(self.strs(fs.walk(P("Docs/Sub"), at="w")), ["Docs/Sub/deep.txt"])
        self.assertEqual(fs.walk(P("empty"), at="w"), [])
        self.err("NOT_FOUND", fs.walk, P("nope"))
        self.err("NOT_A_FOLDER", fs.walk, P("a.txt"))

    def test_size(self):
        fs = self.fs
        self.assertEqual(fs.size(P("a.txt"), at="s"), 13)
        self.assertEqual(fs.size(P("b.JPG"), at="s"), 100)
        self.assertEqual(fs.size(P("docs/x.md"), at="s"), 5)
        self.err("NOT_FOUND", fs.size, P("nope"))
        self.err("NOT_A_FILE", fs.size, P("docs"))

    def test_modified(self):
        fs = self.fs
        self.assertEqual(fs.modified(P("a.txt"), at="m"), T_A)
        self.assertEqual(fs.modified(P("docs/SUB/deep.txt"), at="m"), T_DEEP)
        self.assertIsInstance(fs.modified(P("docs"), at="m"), int)
        self.err("NOT_FOUND", fs.modified, P("nope"))

    def test_read_text(self):
        fs = self.fs
        self.assertEqual(fs.read_text(P("A.txt"), at="r"), "hello\r\nworld\n")
        self.assertEqual(fs.read_text(P("docs/x.md"), at="r"), "caf\u00e9")
        self.assertEqual(fs.read_text(P("docs/a.md"), at="r"), "")
        self.err("NOT_FOUND", fs.read_text, P("nope"))
        self.err("NOT_A_FILE", fs.read_text, P("docs"))
        self.err("NOT_TEXT", fs.read_text, P("B.jpg"))
        self.err("NOT_TEXT", fs.read_text, P("bad.bin"))

    # ---- changes

    def test_write_text_create_and_overwrite(self):
        fs = self.fs
        fs.write_text(P("Docs/new.TXT"), "line1\r\nline2\n\u00e9", at="w")
        self.assertEqual(fs.read_text(P("docs/new.txt"), at="r"), "line1\r\nline2\n\u00e9")
        self.assertIn("new.TXT", [fs.name(x) for x in fs.list(P("docs"), at="l")])
        # An existing file written with another case keeps its stored name.
        fs.write_text(P("A.TXT"), "x", at="w")
        self.assertEqual([fs.name(x) for x in fs.list(P(""), at="l")][0], "a.txt")
        self.assertEqual(fs.read_text(P("a.txt"), at="r"), "x")
        self.assertEqual(fs.size(P("a.txt"), at="s"), 1)
        self.assertEqual(self.lines(), [self.action("WRITE  Docs/new.TXT"), self.action("WRITE  A.TXT")])
        if self.real:
            self.assertEqual(self.disk("docs/new.TXT").read_bytes(), "line1\r\nline2\n\u00e9".encode())
            self.assertEqual(self.disk("a.txt").read_bytes(), b"x")

    def test_write_text_errors(self):
        fs = self.fs
        self.err("ROOT_PROTECTED", fs.write_text, P(""), "x")
        self.err("NOT_FOUND", fs.write_text, P("nope/x.txt"), "x")
        self.err("NOT_FOUND", fs.write_text, P("a.txt/x.txt"), "x")
        self.err("NOT_A_FILE", fs.write_text, P("DOCS"), "x")
        self.assertEqual(self.lines(), [])

    def test_write_text_lone_surrogate_reads_back_as_not_text(self):
        fs = self.fs
        fs.write_text(P("s.txt"), "a\ud800", at="w")
        self.assertEqual(fs.size(P("s.txt"), at="s"), 4)
        self.err("NOT_TEXT", fs.read_text, P("s.txt"))

    def test_make_folder(self):
        fs = self.fs
        fs.make_folder(P("Docs/New"), at="m")
        self.assertTrue(fs.is_folder(P("docs/new"), at="e"))
        self.assertEqual(fs.list(P("docs/new"), at="l"), [])
        self.assertEqual(self.lines(), [self.action("MKDIR  Docs/New/")])
        if self.real:
            self.assertTrue(self.disk("docs/New").is_dir())
        self.err("ALREADY_EXISTS", fs.make_folder, P(""))
        self.err("NOT_FOUND", fs.make_folder, P("nope/x"))
        self.err("NOT_FOUND", fs.make_folder, P("a.txt/x"))
        self.err("ALREADY_EXISTS", fs.make_folder, P("EMPTY"))
        self.err("ALREADY_EXISTS", fs.make_folder, P("A.TXT"))

    def test_rename(self):
        fs = self.fs
        r = fs.rename(P("DOCS/x.md"), "y.MD", at="r")
        self.assertEqual(str(r), "DOCS/y.MD")
        self.assertEqual(fs.read_text(r, at="r"), "caf\u00e9")
        self.assertEqual(fs.modified(r, at="m"), T_DOCS_X)
        self.assertFalse(fs.exists(P("docs/x.md"), at="e"))
        # Case-only rename of itself is allowed.
        r2 = fs.rename(P("a.txt"), "A.TXT", at="r")
        self.assertEqual(str(r2), "A.TXT")
        self.assertIn("A.TXT", [fs.name(x) for x in fs.list(P(""), at="l")])
        # Renaming a folder keeps its contents.
        fs.rename(P("docs"), "papers", at="r")
        self.assertEqual(self.strs(fs.walk(P("papers"), at="w")),
                         ["papers/a.md", "papers/sub/deep.txt", "papers/y.MD"])
        self.assertEqual(
            self.lines(),
            [
                self.action("RENAME DOCS/x.md -> y.MD"),
                self.action("RENAME a.txt -> A.TXT"),
                self.action("RENAME docs -> papers"),
            ],
        )
        if self.real:
            self.assertEqual(sorted(os.listdir(self.tmp)), ["A.TXT", "B.jpg", "bad.bin", "empty", "papers"])

    def test_rename_errors(self):
        fs = self.fs
        # Name check comes before the existence check.
        self.err("INVALID_NAME", fs.rename, P("nope"), "a/b")
        self.err("INVALID_NAME", fs.rename, P("a.txt"), "")
        self.err("NOT_FOUND", fs.rename, P("nope"), "ok")
        self.err("ROOT_PROTECTED", fs.rename, P(""), "ok")
        self.err("ALREADY_EXISTS", fs.rename, P("a.txt"), "b.JPG")
        self.err("ALREADY_EXISTS", fs.rename, P("docs"), "EMPTY")
        self.assertEqual(self.lines(), [])

    def test_move(self):
        fs = self.fs
        r = fs.move(P("A.TXT"), P("Docs/Sub"), at="v")
        self.assertEqual(str(r), "Docs/Sub/a.txt")
        self.assertEqual(fs.read_text(P("docs/sub/a.txt"), at="r"), "hello\r\nworld\n")
        self.assertEqual(fs.modified(r, at="m"), T_A)
        self.assertFalse(fs.exists(P("a.txt"), at="e"))
        r2 = fs.move(P("docs/sub"), P(""), at="v")
        self.assertEqual(str(r2), "sub")
        self.assertEqual(self.strs(fs.walk(P("sub"), at="w")), ["sub/a.txt", "sub/deep.txt"])
        self.assertEqual(
            self.lines(),
            [self.action("MOVE   A.TXT -> Docs/Sub/"), self.action("MOVE   docs/sub -> ./")],
        )
        if self.real:
            self.assertTrue(self.disk("sub/a.txt").is_file())
            self.assertEqual(int(os.stat(self.disk("sub/a.txt")).st_mtime), T_A)

    def transfer_errors(self, op):
        fs = self.fs
        self.err("NOT_FOUND", op, P("nope"), P("also-nope"))
        self.err("ROOT_PROTECTED", op, P(""), P("docs"))
        self.err("NOT_FOUND", op, P("a.txt"), P("nope"))
        self.err("NOT_A_FOLDER", op, P("a.txt"), P("b.jpg"))
        self.err("INVALID_MOVE", op, P("docs"), P("DOCS"))
        self.err("INVALID_MOVE", op, P("docs"), P("Docs/sub"))
        # The destination already holds an item with that name (including the source itself).
        self.err("ALREADY_EXISTS", op, P("a.txt"), P(""))
        self.err("ALREADY_EXISTS", op, P("docs/sub"), P("docs"))
        fs.write_text(P("empty/A.TXT"), "z", at="w")
        self.out.truncate(0)
        self.out.seek(0)
        self.err("ALREADY_EXISTS", op, P("a.txt"), P("empty"))
        self.assertEqual(self.lines(), [])

    def test_move_errors(self):
        self.transfer_errors(self.fs.move)

    def test_copy(self):
        fs = self.fs
        r = fs.copy(P("a.txt"), P("EMPTY"), at="c")
        self.assertEqual(str(r), "EMPTY/a.txt")
        self.assertEqual(fs.read_text(r, at="r"), "hello\r\nworld\n")
        self.assertEqual(fs.modified(r, at="m"), T_A)
        self.assertTrue(fs.exists(P("a.txt"), at="e"))
        r2 = fs.copy(P("docs"), P("empty"), at="c")
        self.assertEqual(str(r2), "empty/docs")
        self.assertEqual(
            self.strs(fs.walk(P("empty"), at="w")),
            ["empty/a.txt", "empty/docs/a.md", "empty/docs/sub/deep.txt", "empty/docs/x.md"],
        )
        self.assertEqual(fs.modified(P("empty/docs/sub/deep.txt"), at="m"), T_DEEP)
        # The copy is independent of the original.
        fs.delete(P("docs/sub/deep.txt"), at="d")
        self.assertTrue(fs.exists(P("empty/docs/sub/deep.txt"), at="e"))
        self.assertEqual(
            self.lines(),
            [
                self.action("COPY   a.txt -> EMPTY/"),
                self.action("COPY   docs -> empty/"),
                self.action("DELETE docs/sub/deep.txt"),
            ],
        )
        if self.real:
            self.assertEqual(int(os.stat(self.disk("empty/docs/x.md")).st_mtime), T_DOCS_X)

    def test_copy_errors(self):
        self.transfer_errors(self.fs.copy)

    def test_delete(self):
        fs = self.fs
        fs.delete(P("A.txt"), at="d")
        self.assertFalse(fs.exists(P("a.txt"), at="e"))
        fs.delete(P("EMPTY"), at="d")
        self.assertFalse(fs.exists(P("empty"), at="e"))
        self.assertEqual(self.lines(), [self.action("DELETE A.txt"), self.action("DELETE EMPTY")])
        self.err("NOT_FOUND", fs.delete, P("a.txt"))
        self.err("ROOT_PROTECTED", fs.delete, P(""))
        self.err("NOT_EMPTY", fs.delete, P("docs"))
        if self.real:
            self.assertEqual(sorted(os.listdir(self.tmp)), ["B.jpg", "bad.bin", "docs"])

    def test_sort_by(self):
        fs = self.fs
        items = [P("docs/x.md"), P("a.txt"), P("B.jpg"), P("docs/sub/deep.txt")]
        self.assertEqual(self.strs(fs.sort_by(items, "name", False, at="s")),
                         ["a.txt", "B.jpg", "docs/sub/deep.txt", "docs/x.md"])
        self.assertEqual(self.strs(fs.sort_by(items, "ext", True, at="s")),
                         ["a.txt", "docs/sub/deep.txt", "docs/x.md", "B.jpg"])
        self.assertEqual(self.strs(fs.sort_by(items, "size", False, at="s")),
                         ["docs/sub/deep.txt", "docs/x.md", "a.txt", "B.jpg"])
        self.assertEqual(self.strs(fs.sort_by(items, "modified", True, at="s")),
                         ["docs/sub/deep.txt", "docs/x.md", "B.jpg", "a.txt"])
        # Stable in both directions.
        ties = [P("a.txt"), P("A.TXT"), P("a.txt")]
        self.assertEqual(self.strs(fs.sort_by(ties, "size", True, at="s")), ["a.txt", "A.TXT", "a.txt"])
        # Errors are checked in list order; name/ext never touch the disk.
        self.err("NOT_FOUND", fs.sort_by, [P("a.txt"), P("nope"), P("docs")], "size", False)
        self.err("NOT_A_FILE", fs.sort_by, [P("a.txt"), P("docs"), P("nope")], "size", False)
        self.err("NOT_FOUND", fs.sort_by, [P("docs"), P("nope")], "modified", False)
        self.assertEqual(len(fs.sort_by([P("docs"), P("nope")], "name", False, at="s")), 2)
        self.assertEqual(len(fs.sort_by([P("docs"), P("nope")], "ext", False, at="s")), 2)

    def test_later_reads_see_earlier_changes(self):
        fs = self.fs
        target = fs.join(fs.root(), "Archive", at="j")
        fs.make_folder(target, at="m")
        moved = fs.move(P("a.txt"), target, at="v")
        fs.write_text(fs.join(target, "note.txt", at="j"), "n", at="w")
        self.assertEqual(self.strs(fs.list(target, at="l")), ["Archive/a.txt", "Archive/note.txt"])
        self.assertEqual(fs.read_text(moved, at="r"), "hello\r\nworld\n")
        renamed = fs.rename(P("archive"), "Old", at="r")
        self.assertEqual(self.strs(fs.walk(renamed, at="w")), ["Old/a.txt", "Old/note.txt"])
        fs.delete(P("old/note.txt"), at="d")
        fs.delete(P("old/a.txt"), at="d")
        fs.delete(P("old"), at="d")
        self.assertFalse(fs.exists(P("old"), at="e"))
        self.assertEqual(len(self.lines()), 7)

    def test_ambiguous_names_on_case_sensitive_disk(self):
        if not case_sensitive_disk(self.tmp):
            self.skipTest("the temp folder is on a case-insensitive disk")
        self._redirect.__exit__(None, None, None)
        Path(self.tmp, "Twin.txt").write_bytes(b"1")
        Path(self.tmp, "twin.txt").write_bytes(b"2")
        self.before = disk_snapshot(self.tmp)
        self.fs = self.FS(self.tmp)
        self._redirect.__enter__()
        fs = self.fs
        self.assertEqual(fs.read_text(P("twin.txt"), at="r"), "2")  # exact match wins
        self.err("INVALID_NAME", fs.read_text, P("TWIN.TXT"))
        self.err("INVALID_NAME", fs.exists, P("TWIN.TXT"))
        self.err("ALREADY_EXISTS", fs.rename, P("twin.txt"), "TWIN.txt")


class RealFSTest(FsCases, unittest.TestCase):
    FS = rt._RealFS


class PlanFSTest(FsCases, unittest.TestCase):
    FS = rt._PlanFS

    def test_never_touches_disk_even_for_big_changes(self):
        fs = self.fs
        fs.copy(P("docs"), P("empty"), at="c")
        fs.write_text(P("docs/x.md"), "changed", at="w")
        self.assertEqual(fs.read_text(P("empty/docs/x.md"), at="r"), "caf\u00e9")
        fs.rename(P("docs"), "docs2", at="r")
        fs.move(P("docs2"), P("empty"), at="v")
        self.assertEqual(fs.read_text(P("empty/docs2/x.md"), at="r"), "changed")
        for x in fs.walk(P(""), at="w"):
            fs.delete(x, at="d")
        self.assertEqual(fs.walk(P(""), at="w"), [])
        self.assertEqual(self.strs(fs.list(P("empty"), at="l")), ["empty/docs", "empty/docs2"])
        # tearDown asserts the disk is unchanged.


class HelperTest(unittest.TestCase):
    def raises(self, code, fn, *args):
        with self.assertRaises(rt._BPError) as cm:
            fn(*args, at="h")
        self.assertEqual((cm.exception.code, cm.exception.node_id), (code, "h"))

    def test_check_name_matches_ts_rules(self):
        self.assertIsNone(rt._bp_check_name("ok.txt"))
        self.assertIsNone(rt._bp_check_name("\U0001F600" * 255))  # code points, not UTF-16
        self.assertIsNotNone(rt._bp_check_name("\U0001F600" * 256))
        self.assertIsNotNone(rt._bp_check_name("nul"))
        self.assertIsNotNone(rt._bp_check_name("Com1.tar.gz"))
        self.assertIsNone(rt._bp_check_name("com10"))
        self.assertIsNotNone(rt._bp_check_name("a\x1fb"))
        self.assertIsNone(rt._bp_check_name("a\x7fb"))

    def test_action_format(self):
        self.assertEqual(rt._bp_action("RENAME", "a/b.txt", "a/c.txt"), "RENAME a/b.txt -> c.txt")
        self.assertEqual(rt._bp_action("MOVE", "b.txt", "d/b.txt"), "MOVE   b.txt -> d/")
        self.assertEqual(rt._bp_action("COPY", "d/b.txt", "b.txt"), "COPY   d/b.txt -> ./")
        self.assertEqual(rt._bp_action("MKDIR", "d"), "MKDIR  d/")
        self.assertEqual(rt._bp_action("DELETE", "x"), "DELETE x")
        self.assertEqual(rt._bp_action("WRITE", "x"), "WRITE  x")

    def test_wildcard(self):
        w = rt._bp_wildcard
        self.assertTrue(w("IMG_0001.JPG", "img_*.jpg"))
        self.assertTrue(w("a\nb", "a*b"))
        self.assertTrue(w("a\nb", "a?b"))
        self.assertTrue(w("", "*"))
        self.assertFalse(w("ab", "a"))
        self.assertTrue(w("[x].txt", "[x]*"))
        self.assertFalse(w("x.txt", "[x]*"))
        self.assertTrue(w("a.b", "a.b"))
        self.assertFalse(w("axb", "a.b"))
        self.assertTrue(w("\U0001F600", "?"))

    def test_regex(self):
        self.assertTrue(rt._bp_regex_match("abc123", r"\d+"))
        self.assertFalse(rt._bp_regex_match("\u0663", r"\d"))  # ASCII only
        self.assertTrue(rt._bp_regex_match("a\n", "a$"))
        self.assertFalse(rt._bp_regex_match("\n", "."))
        self.assertFalse(rt._bp_regex_match("\u00a0", r"\s"))
        self.assertEqual(rt._bp_regex_replace("2024-01-05", r"(\d+)-(\d+)-(\d+)", r"\3.\2.\1"), "05.01.2024")
        self.assertEqual(rt._bp_regex_replace("ab", "(x)?b", r"[\1]"), "a[]")
        self.assertEqual(rt._bp_regex_replace("a.b", r"\.", r"\\"), "a\\b")
        self.assertEqual(rt._bp_regex_replace("aaa", "a", "$1&"), "$1&$1&$1&")
        self.assertEqual(rt._bp_regex_replace("abc", "x*", "-"), "-a-b-c-")
        self.assertTrue(rt._bp_regex_match("a-b", r"a\-b"))

    def test_to_number(self):
        n = rt._bp_to_number
        self.assertEqual((n("42", at=""), type(n("42", at=""))), (42, int))
        self.assertEqual(n("-0", at=""), 0)
        self.assertEqual(n("+7", at=""), 7)
        self.assertEqual((n("1.5", at=""), n(".5", at=""), n("5.", at=""), n("1e3", at="")), (1.5, 0.5, 5.0, 1000.0))
        self.assertIsInstance(n("1e3", at=""), float)
        for bad in ["", " 1", "1 ", "1_000", "inf", "nan", "0x10", "\u0663", "1e", "e1", "1\n"]:
            self.raises("INVALID_NUMBER", n, bad)

    def test_pad_get_range(self):
        self.assertEqual(rt._bp_pad(7, 3, at=""), "007")
        self.assertEqual(rt._bp_pad(-5, 3, at=""), "-05")
        self.assertEqual(rt._bp_pad(1234, 2, at=""), "1234")
        self.raises("INVALID_NUMBER", rt._bp_pad, 2.0, 3)
        self.raises("INVALID_NUMBER", rt._bp_pad, 2, 3.0)
        self.assertEqual(rt._bp_get([1, 2], 1, at=""), 2)
        self.raises("INDEX_OUT_OF_RANGE", rt._bp_get, [1, 2], 2)
        self.raises("INDEX_OUT_OF_RANGE", rt._bp_get, [1, 2], -1)
        self.raises("INDEX_OUT_OF_RANGE", rt._bp_get, [], 0)
        self.raises("INVALID_NUMBER", rt._bp_get, [1, 2], 1.0)
        self.assertEqual(rt._bp_range(2, 5, at=""), [2, 3, 4])
        self.assertEqual(rt._bp_range(5, 2, at=""), [])
        self.raises("INVALID_NUMBER", rt._bp_range, 0.0, 2)
        self.raises("INVALID_NUMBER", rt._bp_range, 0, 2.5)

    def test_dates(self):
        self.assertEqual(rt._bp_date(0, at=""), "1970-01-01")
        self.assertEqual(rt._bp_date(1767225599.9999999, at=""), "2026-01-01")
        self.assertEqual(rt._bp_date(1767225600, at=""), "2026-01-01")
        self.assertEqual(rt._bp_date(-1, at=""), "1969-12-31")
        self.raises("INVALID_NUMBER", rt._bp_date, float("inf"))
        self.raises("INVALID_NUMBER", rt._bp_date, float("nan"))
        self.raises("INVALID_NUMBER", rt._bp_date, 1e20)
        self.assertEqual(rt._bp_epoch("2026-01-01"), 1767225600)
        self.assertIsInstance(rt._bp_epoch("2026-01-01"), int)

    def test_numbers(self):
        self.assertEqual(rt._bp_div(1, 2, at=""), 0.5)
        self.assertEqual(rt._bp_floordiv(-7, 2, at=""), -4)
        self.assertEqual(rt._bp_mod(7, -3, at=""), -2)
        self.assertEqual(rt._bp_mod(-7.5, 2, at=""), 0.5)
        for f in (rt._bp_div, rt._bp_floordiv, rt._bp_mod):
            self.raises("DIVISION_BY_ZERO", f, 1, 0)
            self.raises("DIVISION_BY_ZERO", f, 1.5, -0.0)
        self.assertEqual((rt._bp_floor(2.7, at=""), type(rt._bp_floor(2.7, at=""))), (2, int))
        self.assertEqual(rt._bp_floor(-2.5, at=""), -3)
        self.assertEqual(rt._bp_floor(5, at=""), 5)
        self.raises("INT_OVERFLOW", rt._bp_floor, float("inf"))
        self.raises("INT_OVERFLOW", rt._bp_floor, float("nan"))
        self.raises("INT_OVERFLOW", rt._bp_floor, 1e300)
        self.assertEqual(str(1e308 * 10), "inf")

    def test_equality_helpers(self):
        nan = float("nan")
        self.assertFalse(rt._bp_eq([nan], [nan]))
        self.assertTrue(rt._bp_eq([1, 2.0], [1.0, 2]))
        self.assertTrue(rt._bp_eq([[P("A")]], [[P("a")]]))
        self.assertFalse(rt._bp_eq([1], [1, 2]))
        self.assertFalse(rt._bp_contains([nan], nan))
        self.assertTrue(rt._bp_contains([1, 2], 2.0))


class RuntimeSourceTest(unittest.TestCase):
    """User functions are defined at module level of the script, so the runtime must only use
    builtins that the validator reserves (others could be shadowed, e.g. `def open(...)`)."""

    ALLOWED = {"print", "len", "str", "int", "float", "range", "sorted", "min", "max", "abs",
               "list", "bool", "isinstance"}

    def test_only_reserved_builtins(self):
        import ast
        import builtins

        source = (HERE / "runtime.py").read_text(encoding="utf-8")
        body = source.split("# @bp-runtime-begin", 1)[1]
        tree = ast.parse(body)
        defined = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.arg):
                defined.add(node.arg)
            elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                defined.add(node.id)
        used = {
            n.id for n in ast.walk(tree)
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)
            and n.id in dir(builtins) and n.id not in defined
        }
        self.assertEqual(used - self.ALLOWED, set())

    def test_module_names_are_prefixed(self):
        import ast

        source = (HERE / "runtime.py").read_text(encoding="utf-8")
        tree = ast.parse(source.split("# @bp-runtime-begin", 1)[1])
        contract = {"_RealFS", "_PlanFS"}
        for node in tree.body:
            names = []
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                names = [node.name]
            elif isinstance(node, ast.Assign):
                names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            for n in names:
                self.assertTrue(n.startswith(("_bp", "_BP")) or n in contract, n)


ENTRY_MAIN = '''
def main(fs):
    print("hello\\nworld")
    target = fs.join(fs.root(), "made", at="j")
    fs.make_folder(target, at="mk")
    mode = __import__("os").environ.get("BP_TEST_MODE", "")
    if mode == "error":
        fs.delete(fs.join(fs.root(), "missing.txt", at="j2"), at="del1")
    if mode == "crash":
        raise RuntimeError("boom")
    print("done")
'''


class EntryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="bp-entry-")
        self.folder = os.path.join(self.tmp, "work")
        os.mkdir(self.folder)
        runtime = (HERE / "runtime.py").read_text(encoding="utf-8")
        self.script = os.path.join(self.tmp, "script.py")
        Path(self.script).write_text(
            runtime + "\n" + ENTRY_MAIN + '\nif __name__ == "__main__":\n    _bp_entry(main)\n',
            encoding="utf-8",
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_script(self, *args, mode=""):
        env = dict(os.environ, BP_TEST_MODE=mode)
        return subprocess.run(
            [sys.executable, self.script, *args], capture_output=True, text=True,
            encoding="utf-8", env=env,
        )

    def test_dry_run_is_default(self):
        r = self.run_script(self.folder)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.splitlines(), ["hello", "world", "[dry run] MKDIR  made/", "done"])
        self.assertIn("--apply", r.stderr)
        self.assertEqual(os.listdir(self.folder), [])

    def test_apply(self):
        r = self.run_script(self.folder, "--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.splitlines(), ["hello", "world", "MKDIR  made/", "done"])
        self.assertEqual(r.stderr, "")
        self.assertTrue(os.path.isdir(os.path.join(self.folder, "made")))

    def test_block_error(self):
        r = self.run_script(self.folder, "--apply", mode="error")
        self.assertEqual(r.returncode, 1)
        first = r.stderr.splitlines()[0]
        self.assertTrue(first.startswith("Error at block del1 (NOT_FOUND): "), first)
        self.assertEqual(r.stdout.splitlines(), ["hello", "world", "MKDIR  made/"])
        r2 = self.run_script(self.folder, mode="error")  # dry run: made/ exists now
        self.assertTrue(r2.stderr.startswith("Error at block mk (ALREADY_EXISTS): "), r2.stderr)

    def test_unexpected_error(self):
        r = self.run_script(self.folder, mode="crash")
        self.assertEqual(r.returncode, 2)
        self.assertIn("Unexpected error", r.stderr)
        self.assertIn("RuntimeError: boom", r.stderr)

    def test_folder_must_exist(self):
        r = self.run_script(os.path.join(self.tmp, "missing"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("is not an existing folder", r.stderr)
        r = self.run_script()
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
