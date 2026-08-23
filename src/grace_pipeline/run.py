"""The pipeline: photos/ in, web/ + thumbs/ + photos.json out, originals gone."""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path

from . import failures, geocode, images, manifest, metadata
from .geocode import PlaceResolver
from .manifest import Overrides, PhotoEntry


@dataclass
class Summary:
    added: int = 0
    duplicates: int = 0
    removed: int = 0
    failed: int = 0

    def __str__(self) -> str:
        return (
            f"{self.added} added, {self.duplicates} duplicate(s) skipped, "
            f"{self.removed} removed, {self.failed} failed"
        )


def run(root: Path, *, fetch=None, now: datetime | None = None) -> Summary:
    root = Path(root)
    inbox = root / "photos"
    quarantine = inbox / "failed"
    web_dir, thumb_dir = root / "web", root / "thumbs"
    upload_date = now or datetime.now()
    summary = Summary()

    overrides = Overrides.load(root / "overrides.json")
    entries = {entry.hash: entry for entry in manifest.load(root / "photos.json")}
    unreadable = {record.name: record for record in failures.load(root / "failed.json")}

    waiting = sorted(p for p in inbox.iterdir() if images.is_photo(p)) if inbox.exists() else []
    for path in waiting:
        try:
            photo_hash = images.content_hash(path)
            if photo_hash in entries:
                summary.duplicates += 1
            else:
                image = images.open_photo(path)
                images.write_renditions(image, web_dir / f"{photo_hash}.jpg", thumb_dir / f"{photo_hash}.jpg")
                entries[photo_hash] = manifest.build_entry(
                    photo_hash, path.name, metadata.read(image), upload_date, overrides
                )
                summary.added += 1
            path.unlink()  # the camera roll is the archive, not this repository
        except Exception as error:  # one bad file must not cost the whole build
            print(f"  ! could not read {path.name}: {error}", file=sys.stderr)
            summary.failed += 1
            unreadable[path.name] = failures.Failure(path.name, _reason(error, path))
            _set_aside(path, quarantine)

    kept = _reconcile_with_disk(list(entries.values()), web_dir, thumb_dir, summary)
    published_places = {entry.hash: entry.place for entry in kept}
    kept = [manifest.rebuild(entry, overrides) for entry in kept]

    resolver = PlaceResolver(
        cache=geocode.load_cache(root / "geocache.json"),
        named_places=overrides.places,
        fetch=fetch if fetch is not None else geocode.nominatim_fetch,
    )
    kept = [_place(entry, overrides, resolver, published_places.get(entry.hash)) for entry in kept]

    manifest.save(root / "photos.json", kept)
    failures.save(root / "failed.json", failures.reconcile(list(unreadable.values()), quarantine))
    if resolver.dirty:
        geocode.save_cache(root / "geocache.json", resolver.cache)
    return summary


def _reason(error: Exception, path: Path) -> str:
    """The decoder's own words, minus the build machine's absolute paths."""
    return str(error).replace(str(path), path.name) or type(error).__name__


def _set_aside(path: Path, quarantine: Path) -> None:
    """Move a file the pipeline cannot read out of the inbox.

    Left in place it would fail again on every future build; deleted it would be
    gone for good, and the owner has no other copy of it here.
    """
    try:
        quarantine.mkdir(parents=True, exist_ok=True)
        path.replace(quarantine / path.name)
    except OSError as error:
        print(f"  ! could not set aside {path.name}: {error}", file=sys.stderr)


def _reconcile_with_disk(
    entries: list[PhotoEntry], web_dir: Path, thumb_dir: Path, summary: Summary
) -> list[PhotoEntry]:
    """A photo deleted from web/ in the GitHub UI disappears from the site."""
    present = {path.stem for path in web_dir.glob("*.jpg")} if web_dir.exists() else set()
    kept = manifest.reconcile(entries, present)
    summary.removed = len(entries) - len(kept)

    for orphan in {entry.hash for entry in entries} - present:
        (thumb_dir / f"{orphan}.jpg").unlink(missing_ok=True)
    return kept


def _place(
    entry: PhotoEntry, overrides: Overrides, resolver: PlaceResolver, published: str | None
) -> PhotoEntry:
    """Re-resolve the place name every build, so naming a place relabels old photos.

    This is cheap — names already looked up come from the committed cache — and
    ``published`` is kept as a last resort so a geocoder outage cannot blank a
    name the site was already showing.
    """
    override_place = overrides.for_photo(entry.hash, entry.name).get("place")
    if entry.lat is None:
        return replace(entry, place=override_place)
    return replace(entry, place=override_place or resolver.resolve(entry.lat, entry.lon) or published)


def main() -> int:
    parser = argparse.ArgumentParser(description="Process new photos into the Grace gallery.")
    parser.add_argument("root", nargs="?", default=".", type=Path, help="repository root")
    args = parser.parse_args()

    summary = run(args.root)
    print(f"Grace pipeline: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
