import pytest

from grace_pipeline.geocode import PlaceResolver


class FakeNominatim:
    def __init__(self, answer="Seoul"):
        self.answer = answer
        self.calls = []

    def __call__(self, lat, lon):
        self.calls.append((lat, lon))
        return self.answer


def test_resolves_a_place_name_from_coordinates():
    resolver = PlaceResolver(cache={}, named_places=[], fetch=FakeNominatim("Seoul"))
    assert resolver.resolve(37.56, 126.97) == "Seoul"


def test_caches_so_each_location_is_looked_up_once():
    fetch = FakeNominatim()
    resolver = PlaceResolver(cache={}, named_places=[], fetch=fetch)
    resolver.resolve(37.56, 126.97)
    resolver.resolve(37.56, 126.97)
    assert len(fetch.calls) == 1


def test_nearby_coordinates_share_a_cache_entry():
    """Every photo in a room has slightly different GPS; that is one lookup, not fifty."""
    fetch = FakeNominatim()
    resolver = PlaceResolver(cache={}, named_places=[], fetch=fetch)
    resolver.resolve(37.5600, 126.9700)
    resolver.resolve(37.56004, 126.97002)
    assert len(fetch.calls) == 1


def test_reuses_a_cache_loaded_from_disk():
    fetch = FakeNominatim()
    cache = {"37.560,126.970": "Seoul"}
    resolver = PlaceResolver(cache=cache, named_places=[], fetch=fetch)
    assert resolver.resolve(37.56, 126.97) == "Seoul"
    assert fetch.calls == []


def test_a_failed_lookup_is_remembered_so_it_is_not_retried_every_build():
    fetch = FakeNominatim(answer=None)
    resolver = PlaceResolver(cache={}, named_places=[], fetch=fetch)
    assert resolver.resolve(37.56, 126.97) is None
    assert resolver.resolve(37.56, 126.97) is None
    assert len(fetch.calls) == 1


def test_named_place_wins_over_geocoding():
    fetch = FakeNominatim("Seongnam-si")
    resolver = PlaceResolver(
        cache={},
        named_places=[{"name": "할머니집", "lat": 37.56, "lon": 126.97, "radiusM": 200}],
        fetch=fetch,
    )
    assert resolver.resolve(37.5601, 126.9701) == "할머니집"
    assert fetch.calls == []


def test_named_place_does_not_capture_photos_outside_its_radius():
    resolver = PlaceResolver(
        cache={},
        named_places=[{"name": "할머니집", "lat": 37.56, "lon": 126.97, "radiusM": 100}],
        fetch=FakeNominatim("Seoul"),
    )
    assert resolver.resolve(37.60, 126.97) == "Seoul"


def test_closest_named_place_wins_when_radii_overlap():
    resolver = PlaceResolver(
        cache={},
        named_places=[
            {"name": "far", "lat": 37.60, "lon": 126.97, "radiusM": 100_000},
            {"name": "near", "lat": 37.56, "lon": 126.97, "radiusM": 100_000},
        ],
        fetch=FakeNominatim(),
    )
    assert resolver.resolve(37.5601, 126.97) == "near"


def test_photos_without_coordinates_have_no_place():
    fetch = FakeNominatim()
    resolver = PlaceResolver(cache={}, named_places=[], fetch=fetch)
    assert resolver.resolve(None, None) is None
    assert fetch.calls == []


def test_a_fetch_failure_does_not_break_the_build():
    def explode(lat, lon):
        raise RuntimeError("Nominatim is down")

    resolver = PlaceResolver(cache={}, named_places=[], fetch=explode)
    assert resolver.resolve(37.56, 126.97) is None


def test_a_transient_failure_is_retried_on_the_next_build():
    """Unlike a definitive 'no name here', an outage must not be cached forever."""
    resolver = PlaceResolver(cache={}, named_places=[], fetch=lambda lat, lon: (_ for _ in ()).throw(RuntimeError()))
    resolver.resolve(37.56, 126.97)
    assert resolver.cache == {}


@pytest.mark.parametrize("radius_key", ["radiusM", "radius_m"])
def test_named_places_accept_either_radius_spelling(radius_key):
    resolver = PlaceResolver(
        cache={},
        named_places=[{"name": "집", "lat": 37.56, "lon": 126.97, radius_key: 500}],
        fetch=FakeNominatim(),
    )
    assert resolver.resolve(37.561, 126.97) == "집"
