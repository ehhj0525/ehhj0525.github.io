# Grace Photo Gallery

A public static website (GitHub Pages) showing photos of the owner's son, browsable as a timeline and on a map, with all photo data derived from the photos' own metadata. Viewed by family via a shared link; no accounts.

## Language

**Photo**:
A single image of the son, stored in the site's GitHub repository. Photos only — the gallery has no videos.
_Avoid_: Image, picture, media

**Taken-at**:
The moment a Photo was captured, read from its EXIF metadata. Drives the Timeline.
_Avoid_: Upload date, created date

**Location**:
The GPS coordinates where a Photo was taken, read from its EXIF metadata. Shown publicly at full precision (owner's explicit decision).
_Avoid_: Geotag, position

**Timeline**:
The primary view — a chronological grid of Photos grouped by month/year, each group carrying an Age badge.
_Avoid_: Feed, stream

**Map view**:
The secondary view — a map with pins/clusters of Photos by Location.
_Avoid_: Location view

**Age badge**:
A label on a Timeline group ("8 months") derived from the son's birth date and the Photos' Taken-at.

**Upload**:
The act of adding new Photos to the GitHub repository, normally from a phone via the Upload page; the site updates from the repository contents with no separate backend.
_Avoid_: Import, sync

**Upload page**:
A page on the site itself where the owner picks Photos from the camera roll; it commits them to the repository via the GitHub API using a personal access token stored only in the owner's browser.

**Original**:
A Photo as uploaded, before processing. Originals are deleted by the pipeline after the Web version is generated — the repository is not an archive; the owner's camera roll is.

**Web version**:
The browser-ready JPEG the pipeline generates from an Original. The only full-view copy the repository keeps.

**Thumbnail**:
A small JPEG the pipeline generates for Timeline/Map grids.

**Manifest**:
`photos.json` — the committed index of every Photo. Holds both the Raw record and the resolved Taken-at, Location, Place name and file paths. The site renders only from the Manifest; browsers never read EXIF.

**Raw record**:
What a Photo's own EXIF said, plus the date it was uploaded, kept in the Manifest unchanged. Because Originals are deleted, this is the only surviving memory of the Photo's own account of itself — and what an Override is layered on top of.

**Override file**:
A hand-edited file that supplies or corrects a Photo's Taken-at, Location, or Place name when EXIF is missing or wrong (e.g. messenger-app photos). Wins over the Raw record; removing an entry restores it.

**Place name**:
The human label for a Location ("Seoul", "할머니집"). Reverse-geocoded automatically at build time (cached in the repo), with hand-labeled overrides winning.

**Pipeline**:
The GitHub Action that runs on every push: converts/resizes Originals into Web versions and Thumbnails, extracts EXIF into the Manifest, reverse-geocodes new Locations, then deletes the Originals.
_Avoid_: Build, CI
