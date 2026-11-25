# DJI Drone Archive — GitHub Pages site

Static gallery for the [`shalevlau/djidrone`](https://huggingface.co/datasets/shalevlau/djidrone)
Hugging Face dataset. Live at <https://altcar.github.io/djidrone/>.

## Layout

- `index.html`, `styles.css`, `app.js` — the single-page app.
- `manifest.json` — 119 video entries (filename, date, duration, size, thumbnail, HF stream URL).
- `thumbs/` — derived video thumbnails (small JPEGs).
- `pano/manifest.json` — the four `PANORAMA/` sets and how each is displayed.
- `pano/*.jpg` — web-sized copies of DJI's own auto-stitched panorama JPEGs.
- `pano/frames/001_0005/` — small derived copies of the 17 source frames for the partial-capture 3D ring.

No source files from the dataset were modified. Everything under `thumbs/` and `pano/`
is a derived copy generated for the web.

## How it works

- Videos are **not** stored in this repo (GitHub file limits). They stream with HTTP
  range requests from `https://huggingface.co/datasets/shalevlau/djidrone/resolve/main/uploaded/`.
- The two 25-shot `PANORAMA` folders are full DJI Sphere captures (360°). DJI's
  auto-stitched 8192×4096 equirectangular JPEGs are used as textures on an inverted
  Three.js sphere — drag to look around, scroll to zoom.
- `001_0089` has 9 shots (DJI Wide Angle, 3×3) and is shown on a limited cylinder
  from DJI's stitched JPEG.
- `001_0005` has 17 shots, not a standard 25-shot Sphere capture and has no DJI
  stitched JPEG. A naive OpenCV stitch leaves large holes, so the site presents its
  source frames as a draggable 3D frame wall instead of a broken sphere.

## Panorama shot layouts (researched)

- **25 shots** = DJI Sphere (Mavic Air: 3 rows × 8 columns + one nadir; 8192×4096
  equirectangular). Used for `001_0002` and `001_0081`.
- **21 shots** = DJI 180° mode: 3 rows × 7 columns. The drone starts at the centre
  column (middle, top, bottom), then zig-zags left column by column, then jumps to
  the right side and zig-zags back. Documented by DJI owners and review sites.
- **17 shots** = a shorter 180°/partial-sphere capture. Feature-overlap analysis of
  `001_0005` resolves a **5-column × 3-row grid plus two steep up/down shots**:
  - top (sky) row: PANO 2, 7, 17, 13, 14
  - middle (horizon) row: PANO 1, 6, 9, 12, 15
  - bottom (ground) row: PANO 3, 5, 10, 11, 16
  - steep shots: PANO 4 (up), PANO 8 (down)

That row-major order is the default puzzle arrangement for `001_0005`, stored in
the gist linked in `config.json`. Use **Reset order** in the puzzle to restore it.
