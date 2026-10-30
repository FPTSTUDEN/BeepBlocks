"""Generates the built-in scenario JSON files (tasks A.6). All data is fake.

    python src/domains/fileExplorer/scenarios/gen_scenarios.py

Writes <id>.json next to this script. Children are sorted like `compareNames` in fsTypes.ts
(lowercase, then code point); every name passes the Windows-strict name rules.
"""
import json
import os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))


def ts(y, mo, d, h=12, mi=0):
    return int(datetime(y, mo, d, h, mi, tzinfo=timezone.utc).timestamp())


def text(name, content, mtime):
    return {"type": "file", "name": name, "modified": mtime, "content": content}


def blob(name, size, mtime):
    return {"type": "file", "name": name, "modified": mtime, "binarySize": size}


def folder(name, children, mtime):
    children = sorted(children, key=lambda c: (c["name"].lower(), c["name"]))
    return {"type": "folder", "name": name, "modified": mtime, "children": children}


def write(scenario):
    path = os.path.join(HERE, scenario["id"] + ".json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(scenario, f, indent=2, ensure_ascii=False)
        f.write("\n")


# --------------------------------------------------------------- messy-downloads
d = lambda day, h=12: ts(2025, 12, day, h)  # noqa: E731
write({
    "id": "messy-downloads",
    "title": "Messy Downloads folder",
    "description": (
        "A Downloads folder full of photos, documents, music, videos, archives and code, "
        "with extensions in mixed case and a couple of files without any extension. "
        "Try sorting the files into folders by type."
    ),
    "suggestedComposite": "sortByType",
    "tree": {"root": folder("", [
        blob("Invoice_2025-11.pdf", 84211, d(1, 9)),
        blob("holiday.JPG", 2457600, d(2, 18)),
        blob("IMG_2231.jpeg", 1980212, d(2, 18)),
        blob("logo.png", 18342, d(3)),
        blob("Screenshot 2025-12-04.PNG", 402113, d(4, 16)),
        text("notes.txt", "Buy milk\nCall the plumber\nBook train tickets\n", d(5)),
        text("README", "Installer instructions:\n1. Unzip setup.zip\n2. Run setup\n", d(5, 13)),
        text("LICENSE", "Permission is hereby granted, free of charge, to any person...\n", d(5, 13)),
        blob("song.mp3", 4194304, d(6, 20)),
        blob("Podcast Episode 12.MP3", 31457280, d(7, 7)),
        blob("clip.mp4", 15728640, d(8, 21)),
        blob("Birthday.MOV", 52428800, d(9, 22)),
        blob("setup.zip", 7340032, d(10)),
        blob("backup.tar.gz", 10485760, d(10, 23)),
        blob("photos.7z", 20971520, d(11)),
        text("script.py", "print('hello from a downloaded script')\n", d(12)),
        text("index.html", "<!doctype html>\n<title>Saved page</title>\n<p>Hello</p>\n", d(12, 14)),
        text("data.csv", "date,amount\n2025-12-01,12.50\n2025-12-02,8.00\n", d(13)),
        blob("budget.xlsx", 23552, d(14)),
        blob("Report.DOCX", 45120, d(15, 10)),
        text("draft.md", "# Draft\n\nSome thoughts about the trip.\n", d(16)),
        blob("font.TTF", 120004, d(17)),
    ], d(17, 23))},
})

# ----------------------------------------------------------------- camera-photos
photos = []
for n in range(1, 25):
    day = ts(2025, 8, 1 + (n - 1) // 4, 10 + (n - 1) % 4, 5 * n % 60)
    stem = f"IMG_{n:04d}"
    ext = ".JPG" if n % 3 else ".jpg"
    if n in (5, 17):
        stem = stem.lower()  # some cameras/apps write lowercase names
    photos.append(blob(stem + ext, 1_800_000 + 37_123 * n, day))
write({
    "id": "camera-photos",
    "title": "Camera photos",
    "description": (
        "Photos copied from a camera, named IMG_0001.JPG, IMG_0002.JPG and so on (some in "
        "lowercase), plus a few files that are not photos. Try renaming the photos to "
        "something more useful, such as the date they were taken and a counter."
    ),
    "suggestedComposite": "renameByPattern",
    "tree": {"root": folder("", photos + [
        blob("MVI_0025.MP4", 98_566_144, ts(2025, 8, 7, 15)),
        blob("Thumbs.db", 24_576, ts(2025, 8, 7, 16)),
        text("notes.txt", "Trip to the coast, August 2025.\nCamera: borrowed from Sam.\n", ts(2025, 8, 7, 18)),
        folder("Edited", [
            blob("IMG_0003_edit.jpg", 2_100_000, ts(2025, 8, 9, 20)),
        ], ts(2025, 8, 9, 20)),
    ], ts(2025, 8, 9, 20))},
})

# ------------------------------------------------------------------ project-tree
p = lambda day, h=12: ts(2026, 1, day, h)  # noqa: E731
MB = 1024 * 1024
write({
    "id": "project-tree",
    "title": "Project folder",
    "description": (
        "A small software project with nested folders. Temporary .tmp files, .log files and "
        "a few very large files are scattered around. Try finding files by extension, size "
        "or date and moving, copying or deleting them."
    ),
    "suggestedComposite": "findAndAct",
    "tree": {"root": folder("", [
        text("README.md", "# Weather Station\n\nCollects readings and draws charts.\n", p(2)),
        text(".gitignore", "*.tmp\n*.log\nbuild/\n", p(2)),
        text("cache.tmp", "temporary cache\n", p(20)),
        folder("src", [
            text("main.py", "from utils import load\n\nprint(load('readings.csv'))\n", p(10)),
            text("utils.py", "def load(path):\n    return open(path).read()\n", p(12)),
            text("chart.py", "def draw(values):\n    pass\n", p(14)),
            text("edit.tmp", "unsaved changes\n", p(21)),
            folder("__pycache__", [
                blob("utils.cpython-313.pyc", 1_204, p(12)),
            ], p(12)),
        ], p(14)),
        folder("build", [
            text("build.log", "compiling...\ndone in 4.2s\n", p(18)),
            blob("bundle.bin", 12 * MB, p(18)),
            text("step1.tmp", "intermediate\n", p(18)),
            text("step2.tmp", "intermediate\n", p(18)),
        ], p(18)),
        folder("docs", [
            text("guide.md", "# Guide\n\nRun main.py.\n", p(5)),
            text("draft.tmp", "half-written section\n", p(19)),
            blob("diagram.png", 245_760, p(6)),
        ], p(19)),
        folder("logs", [
            text("app.log", "2026-01-20 INFO started\n2026-01-20 INFO stopped\n", p(20)),
            text("error.log", "2026-01-19 ERROR sensor timeout\n", p(19)),
            folder("old", [
                text("2025-12.log", "2025-12-31 INFO happy new year\n", ts(2025, 12, 31)),
                text("2025-11.log", "2025-11-30 INFO all good\n", ts(2025, 11, 30)),
            ], ts(2025, 12, 31)),
        ], p(20)),
        folder("assets", [
            blob("intro-video.mp4", 48 * MB, p(8)),
            blob("logo.png", 18_342, p(3)),
            blob("raw-recording.wav", 96 * MB, p(9)),
        ], p(9)),
        folder("data", [
            text("readings.csv", "time,temp\n00:00,4.5\n01:00,4.1\n", p(15)),
            blob("archive-2025.zip", 30 * MB, p(1)),
        ], p(15)),
    ], p(21))},
})

# ------------------------------------------------------------------ nightly-logs
FLIP_DAY = 41  # first failing build: the 41st log (2026-02-10)
start = datetime(2026, 1, 1, tzinfo=timezone.utc)
logs = []
for i in range(64):
    day = start + timedelta(days=i)
    status = "OK" if i + 1 < FLIP_DAY else "ERROR"
    content = (
        f"nightly build #{1000 + i}\n"
        f"date: {day:%Y-%m-%d}\n"
        f"tests: {412 + i // 7} run\n"
        f"status: {status}\n"
    )
    logs.append(text(f"nightly-{day:%Y-%m-%d}.log", content, int((day + timedelta(hours=2, minutes=30)).timestamp())))
write({
    "id": "nightly-logs",
    "title": "Nightly build logs",
    "description": (
        "64 nightly build logs, one per day. Every log ends with a status line. Early builds "
        "say \"status: OK\", but at some point they started to say \"status: ERROR\" and never "
        "recovered. Try finding the first failing night without opening every file."
    ),
    "suggestedComposite": "findFirst",
    "tree": {"root": folder("", logs, int((start + timedelta(days=64)).timestamp()))},
})
