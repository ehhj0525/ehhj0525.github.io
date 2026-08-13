"""Turning coordinates into place names, cheaply and politely.

Nominatim is free but rate-limited, so every unique location is looked up once
and the answer is committed to the repository. Owner-named places win outright.
"""

from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "grace-photo-gallery/0.1 (https://github.com/ehhj0525)"

# ~110 m of latitude: fine enough to tell neighbourhoods apart, coarse enough
# that fifty photos taken in one room share a single lookup.
_CACHE_PRECISION = 3

_NAME_FIELDS = (
    "neighbourhood",
    "suburb",
    "village",
    "town",
    "city_district",
    "city",
    "county",
    "state",
    "country",
)


class PlaceResolver:
    """Resolves coordinates to a human place name: named places, then cache, then Nominatim."""

    def __init__(self, cache: dict, named_places: list[dict], fetch: Callable[[float, float], str | None]):
        self.cache = cache
        self.named_places = named_places
        self._fetch = fetch
        self.dirty = False

    def resolve(self, lat: float | None, lon: float | None) -> str | None:
        if lat is None or lon is None:
            return None

        named = self._named_place(lat, lon)
        if named:
            return named

        key = f"{lat:.{_CACHE_PRECISION}f},{lon:.{_CACHE_PRECISION}f}"
        if key in self.cache:
            return self.cache[key]

        try:
            name = self._fetch(lat, lon)
        except Exception:
            # An outage is not an answer — leave the cache empty and retry next build.
            return None

        self.cache[key] = name
        self.dirty = True
        return name

    def _named_place(self, lat: float, lon: float) -> str | None:
        matches = []
        for place in self.named_places:
            try:
                distance = _haversine_m(lat, lon, float(place["lat"]), float(place["lon"]))
                radius = float(place.get("radiusM", place.get("radius_m", 150)))
            except (KeyError, TypeError, ValueError):
                continue
            if distance <= radius:
                matches.append((distance, place["name"]))
        return min(matches)[1] if matches else None


def load_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_cache(path: Path, cache: dict) -> None:
    path.write_text(json.dumps(cache, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def nominatim_fetch(lat: float, lon: float, *, pause: float = 1.1) -> str | None:
    """Reverse-geocode one point, respecting Nominatim's one-request-per-second policy."""
    time.sleep(pause)
    query = urllib.parse.urlencode(
        {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 14, "accept-language": "en"}
    )
    request = urllib.request.Request(f"{NOMINATIM_URL}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return _best_name(payload.get("address", {}))


def _best_name(address: dict) -> str | None:
    parts = [address[field] for field in _NAME_FIELDS if address.get(field)]
    if not parts:
        return None
    # A place reads best as "somewhere specific, somewhere recognisable".
    return parts[0] if len(parts) == 1 else f"{parts[0]}, {parts[-1]}"


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))
