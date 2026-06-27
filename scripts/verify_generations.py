#!/usr/bin/env python3
"""Verify that each generated version is semantically aligned with its RAW.

For every (photo_id, version) pair, runs moondream on both images and computes
a similarity score on the two descriptions. Flags pairs with low similarity as
likely mismatches (cross-photo leaks).
"""

import json
import os
import sqlite3
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(os.environ.get("GALLERY_ROOT", str(Path.home() / "Darkroom")))
DB = Path(os.environ.get("DARKROOM_DB", str(ROOT / "photos.db")))
CACHE = Path(__file__).resolve().parent / ".verify_cache.json"
MOONDREAM = Path.home() / ".claude/jarvis/scripts/moondream"
QUESTION = "Describe the main subject of this photo in one short phrase."
THRESHOLD = 0.30  # below this = likely mismatch


def moondream(path: Path) -> str:
    try:
        r = subprocess.run(
            [str(MOONDREAM), str(path), QUESTION],
            capture_output=True, text=True, timeout=60,
        )
        return r.stdout.strip()
    except Exception as e:
        print(f"  moondream error on {path}: {e}", file=sys.stderr)
        return ""


def sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def load_cache() -> dict:
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def save_cache(c: dict):
    CACHE.write_text(json.dumps(c, indent=2))


def main():
    cache = load_cache()
    con = sqlite3.connect(DB)
    rows = con.execute("""
        SELECT v.id, v.photo_id, v.image_path, p.original_path
        FROM versions v
        JOIN photos p ON p.id = v.photo_id
        WHERE v.image_path LIKE '%/generations/%'
        ORDER BY v.id ASC
    """).fetchall()
    print(f"Versions to verify: {len(rows)}")

    results = []
    for i, (vid, pid, gen_path, raw_path) in enumerate(rows):
        gen = Path(gen_path)
        raw = Path(raw_path)
        if not gen.exists() or not raw.exists():
            print(f"  [{i+1}/{len(rows)}] {pid} v{vid}: MISSING file(s)")
            continue

        key_raw = f"raw:{raw_path}"
        key_gen = f"gen:{gen_path}"
        if key_raw not in cache:
            cache[key_raw] = moondream(raw)
            save_cache(cache)
        if key_gen not in cache:
            cache[key_gen] = moondream(gen)
            save_cache(cache)

        raw_desc = cache[key_raw]
        gen_desc = cache[key_gen]
        score = sim(raw_desc, gen_desc)
        results.append((pid, vid, score, raw_desc, gen_desc, gen_path))
        marker = "❌" if score < THRESHOLD else "✓"
        print(f"  [{i+1}/{len(rows)}] {marker} {score:.2f}  {pid}")

    results.sort(key=lambda x: x[2])
    print()
    print(f"=== Likely MISMATCHES (score < {THRESHOLD}) ===")
    bad = [r for r in results if r[2] < THRESHOLD]
    if not bad:
        print("None — tutti i match sembrano coerenti.")
    else:
        for pid, vid, score, raw_desc, gen_desc, gen_path in bad:
            print(f"\n  {pid}  v{vid}  score={score:.2f}")
            print(f"    RAW: {raw_desc[:90]}")
            print(f"    GEN: {gen_desc[:90]}")
            print(f"    path: {gen_path}")

    print(f"\nSummary: {len(results)} verified · {len(bad)} mismatches · {len(results)-len(bad)} ok")


if __name__ == "__main__":
    main()
