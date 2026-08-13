from datetime import datetime

from grace_pipeline.metadata import PhotoMetadata, from_exif


def test_reads_taken_at_and_coordinates():
    meta = from_exif(
        {"DateTimeOriginal": "2026:08:13 10:30:00"},
        {
            "GPSLatitude": (37.0, 33.0, 36.0),
            "GPSLatitudeRef": "N",
            "GPSLongitude": (126.0, 58.0, 41.0),
            "GPSLongitudeRef": "E",
        },
    )
    assert meta.taken_at == datetime(2026, 8, 13, 10, 30, 0)
    assert meta.lat == 37.56
    assert meta.lon == 126.978056


def test_southern_and_western_hemispheres_are_negative():
    meta = from_exif(
        {},
        {
            "GPSLatitude": (33.0, 51.0, 0.0),
            "GPSLatitudeRef": "S",
            "GPSLongitude": (151.0, 12.0, 0.0),
            "GPSLongitudeRef": "W",
        },
    )
    assert meta.lat == -33.85
    assert meta.lon == -151.2


def test_missing_exif_yields_empty_metadata():
    assert from_exif({}, {}) == PhotoMetadata(taken_at=None, lat=None, lon=None)


def test_falls_back_to_datetime_tag_when_original_absent():
    meta = from_exif({"DateTime": "2025:01:02 03:04:05"}, {})
    assert meta.taken_at == datetime(2025, 1, 2, 3, 4, 5)


def test_unparseable_date_is_ignored_rather_than_raising():
    assert from_exif({"DateTimeOriginal": "0000:00:00 00:00:00"}, {}).taken_at is None
    assert from_exif({"DateTimeOriginal": "garbage"}, {}).taken_at is None


def test_partial_gps_is_dropped():
    """A latitude with no longitude is not a location."""
    meta = from_exif({}, {"GPSLatitude": (37.0, 0.0, 0.0), "GPSLatitudeRef": "N"})
    assert meta.lat is None
    assert meta.lon is None


def test_null_island_is_treated_as_missing():
    """Cameras write 0/0 when they have no fix; it is not a real location."""
    meta = from_exif(
        {},
        {
            "GPSLatitude": (0.0, 0.0, 0.0),
            "GPSLatitudeRef": "N",
            "GPSLongitude": (0.0, 0.0, 0.0),
            "GPSLongitudeRef": "E",
        },
    )
    assert meta.lat is None
    assert meta.lon is None


def test_out_of_range_coordinates_are_dropped():
    meta = from_exif(
        {},
        {
            "GPSLatitude": (99.0, 0.0, 0.0),
            "GPSLatitudeRef": "N",
            "GPSLongitude": (10.0, 0.0, 0.0),
            "GPSLongitudeRef": "E",
        },
    )
    assert meta.lat is None
    assert meta.lon is None
