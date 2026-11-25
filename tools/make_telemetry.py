"""Parse DJI .SRT flight logs into compact per-flight telemetry JSON.

Each SRT cue carries one telemetry line, e.g.:
  [iso: 110] [shutter: 1/400.0] [fnum: 1.7] [ev: 1.0] ... [latitude: 22.36]
  [longitude: 114.06] [rel_alt: 1.400 abs_alt: 25.971] [ct: 4585]

Output: telemetry/<video-stem>.json with downsampled points:
  [t_seconds, lat, lon, rel_alt_m, abs_alt_m, speed_kmh, vertical_speed_ms]
"""
import json
import math
import re
from pathlib import Path

SRC = Path("/run/media/over/Expansion/save/backup/DCIM/DJI_001/dji srt")
OUT = Path("/home/over/djidrone-work/site-telemetry/telemetry")
OUT.mkdir(parents=True, exist_ok=True)

CUE = re.compile(r"(\d+):(\d+):(\d+),(\d+)\s+-->\s+(\d+):(\d+):(\d+),(\d+)")
TEL = re.compile(
    r"\[latitude:\s*(-?\d+(?:\.\d+)?)\]\s*\[longitude:\s*(-?\d+(?:\.\d+)?)\]\s*"
    r"\[rel_alt:\s*(-?\d+(?:\.\d+)?)\s+abs_alt:\s*(-?\d+(?:\.\d+)?)\]"
)
DT = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)")
MAX_POINTS = 480


def haversine(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def smooth(vals, window=15):
    if not vals:
        return vals
    out, s = [], 0.0
    half = window // 2
    # prefix sums for a centered moving average
    pre = [0.0]
    for v in vals:
        pre.append(pre[-1] + v)
    n = len(vals)
    for i in range(n):
        a, b = max(0, i - half), min(n, i + half + 1)
        out.append((pre[b] - pre[a]) / (b - a))
    return out


def parse(path):
    text = path.read_text(encoding="utf-8", errors="replace")
    cues = []
    for m in CUE.finditer(text):
        h, mi, s, ms = (int(m.group(i)) for i in range(1, 5))
        cues.append(h * 3600 + mi * 60 + s + ms / 1000.0)
    tel = [(float(a), float(b), float(c), float(d)) for a, b, c, d in TEL.findall(text)]
    n = min(len(cues), len(tel))
    raw = []
    last = None
    for i in range(n):
        t = cues[i] - cues[0]
        lat, lon, rel, absa = tel[i]
        if lat == 0.0 and lon == 0.0:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        spd = 0.0
        if last is not None:
            dt = t - last[0]
            if 0 < dt < 5:
                spd = haversine(last[1], last[2], lat, lon) / dt * 3.6
        raw.append([t, lat, lon, rel, absa, spd])
        last = (t, lat, lon)
    if len(raw) < 2:
        return None
    speeds = smooth([p[5] for p in raw])
    vs = [0.0] * len(raw)
    for i in range(1, len(raw)):
        dt = raw[i][0] - raw[i - 1][0]
        if 0 < dt < 5:
            vs[i] = (raw[i][3] - raw[i - 1][3]) / dt
    vs = smooth(vs)
    for i, p in enumerate(raw):
        p[5] = speeds[i]
        p.append(vs[i])

    # uniform downsample, always keeping the first and last point
    if len(raw) > MAX_POINTS:
        step = (len(raw) - 1) / (MAX_POINTS - 1)
        idx = sorted({int(round(i * step)) for i in range(MAX_POINTS)})
        raw = [raw[i] for i in idx]

    dist = 0.0
    for i in range(1, len(raw)):
        dist += haversine(raw[i - 1][1], raw[i - 1][2], raw[i][1], raw[i][2])

    pts = [
        [round(p[0], 2), round(p[1], 6), round(p[2], 6),
         round(p[3], 1), round(p[4], 1), round(p[5], 1), round(p[6], 1)]
        for p in raw
    ]
    dts = DT.findall(text[:400])
    return {
        "file": path.stem + ".MP4",
        "start": dts[0] if dts else None,
        "duration": round(pts[-1][0], 1),
        "distance": round(dist, 1),
        "max_alt": round(max(p[3] for p in pts), 1),
        "max_speed": round(max(p[5] for p in pts), 1),
        "points": pts,
    }


def norm(stem):
    return re.sub(r"\s*\(\d+\)$", "", stem).strip().lower()


index = {}
for srt in sorted(SRC.glob("*.SRT")):
    data = parse(srt)
    if not data:
        print("skip (no GPS):", srt.name, flush=True)
        continue
    name = norm(srt.stem)
    (OUT / f"{name}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    index[name] = {
        "start": data["start"], "duration": data["duration"], "distance": data["distance"],
        "max_alt": data["max_alt"], "max_speed": data["max_speed"], "points": len(data["points"]),
    }
    print(f"{srt.name}: {len(data['points'])} pts, {data['distance']/1000:.2f} km, "
          f"max {data['max_alt']} m / {data['max_speed']} km/h", flush=True)

(OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
print(f"\nwrote {len(index)} telemetry files", flush=True)
