# Grace Photo Gallery — Spec

A public static website showing photos of the owner's son, browsable as a **Timeline** (primary) and a **Map view** (secondary), with all photo data derived from EXIF metadata. Family views it via a shared link; no accounts, no backend. Vocabulary: see [CONTEXT.md](./CONTEXT.md).

## Decisions (settled during grilling)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Hosting | GitHub Pages, free tier → **public repo**. Owner explicitly accepts public photos **with full-precision GPS** shown. |
| 2 | Audience | Family-only via shared link; no accounts or access control. |
| 3 | Sources | iPhone **and** Android; **photos only**, no videos. HEIC must be handled. |
| 4 | Volume | Tens of photos per month. |
| 5 | Views | Timeline primary (month/year grid), Map view secondary (pins/clusters). |
| 6 | Timeline flavor | Month/year groups with **Age badges** derived from the son's birth date (config value, supplied later). |
| 7 | Upload | **Upload page** on the site: pick photos on the phone → committed via GitHub API with a personal access token stored in the browser. GitHub web-UI drag-drop works too as a fallback. |
| 8 | Processing | **Pipeline** = GitHub Action on every push: HEIC→JPEG, resize, thumbnail, EXIF → Manifest, reverse-geocode. Browsers never parse EXIF. |
| 9 | Originals | **Deleted after processing.** The repo keeps only Web versions + Thumbnails. The repo is *not* a backup; the camera roll is the archive of record. |
| 10 | Missing EXIF | Fall back to upload date + "No location" bucket; an **Override file** can hand-fix any photo's date/location/place name. Overrides win over EXIF. |
| 11 | Place names | Reverse-geocode via Nominatim at build time, cached in-repo (each location looked up once); hand-labeled overrides win ("할머니집"). |
| 12 | Account | `ehhj0525` → site at `https://ehhj0525.github.io/<repo>/`. |

## Defaults adopted when grilling was cut short (flip any of these by editing this spec)

- **Repo name**: `ehhj0525.github.io` → served at `https://ehhj0525.github.io/`. Decided during deployment: the owner chose to replace the previous Jekyll site ("Grace Kim's Page"), which is preserved on that repository's `master` branch.
- **Timeline sort**: newest-first.
- **Web version**: JPEG, max 2048 px long edge, ~quality 80. **Thumbnail**: 400 px. Since Originals are deleted, 2048 px is the largest surviving copy — acceptable because the camera roll is the archive.
- **Upload auth**: fine-grained PAT scoped to this one repo, Contents read/write only; pasted once into the Upload page, stored in `localStorage`. PATs expire (≤1 year) and must be re-issued; each family member's device that uploads needs the token.
- **Site tech**: no framework — vanilla HTML/CSS/JS reading `photos.json`; Leaflet + OpenStreetMap tiles for the Map view (free, no API key).
- **Pipeline tech**: Python (Pillow + pillow-heif for HEIC, Pillow for EXIF), because pillow-heif ships HEIC decoding via pip with no native-build friction. Runs on `push`, commits results back to `main`; GitHub Pages serves `main`.

## Decisions added since (same rules: flip any of these by editing this spec)

| # | Decision | Choice |
|---|----------|--------|
| 13 | Installable | **Yes** — manifest + icons + service worker, so the site goes on the home screen as an app rather than a bookmark. A phone only offers the app treatment to a site that can answer with no network, so the worker is what buys the icon. |
| 14 | What is cached | **Content-hashed files only** (`web/`, `thumbs/`, versioned CDN libraries). Everything else is network-first with the cached copy used only when the fetch fails, so a fresh upload can never be hidden by a cache. `api.github.com` is never touched. |
| 15 | App name | The manifest repeats `config.json`'s title and language, and a **test fails when the two disagree** — rather than the pipeline generating the manifest. One fewer moving part in the build; the drift is caught at the only moment it can be fixed. |
| 16 | Sharing a photo | **The file first, the link second.** A photo sent into a chat is looked at where it lands by somebody who may never follow a link. Where the browser cannot carry a file, the link; where there is no share sheet, the clipboard. |
| 17 | After an upload | The page **watches the published manifest** until the photos are in it, then says so. It gives up after 8 minutes and says that too — a photo already in the gallery is deduplicated silently and never arrives at all. |
| 18 | Saying where a photo was | **A map to tap**, on both the place form and each photo's row. The coordinate fields remain the record and remain editable; the map writes into them. Opening a map never writes a correction on its own. |
| 19 | Where a picker opens | The best guess the site already holds — the point in the fields, the photo's own location, a correction saved a moment ago, a named place, the most recent located photo — and the whole world when it holds none. A guess gets no pin. |

## Repository layout

```
grace/
├── photos/           # Upload target. Originals land here; Pipeline empties it.
├── web/              # Web versions (2048px JPEG), named by content hash
├── thumbs/           # Thumbnails (400px JPEG), same names
├── photos.json       # Manifest — the only thing the Timeline and Map read
├── failed.json       # Files the Pipeline could not read; reported on the Upload page
├── overrides.json    # Owner-edited date/location/place-name fixes
├── geocache.json     # Nominatim results, one entry per unique location
├── config.json       # Birth date, site title
├── index.html / app.js / style.css   # The site (Timeline + Map + Upload page)
├── upload.html       # Upload page
├── manifest.webmanifest / icon.svg / icons/   # The installed app's name and mark
├── sw.js             # Service worker: installable, and openable with no network
└── .github/workflows/pipeline.yml
```

## Behaviors

### Pipeline (GitHub Action, on push)
1. For each file in `photos/`: decode (HEIC/JPEG/PNG), read EXIF `DateTimeOriginal` + GPS.
2. Content-hash the image → skip if hash already in Manifest (silent dedupe of double uploads).
3. Generate Web version + Thumbnail named `<hash>.jpg`.
4. Reverse-geocode new coordinates via Nominatim (cache in `geocache.json`; throttle to 1 req/s per usage policy).
5. Merge `overrides.json` (overrides win over EXIF), write Manifest entry: hash, taken-at (or upload date + `dateFallback: true`), lat/lon (or null), place name, paths.
6. Delete the Original from `photos/`; reconcile Manifest against `web/` so photos deleted via GitHub UI disappear from the site.
7. Commit everything back to `main` (guard against self-triggering loops, e.g. skip when the push only touches Pipeline outputs).

### Site
- **Timeline**: newest-first month/year sections, Age badge per section ("8 months"), thumbnails in a grid, tap → full-screen Web version with date + place name.
- **Map view**: Leaflet + OSM, marker clusters; tapping a pin shows that location's photos. Photos without Location appear only on the Timeline ("No location" is not on the map).
- **Upload page**: file picker (multi-select, `accept="image/*"`), commits each file to `photos/` via GitHub Contents API; asks for the PAT on first use, keeps it in `localStorage`; shows per-file progress and a "pipeline will process these in ~2 min" notice.

### Edge cases (settled)
- Messenger-app photos (EXIF stripped) → upload date + No-location bucket; rescue via `overrides.json`.
- Duplicate upload → deduped by content hash, silently.
- Photo removal → delete `web/<hash>.jpg` (or the entry) in GitHub UI; next Pipeline run reconciles the Manifest.

## Out of scope
- Videos, comments, accounts/auth for viewing, private hosting, EXIF stripping/blurring (owner explicitly declined), original-quality archival.
