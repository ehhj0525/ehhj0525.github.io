"""The manifest: the committed index the website renders from.

Browsers never touch EXIF — everything they need about a photo lives here.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .metadata import PhotoMetadata


@dataclass(frozen=True)
class PhotoEntry:
    """One photo, as both what was observed and what the site should show.

    ``exif`` and ``uploaded_at`` are the raw record and never change; the
    remaining fields are derived from them plus the current overrides. Keeping
    the raw record means an override can be edited *or removed* at any time —
    the original file is deleted, so this is the only memory of what it said.
    """

    hash: str
    name: str
    uploaded_at: datetime
    exif: PhotoMetadata
    taken_at: datetime
    date_fallback: bool
    lat: float | None
    lon: float | None
    place: str | None

    @property
    def web(self) -> str:
        return f"web/{self.hash}.jpg"

    @property
    def thumb(self) -> str:
        return f"thumbs/{self.hash}.jpg"

    def to_json(self) -> dict:
        return {
            "hash": self.hash,
            "name": self.name,
            "web": self.web,
            "thumb": self.thumb,
            "takenAt": self.taken_at.isoformat(),
            "dateFallback": self.date_fallback,
            "lat": self.lat,
            "lon": self.lon,
            "place": self.place,
            "uploadedAt": self.uploaded_at.isoformat(),
            "exif": {
                "takenAt": self.exif.taken_at.isoformat() if self.exif.taken_at else None,
                "lat": self.exif.lat,
                "lon": self.exif.lon,
            },
        }

    @classmethod
    def from_json(cls, payload: dict) -> "PhotoEntry":
        taken_at = datetime.fromisoformat(payload["takenAt"])
        date_fallback = bool(payload.get("dateFallback", False))
        raw = payload.get("exif")
        return cls(
            hash=payload["hash"],
            name=payload.get("name", ""),
            uploaded_at=_parse_date(payload.get("uploadedAt")) or taken_at,
            exif=_exif_from_json(raw, taken_at, date_fallback, payload),
            taken_at=taken_at,
            date_fallback=date_fallback,
            lat=payload.get("lat"),
            lon=payload.get("lon"),
            place=payload.get("place"),
        )


def _exif_from_json(raw, taken_at, date_fallback, payload) -> PhotoMetadata:
    """Read the raw record, falling back to the shown values for older manifests."""
    if raw is None:
        return PhotoMetadata(
            taken_at=None if date_fallback else taken_at,
            lat=payload.get("lat"),
            lon=payload.get("lon"),
        )
    return PhotoMetadata(
        taken_at=_parse_date(raw.get("takenAt")), lat=raw.get("lat"), lon=raw.get("lon")
    )


@dataclass
class Overrides:
    """Owner-supplied corrections, keyed by photo hash or original filename."""

    photos: dict[str, dict] = field(default_factory=dict)
    places: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> "Overrides":
        if not path.exists():
            return cls()
        payload = json.loads(path.read_text(encoding="utf-8"))
        return cls(photos=payload.get("photos", {}), places=payload.get("places", []))

    def for_photo(self, photo_hash: str, name: str) -> dict:
        """A hash override is more specific than a filename override, so it wins."""
        return self.photos.get(photo_hash) or self.photos.get(name) or {}


def build_entry(
    photo_hash: str,
    name: str,
    metadata: PhotoMetadata,
    uploaded_at: datetime,
    overrides: Overrides,
) -> PhotoEntry:
    """Combine EXIF, owner overrides and an upload-date fallback into one entry."""
    override = overrides.for_photo(photo_hash, name)

    taken_at = _parse_date(override.get("takenAt")) or metadata.taken_at
    lat, lon = _location(override, metadata)

    return PhotoEntry(
        hash=photo_hash,
        name=name,
        uploaded_at=uploaded_at,
        exif=metadata,
        taken_at=taken_at or uploaded_at,
        date_fallback=taken_at is None,
        lat=lat,
        lon=lon,
        place=override.get("place"),
    )


def rebuild(entry: PhotoEntry, overrides: Overrides) -> PhotoEntry:
    """Re-derive an existing entry from its raw record and the current overrides.

    Run on every photo every build, so editing overrides.json — or deleting an
    entry from it — takes effect on photos that are already published.
    """
    return build_entry(entry.hash, entry.name, entry.exif, entry.uploaded_at, overrides)


def reconcile(entries: list[PhotoEntry], present_hashes: set[str]) -> list[PhotoEntry]:
    """Drop entries whose rendered file has been deleted from the repository."""
    return [entry for entry in entries if entry.hash in present_hashes]


def sort_newest_first(entries: list[PhotoEntry]) -> list[PhotoEntry]:
    return sorted(entries, key=lambda entry: entry.taken_at, reverse=True)


def load(path: Path) -> list[PhotoEntry]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [PhotoEntry.from_json(item) for item in payload.get("photos", [])]


def save(path: Path, entries: list[PhotoEntry]) -> None:
    payload = {
        "generated": "by the Grace pipeline — edit overrides.json, not this file",
        "photos": [entry.to_json() for entry in sort_newest_first(entries)],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _parse_date(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _location(override: dict, metadata: PhotoMetadata) -> tuple[float | None, float | None]:
    lat, lon = override.get("lat"), override.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return float(lat), float(lon)
    return metadata.lat, metadata.lon
