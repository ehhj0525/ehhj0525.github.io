"""Reading a photo's own account of when and where it was taken."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS

_DATE_TAGS = ("DateTimeOriginal", "DateTimeDigitized", "DateTime")
_EXIF_DATE_FORMAT = "%Y:%m:%d %H:%M:%S"


@dataclass(frozen=True)
class PhotoMetadata:
    """When and where a photo was taken, as far as its EXIF is willing to say.

    ``taken_at`` is deliberately naive: EXIF records the wall-clock time on the
    camera, and a gallery wants to show "10:30 in the morning" wherever it was.
    """

    taken_at: datetime | None
    lat: float | None
    lon: float | None


def from_exif(exif: dict, gps: dict) -> PhotoMetadata:
    """Build metadata from EXIF tag dictionaries, ignoring anything malformed."""
    lat, lon = _coordinates(gps)
    return PhotoMetadata(taken_at=_taken_at(exif), lat=lat, lon=lon)


def read(image: Image.Image) -> PhotoMetadata:
    """Read metadata straight from an opened image."""
    try:
        raw = image.getexif()
    except Exception:
        return PhotoMetadata(None, None, None)

    exif = {TAGS.get(tag, tag): value for tag, value in raw.items()}
    exif.update({TAGS.get(tag, tag): value for tag, value in raw.get_ifd(0x8769).items()})
    gps = {GPSTAGS.get(tag, tag): value for tag, value in raw.get_ifd(0x8825).items()}
    return from_exif(exif, gps)


def _taken_at(exif: dict) -> datetime | None:
    for tag in _DATE_TAGS:
        value = exif.get(tag)
        if not value:
            continue
        try:
            return datetime.strptime(str(value).strip(), _EXIF_DATE_FORMAT)
        except ValueError:
            continue
    return None


def _coordinates(gps: dict) -> tuple[float | None, float | None]:
    lat = _degrees(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef"), limit=90)
    lon = _degrees(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"), limit=180)
    if lat is None or lon is None:
        return None, None
    if lat == 0 and lon == 0:
        # Cameras write null island when they never got a fix.
        return None, None
    return lat, lon


def _degrees(dms, ref, *, limit: float) -> float | None:
    """Convert EXIF degrees/minutes/seconds into a signed decimal degree."""
    if dms is None:
        return None
    try:
        degrees, minutes, seconds = (float(part) for part in dms)
    except (TypeError, ValueError, ZeroDivisionError):
        return None

    value = degrees + minutes / 60 + seconds / 3600
    if str(ref).upper() in ("S", "W"):
        value = -value
    if not -limit <= value <= limit:
        return None
    return round(value, 6)
