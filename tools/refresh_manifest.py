"""Refresh gallery manifests from the Hugging Face dataset file tree.

Runs in GitHub Actions so the static github.io site picks up newly uploaded
videos and panorama sets without a local bridge.
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HF = "https://huggingface.co/datasets/shalevlau/djidrone"
API = "https://huggingface.co/api/datasets/shalevlau/djidrone/tree/main/"
RESOLVE = HF + "/resolve/main/"
THUMB = "thumbs/placeholder.svg"


def tree(path):
    url = API + path + "?recursive=true&expand=false"
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def main():
    # Videos
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    videos = manifest["videos"]
    known = {v["file"] for v in videos}
    added = 0
    for item in tree("uploaded"):
        if item.get("type") != "file" or not re.search(r"\.(mp4|mov|webm)$", item["path"], re.I):
            continue
        name = item["path"].split("/")[-1]
        if name in known:
            continue
        m = re.search(r"(\d{8})", name)
        videos.append({
            "file": name, "title": name, "date": m.group(1) if m else "",
            "url": RESOLVE + item["path"], "thumb": THUMB,
            "bytes": item.get("size", 0), "duration": 0,
        })
        added += 1
    manifest["videos"] = videos
    manifest["refreshed"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    # Panoramas: new sets are displayed as draggable frame walls.
    base = json.loads((ROOT / "pano" / "manifest.json").read_text())
    have = {s["id"] for s in base}
    folders = {}
    for item in tree("PANORAMA"):
        if item.get("type") != "file" or not re.search(r"\.(jpe?g|png)$", item["path"], re.I):
            continue
        parts = item["path"].split("/")
        if len(parts) >= 3:
            folders.setdefault(parts[1], []).append(RESOLVE + item["path"])
    dynamic = []
    for sid, files in sorted(folders.items()):
        if sid in have:
            continue
        files.sort()
        dynamic.append({
            "id": sid, "title": sid.replace("_", " / "), "mode": "frames",
            "count": len(files), "files": None, "frames": files,
            "sourceFolder": f"PANORAMA/{sid}/",
            "hfFolder": f"{HF}/tree/main/PANORAMA/{sid}", "size": [1000, 750],
        })
    (ROOT / "pano" / "dynamic.json").write_text(json.dumps(dynamic, indent=2) + "\n")
    print(f"added {added} videos, {len(dynamic)} new panorama sets")


if __name__ == "__main__":
    main()
