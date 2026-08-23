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

4. **Set the birth date** in `config.json` so the age badges are right, and the
   language the site should speak:

   ```json
   { "title": "Grace", "birthDate": "2025-06-01", "language": "ko" }
   ```

   `language` is `ko` for Korean or `en` for English, and it changes every word
   on both pages — the month headings and the age badges included, each written
   the way that language writes them. Anything else, or nothing at all, and the
   site is in English.

   The `title` and `language` are also the installed app's name and language, in
   `manifest.webmanifest` — change them here and change them there. The tests
   fail if the two ever disagree, so this is not something you can forget
   quietly.

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

## Putting it on the home screen

Open the site and choose **Add to Home Screen** — *Share → Add to Home Screen* on
an iPhone, the browser's menu on Android. It comes up as an app of its own after
that: the leaf as its icon, no browser bar, and the phone's own bars in the
site's colours.

It also opens with no network at all. Photos are named after the hash of their
own contents and so can never change, which makes them exactly the sort of thing
a phone should keep: every one that has been looked at is still there on a train
or in a lift. Everything else — the pages, the manifest — is fetched every time
as it always was, and the kept copy is used only when there is nothing to fetch
from. A photo uploaded a minute ago still shows up the moment it is published.

The mark is drawn in `icon.svg`, and `icons/` holds the sizes phones ask for. If
you ever change it: `python3 .github/scripts/make-icons.py` (needs
`brew install librsvg`).

## Adding photos

Tap **Add** in the gallery's header — or open **`/upload.html`** directly — then
tap *Choose photos* and pick from the camera roll. HEIC from an iPhone is fine —
the pipeline converts it.

Then the page waits with you. Uploading is a commit, not a photo on a website —
the pipeline has to read it and Pages has to publish the result — so the page
watches the gallery until the photos are really in it and says so:
*사진 3장이 갤러리에 올라왔어요 — 보러 가기*. If one never appears it says that
too, rather than leaving you to guess: most often that means the photo was
already in the gallery, which the pipeline skips silently.

Dragging files into the `photos/` folder in the GitHub web UI works exactly the
same way, minus the watching.

## Sending a photo to somebody

Open a photo and tap the share icon. Where the phone will carry a file — most
will — it hands over the photo itself, so it lands in the chat as a photo and can
be kept; the link goes with it, for whoever wants the rest of the gallery. On a
browser with no share sheet the link goes to the clipboard instead, and the page
says so.

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

Nobody knows the coordinates of their mother's house, so neither screen makes you
type them. Both have a map: tap it, or drag the pin, and the fields fill
themselves in — and the place form draws the circle its radius covers, so you can
see whether the house is inside it. *Use where I am now* is there for the
commonest case of all, which is naming the house the phone is standing in. The
fields stay, and stay the truth: they are what gets saved, they can still be
typed into, and emptying one still means "go back to what the photo says".

The map opens on the best guess the site can make — the photo's own location, a
place already named, the most recent photo that knows where it was. When nothing
at all is known it opens on the whole world, which is honest but a lot of
pinching; fix one photo or name one place and everything after it opens in the
right neighbourhood.

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
| `manifest.js` | Reading `photos.json` — the freshest copy there is, and nothing to handle when there is none. |
| `photo-url.js` | The address of an open photo: `?photo=<hash>`, so links can be shared. |
| `share-photo.js` | Sending one photo: the file where the phone will carry one, the link where it will not, the clipboard where there is no share sheet at all. |
| `upload.html`, `upload.js` | The upload page, and the fixing screen at `?fix`. |
| `arrival.js` | Waiting for uploaded photos to turn up in the gallery, and giving up honestly when one never does. |
| `corrections.js` | Reading and changing `overrides.json` without hand-editing it: one photo's fields, a named place, merged into whatever the file already says. |
| `map-point.js` | What a tap on the map becomes in the file, and where the map should be looking when it opens. |
| `map-picker.js` | That map itself. |
| `map-tiles.js` | Whose tiles both maps are drawn with, said once. |
| `manifest.webmanifest` | What a phone reads to offer the site as an app of its own. Its name and language have to match `config.json`. |
| `icon.svg`, `icons/` | The mark, and the sizes phones ask for. Redraw with `.github/scripts/make-icons.py`. |
| `sw.js` | The service worker: what makes the app installable, and what serves it with no network. |
| `cache-policy.js` | Which requests that worker may keep and which it must always ask for — the one file here whose mistakes would be served to the family from their own phones. |
| `github.js` | Talking to this repository: which repo it is, the token, reading and writing files. |
| `language.js` | Every word both pages say, in each language they say it in. Change a sentence here, not in the page. |
| `dates.js` | How the gallery writes a month, a date and an age — each language writes all three differently. |
| `translate-page.js` | Putting those words into markup that was written in English. |
| `sealed-token.js` | Locking the upload token under a passphrase, and opening it again. Run by the workflow and by the page, so both agree on the format. |
| `sealed-token.json` | The locked token, published for step 6 above. Generated — don't edit. Absent until the workflow is run. |
| `package.json` | Only so Node reads the `.js` files as ES modules when running the tests. No dependencies. |
