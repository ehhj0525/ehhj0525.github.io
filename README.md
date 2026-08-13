# Grace

A photo gallery that lives entirely in this repository. Photos are browsable as a
**timeline** (grouped by month, with an age badge) and on a **map**. Dates and
locations come from the photos' own EXIF metadata — nothing is typed in by hand.

There is no server and no database: a GitHub Action processes each upload and
commits the results, and GitHub Pages serves the result for free.

> **This repository is public, and so is everything in it** — including the exact
> GPS coordinates of every photo. That was a deliberate choice; see `SPEC.md`.
>
> **This repository is not a backup.** Originals are deleted once a web-sized copy
> exists. Keep your own copies.

## One-time setup

1. **The repository** is `ehhj0525/ehhj0525.github.io`, and the site is served from
   its `main` branch:

   ```bash
   git remote add origin https://github.com/ehhj0525/ehhj0525.github.io.git
   git push -u origin main
   ```

   The previous Jekyll site ("Grace Kim's Page") is still on the `master` branch
   of this repository — nothing was deleted, and it can be restored by pointing
   Pages back at `master`.

2. **Pages**: Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.
   The site appears at <https://ehhj0525.github.io/>.

3. **Allow the pipeline to commit**: Settings → Actions → General → Workflow
   permissions → *Read and write permissions*.

4. **Set the birth date** in `config.json` so the age badges are right:

   ```json
   { "title": "Grace", "birthDate": "2025-06-01" }
   ```

5. **Create an upload token** (only for the device you upload from): open
   <https://ehhj0525.github.io/upload.html> and follow the one-time setup.
   It asks for a fine-grained personal access token with *Contents: Read and write*
   on this repository. The token is stored in that browser only — it is never part
   of the published site.

## Adding photos

Open **`/upload.html`** on your phone, tap *Choose photos*, pick from the camera
roll. HEIC from an iPhone is fine — the pipeline converts it. Within a minute or
two the site rebuilds and the photos appear.

Dragging files into the `photos/` folder in the GitHub web UI works exactly the
same way.

## Fixing a photo

Photos sent through KakaoTalk or WhatsApp arrive with their metadata stripped, so
they land on the timeline under today's date with no location. Fix them in
`overrides.json` — keyed by the filename you uploaded (or the photo's hash):

```json
{
  "photos": {
    "from-kakao.jpg": { "takenAt": "2025-12-25T08:00:00", "lat": 37.5, "lon": 127.0 }
  },
  "places": [
    { "name": "할머니집", "lat": 37.45, "lon": 127.13, "radiusM": 300 }
  ]
}
```

- `photos` corrects one photo — any of `takenAt`, `lat`/`lon`, `place`.
- `places` names an area, so every photo taken within `radiusM` metres of that
  point is labelled "할머니집" instead of whatever OpenStreetMap calls it.

Overrides are re-applied on every build, so editing this file fixes photos that
are already published — and **removing** an entry reverts the photo to whatever
its own metadata said. Naming a place relabels every photo already taken there.

## When something can't be read

A file the pipeline cannot decode is moved to `photos/failed/` rather than
deleted, so it is not retried on every build and you can still get it back.

## Removing a photo

Delete its file from `web/` in the GitHub UI. The next build drops it from
`photos.json` and cleans up the thumbnail.

## Working on the site

```bash
uv run pytest              # the pipeline's tests
uv run grace-pipeline .    # process photos/ locally, exactly as CI does
python3 -m http.server     # then open http://localhost:8000
```

| File | What it is |
|---|---|
| `photos.json` | The manifest the site renders from. Generated — don't edit. |
| `overrides.json` | Your corrections. Hand-edited. |
| `geocache.json` | Place names already looked up, so each location costs one request ever. |
| `src/grace_pipeline/` | The pipeline: EXIF → manifest, HEIC → web JPEG. |
| `index.html`, `app.js` | The gallery. |
| `upload.html`, `upload.js` | The upload page. |
