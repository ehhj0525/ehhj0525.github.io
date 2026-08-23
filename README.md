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

6. **Optional — a passphrase way in**, so a device can be set up when there is no
   already-set-up device around to show it a QR code.

   Add two repository secrets under Settings → Secrets and variables → Actions:

   | Secret | What to put in it |
   |---|---|
   | `UPLOAD_TOKEN` | The same fine-grained token as in step 5. |
   | `UPLOAD_PASSPHRASE` | **At least four separate words.** The workflow refuses anything less, and padding a short one out does not count — it is the number of words that costs a guessing machine time, not the number of characters. |

   Then run Actions → *Publish the sealed upload token* → *Run workflow*. It
   commits `sealed-token.json`, the token encrypted under the passphrase. The
   upload page downloads that and decrypts it in the browser: there is no server,
   so there is nothing that could check a passphrase for you.

   From then on, a new device only has to open
   <https://ehhj0525.github.io/upload.html> and type the passphrase into the box
   that now appears above the token field — a second or so later it is set up,
   exactly as if the token had been pasted or scanned. Until the workflow has
   been run there is no such box.

   > **Say this part out loud before you use it.** `sealed-token.json` sits in a
   > public repository. Anyone can download it and guess at the passphrase
   > offline — forever, as fast as their hardware goes, with nothing rate-limiting
   > them and no way for you to notice it happening. Key derivation is made
   > deliberately expensive (PBKDF2-SHA256, two million iterations) so that each
   > guess costs something, but that only buys a constant factor. **The passphrase
   > is the security.** Four words off a real word list is tens of thousands of
   > GPU-years; a short password of the kind people invent unaided falls in days.
   >
   > If it is guessed, what is lost is write access to a public repository that
   > also serves this site. Bounded, but real — so keep `UPLOAD_TOKEN` scoped to
   > this one repository, *Contents* only, with the shortest expiry you can live
   > with, and skip this step entirely if the QR handoff is enough for you.

   **To rotate either secret**: change it in Settings and run the workflow again.
   No file in the repository names either one, so there is nothing to edit.
   Devices already set up carry on — each holds its own copy of the token, until
   that copy is replaced or it expires.

## Adding photos

Tap **Add** in the gallery's header — or open **`/upload.html`** directly — then
tap *Choose photos* and pick from the camera roll. HEIC from an iPhone is fine —
the pipeline converts it. Within a minute or two the site rebuilds and the photos
appear.

Dragging files into the `photos/` folder in the GitHub web UI works exactly the
same way.

## Fixing a photo

Photos sent through KakaoTalk or WhatsApp arrive with their metadata stripped, so
they land on the timeline under today's date with no location.

Tap **Fix a photo** in the upload page's header. It lists the photos added most
recently — including an old one uploaded today, which the timeline buries — marks
the ones whose date is only a guess, and opens each one onto a date, a pair of
coordinates and a place name. Fill in what it should say and save — and **empty a
field** to go back to whatever the photo itself said. Naming a place is on the same
screen, under *Name a place*: a point, a radius and a name, and every photo taken
within that radius is labelled that way.

A photo added a moment ago is not on that list until the site has rebuilt: the
build is what reads the photo and gives it a name.

Corrections are kept in `overrides.json` — keyed by the filename you uploaded (or
the photo's hash) — and hand-editing it works exactly as it always did. The screen
changes only the fields it was given, so anything written by hand, including keys
it has never heard of, is left alone:

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
uv run pytest                        # the pipeline's tests
node --test 'tests/js/**/*.test.js'  # the browser side's tests (no npm install — Node's own runner)
uv run grace-pipeline .              # process photos/ locally, exactly as CI does
python3 -m http.server               # then open http://localhost:8000
```

| File | What it is |
|---|---|
| `photos.json` | The manifest the site renders from. Generated — don't edit. |
| `overrides.json` | Your corrections. Hand-edited. |
| `geocache.json` | Place names already looked up, so each location costs one request ever. |
| `src/grace_pipeline/` | The pipeline: EXIF → manifest, HEIC → web JPEG. |
| `index.html`, `app.js` | The gallery. |
| `photo-url.js` | The address of an open photo: `?photo=<hash>`, so links can be shared. |
| `upload.html`, `upload.js` | The upload page, and the fixing screen at `?fix`. |
| `corrections.js` | Reading and changing `overrides.json` without hand-editing it: one photo's fields, a named place, merged into whatever the file already says. |
| `github.js` | Talking to this repository: which repo it is, the token, reading and writing files. |
| `sealed-token.js` | Locking the upload token under a passphrase, and opening it again. Run by the workflow and by the page, so both agree on the format. |
| `sealed-token.json` | The locked token, published for step 6 above. Generated — don't edit. Absent until the workflow is run. |
| `package.json` | Only so Node reads the `.js` files as ES modules when running the tests. No dependencies. |
