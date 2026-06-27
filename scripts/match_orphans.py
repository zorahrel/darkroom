#!/usr/bin/env python3
"""
Match orphan TEST1 PNGs to RAW photos using Moondream vision AI.
Saves progress to a JSON cache so it can resume if interrupted.
"""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path
from difflib import SequenceMatcher

ROOT = Path(os.environ.get("GALLERY_ROOT", str(Path.home() / "Darkroom")))
CACHE = Path(__file__).resolve().parent / ".match_cache.json"
API = os.environ.get("DARKROOM_API", "http://localhost:3535")

QUESTION = "Describe this photo in one short sentence focusing on the main subject and setting."


MOONDREAM = Path.home() / ".claude/jarvis/scripts/moondream"

def moondream(path: Path) -> str:
    try:
        result = subprocess.run(
            [str(MOONDREAM), str(path), QUESTION],
            capture_output=True, text=True, timeout=90
        )
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return ""
    except Exception as e:
        print(f"  ERR: {e}")
        return ""


def api_get(path: str):
    with urllib.request.urlopen(f"{API}{path}") as r:
        return json.loads(r.read())


def api_post(path: str, body: dict):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API}{path}", data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, e.read().decode()


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    return {"raw": {}, "orphans": {}}


def save_cache(cache: dict):
    CACHE.write_text(json.dumps(cache, indent=2))


def main():
    cache = load_cache()

    # Fetch orphan list from API
    data = api_get("/api/orphans")
    orphans = data["orphans"] if isinstance(data, dict) else data
    orphan_filenames = [o["filename"] if isinstance(o, dict) else o for o in orphans]
    print(f"Orphans to match: {len(orphan_filenames)}")

    # Fetch photo list
    data = api_get("/api/photos?filter=all")
    photos = data["photos"] if isinstance(data, dict) else data
    print(f"RAW photos available: {len(photos)}")

    # Describe orphans
    print("\n--- Describing orphans ---")
    test1_dir = ROOT / "data" / "TEST1"
    for i, filename in enumerate(orphan_filenames):
        if filename in cache["orphans"]:
            continue
        path = test1_dir / filename
        if not path.exists():
            print(f"  MISSING: {filename}")
            cache["orphans"][filename] = ""
            continue
        desc = moondream(path)
        cache["orphans"][filename] = desc
        save_cache(cache)
        print(f"  [{i+1}/{len(orphan_filenames)}] {filename[:50]}: {desc[:80]}")

    # Describe RAW photos (only those without cached descriptions)
    print("\n--- Describing RAW photos ---")
    raw_dir = ROOT / "data" / "RAW"
    for i, photo in enumerate(photos):
        pid = photo["id"]
        if pid in cache["raw"]:
            continue
        # Find the file
        candidates = list(raw_dir.glob(f"{pid}.*"))
        if not candidates:
            print(f"  MISSING RAW: {pid}")
            cache["raw"][pid] = ""
            continue
        desc = moondream(candidates[0])
        cache["raw"][pid] = desc
        save_cache(cache)
        print(f"  [{i+1}/{len(photos)}] {pid[:20]}: {desc[:80]}")

    # Match orphans to RAW photos
    print("\n--- Matching ---")
    results = []
    for filename, orphan_desc in cache["orphans"].items():
        if not orphan_desc:
            continue
        best_id = None
        best_score = 0.0
        for pid, raw_desc in cache["raw"].items():
            if not raw_desc:
                continue
            score = similarity(orphan_desc, raw_desc)
            if score > best_score:
                best_score = score
                best_id = pid
        results.append((filename, best_id, best_score, orphan_desc, cache["raw"].get(best_id, "")))

    # Sort by score descending
    results.sort(key=lambda x: -x[2])

    print(f"\nTop matches (score >= 0.3):")
    assigned = 0
    skipped_low = 0
    for filename, pid, score, odesc, rdesc in results:
        if score >= 0.30:
            print(f"  {score:.2f} | {filename[:45]} -> {pid}")
            resp, err = api_post(f"/api/orphans/{urllib.parse.quote(filename)}/assign", {"photo_id": pid})
            if err:
                print(f"    ERROR: {err}")
            else:
                assigned += 1
        else:
            skipped_low += 1

    print(f"\nDone: {assigned} assigned, {skipped_low} skipped (low confidence)")


if __name__ == "__main__":
    import urllib.parse
    main()
