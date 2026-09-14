#!/usr/bin/env python3
"""Add a song he owns to the workout player, privately.

    python3 tools/add_song.py "/path/to/song.m4a" --bpm 120
    python3 tools/add_song.py "/path/to/song.m4a" --bpm 120 --data-dir /tmp/test --no-upload

What it does, and what it never does:
- COPIES the file byte for byte (shutil.copy2) into data/media/<sha256>.<ext>,
  then re-hashes the copy and refuses to continue if it differs. The original
  in the Music library is never moved, changed or re-encoded.
- Records it in data/media/index.json (sha256, name, bpm, bytes, type).
- Uploads the same bytes and the index to media/ in the PRIVATE sync repo
  (fy9syzbg24-svg/acl-rehab-data), through the gh CLI, so the phone and iPad
  can download it once. Refuses outright if that repo is not private.
- Never writes into app/, the public repo, or the published site.

data/ is gitignored, so nothing here can be committed to the public shell.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "fy9syzbg24-svg/acl-rehab-data"
GH = str(Path.home() / ".local" / "bin" / "gh")
TYPES = {".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".aac": "audio/aac"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def gh(*args, input_path: str | None = None) -> dict:
    cmd = [GH, "api", *args]
    if input_path:
        cmd += ["--input", input_path]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"gh api failed: {out.stderr.strip()[:300]}")
    return json.loads(out.stdout or "{}")


def remote_sha(path: str) -> str | None:
    out = subprocess.run([GH, "api", f"repos/{REPO}/contents/{path}", "--jq", ".sha"], capture_output=True, text=True)
    return out.stdout.strip() or None if out.returncode == 0 else None


def put(path: str, data: bytes, message: str) -> None:
    body = {"message": message, "content": base64.b64encode(data).decode("ascii")}
    existing = remote_sha(path)
    if existing:
        body["sha"] = existing
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
        json.dump(body, tmp)
        name = tmp.name
    try:
        gh("-X", "PUT", f"repos/{REPO}/contents/{path}", input_path=name)
    finally:
        Path(name).unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("song", type=Path)
    ap.add_argument("--bpm", type=int, required=True)
    ap.add_argument("--name", help="display name (default: the file name without a track number)")
    ap.add_argument("--data-dir", type=Path, default=ROOT / "data")
    ap.add_argument("--no-upload", action="store_true")
    args = ap.parse_args()

    src = args.song.expanduser()
    if not src.is_file():
        raise SystemExit(f"no such file: {src}")
    ext = src.suffix.lower()
    if ext not in TYPES:
        raise SystemExit(f"unsupported audio type {ext}")
    if "app" in args.data_dir.resolve().parts[-2:]:
        raise SystemExit("refusing to store media under app/, which is published")

    digest = sha256(src)
    media = args.data_dir / "media"
    media.mkdir(parents=True, exist_ok=True)
    dest = media / f"{digest}{ext}"
    if not dest.exists():
        shutil.copy2(src, dest)
    if sha256(dest) != digest:
        dest.unlink()
        raise SystemExit("the copy does not match the original; nothing kept")

    stem = src.stem
    name = args.name or (stem.split(" ", 1)[1] if stem[:2].isdigit() and " " in stem else stem)
    idx_path = media / "index.json"
    try:
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        idx = {"songs": []}
    idx["songs"] = [s for s in idx.get("songs", []) if s.get("sha") != digest]
    idx["songs"].append({"sha": digest, "name": name, "bpm": args.bpm, "bytes": dest.stat().st_size,
                         "type": TYPES[ext], "file": dest.name})
    idx_path.write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"copied  {dest.name}  ({dest.stat().st_size} bytes, sha256 verified)")

    if args.no_upload:
        return 0
    vis = subprocess.run([GH, "repo", "view", REPO, "--json", "visibility", "-q", ".visibility"],
                         capture_output=True, text=True).stdout.strip()
    if vis != "PRIVATE":
        raise SystemExit(f"{REPO} is not private ({vis or 'unknown'}); refusing to upload")
    if not remote_sha(f"media/{dest.name}"):
        put(f"media/{dest.name}", dest.read_bytes(), "Add a song for the workout player")
        print(f"uploaded media/{dest.name} to {REPO} (private)")
    else:
        print(f"already in {REPO}: media/{dest.name}")
    put("media/index.json", idx_path.read_bytes(), "Update the song index")
    print("uploaded media/index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
