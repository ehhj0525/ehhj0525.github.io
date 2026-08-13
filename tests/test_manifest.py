from datetime import datetime

from grace_pipeline.manifest import (
    Overrides,
    PhotoEntry,
    build_entry,
    rebuild,
    reconcile,
    sort_newest_first,
)
from grace_pipeline.metadata import PhotoMetadata

FALLBACK = datetime(2026, 8, 13, 23, 0, 0)


def entry(**kw) -> PhotoEntry:
    defaults = dict(
        hash="h1",
        name="IMG_0001.HEIC",
        uploaded_at=FALLBACK,
        exif=PhotoMetadata(taken_at=datetime(2026, 1, 1), lat=None, lon=None),
        taken_at=datetime(2026, 1, 1),
        date_fallback=False,
        lat=None,
        lon=None,
        place=None,
    )
    return PhotoEntry(**{**defaults, **kw})


class TestBuildEntry:
    def test_uses_exif_date_and_location(self):
        meta = PhotoMetadata(taken_at=datetime(2026, 3, 1, 9, 0), lat=37.5, lon=127.0)
        result = build_entry("h1", "IMG_1.HEIC", meta, FALLBACK, Overrides())
        assert result.taken_at == datetime(2026, 3, 1, 9, 0)
        assert result.date_fallback is False
        assert (result.lat, result.lon) == (37.5, 127.0)

    def test_falls_back_to_upload_date_when_exif_has_none(self):
        """Messenger apps strip EXIF; the photo still belongs on the timeline."""
        result = build_entry("h1", "IMG_1.jpg", PhotoMetadata(None, None, None), FALLBACK, Overrides())
        assert result.taken_at == FALLBACK
        assert result.date_fallback is True
        assert result.lat is None

    def test_override_by_hash_wins_over_exif(self):
        meta = PhotoMetadata(taken_at=datetime(2026, 3, 1), lat=37.5, lon=127.0)
        overrides = Overrides(photos={"h1": {"takenAt": "2025-12-25T08:00:00", "lat": 1.5, "lon": 2.5}})
        result = build_entry("h1", "IMG_1.jpg", meta, FALLBACK, overrides)
        assert result.taken_at == datetime(2025, 12, 25, 8, 0)
        assert (result.lat, result.lon) == (1.5, 2.5)
        assert result.date_fallback is False

    def test_override_can_be_keyed_by_original_filename(self):
        """Hashes are unfriendly to type; the filename the owner uploaded works too."""
        overrides = Overrides(photos={"IMG_1.jpg": {"place": "할머니집"}})
        result = build_entry("h1", "IMG_1.jpg", PhotoMetadata(None, None, None), FALLBACK, overrides)
        assert result.place == "할머니집"

    def test_hash_override_beats_filename_override(self):
        overrides = Overrides(
            photos={"h1": {"place": "by hash"}, "IMG_1.jpg": {"place": "by name"}}
        )
        result = build_entry("h1", "IMG_1.jpg", PhotoMetadata(None, None, None), FALLBACK, overrides)
        assert result.place == "by hash"

    def test_override_supplying_only_a_date_leaves_location_from_exif(self):
        meta = PhotoMetadata(taken_at=None, lat=37.5, lon=127.0)
        overrides = Overrides(photos={"h1": {"takenAt": "2025-12-25T08:00:00"}})
        result = build_entry("h1", "IMG_1.jpg", meta, FALLBACK, overrides)
        assert (result.lat, result.lon) == (37.5, 127.0)

    def test_half_an_override_location_is_ignored(self):
        meta = PhotoMetadata(taken_at=None, lat=37.5, lon=127.0)
        overrides = Overrides(photos={"h1": {"lat": 1.5}})
        result = build_entry("h1", "IMG_1.jpg", meta, FALLBACK, overrides)
        assert (result.lat, result.lon) == (37.5, 127.0)

    def test_web_and_thumb_paths_derive_from_hash(self):
        result = build_entry("abc", "IMG_1.jpg", PhotoMetadata(None, None, None), FALLBACK, Overrides())
        assert result.web == "web/abc.jpg"
        assert result.thumb == "thumbs/abc.jpg"


class TestReconcile:
    def test_drops_entries_whose_web_file_is_gone(self):
        """Deleting web/<hash>.jpg in the GitHub UI removes the photo from the site."""
        kept = reconcile([entry(hash="h1"), entry(hash="h2")], present_hashes={"h1"})
        assert [e.hash for e in kept] == ["h1"]

    def test_keeps_everything_when_all_files_present(self):
        entries = [entry(hash="h1"), entry(hash="h2")]
        assert reconcile(entries, present_hashes={"h1", "h2"}) == entries


class TestRebuild:
    def test_removing_an_override_restores_what_the_photo_said(self):
        meta = PhotoMetadata(taken_at=datetime(2026, 3, 1), lat=37.5, lon=127.0)
        overridden = build_entry(
            "h1", "IMG_1.jpg", meta, FALLBACK, Overrides(photos={"h1": {"takenAt": "1999-01-01T00:00:00"}})
        )

        restored = rebuild(overridden, Overrides())

        assert restored.taken_at == datetime(2026, 3, 1)
        assert (restored.lat, restored.lon) == (37.5, 127.0)

    def test_a_photo_with_no_exif_falls_back_to_its_original_upload_date(self):
        blank = PhotoMetadata(None, None, None)
        overridden = build_entry(
            "h1", "IMG_1.jpg", blank, FALLBACK, Overrides(photos={"h1": {"takenAt": "1999-01-01T00:00:00"}})
        )

        restored = rebuild(overridden, Overrides())

        assert restored.taken_at == FALLBACK
        assert restored.date_fallback is True


class TestSerialisation:
    def test_round_trips_through_json_shape(self):
        original = entry(lat=37.5, lon=127.0, place="Seoul", date_fallback=True)
        assert PhotoEntry.from_json(original.to_json()) == original

    def test_keeps_the_raw_exif_record_so_overrides_stay_undoable(self):
        original = entry(
            exif=PhotoMetadata(taken_at=datetime(2026, 3, 1), lat=37.5, lon=127.0),
            taken_at=datetime(1999, 1, 1),
            lat=1.0,
            lon=2.0,
        )
        assert PhotoEntry.from_json(original.to_json()).exif == original.exif

    def test_reads_a_manifest_written_before_the_raw_record_existed(self):
        legacy = {
            "hash": "h1",
            "name": "IMG_1.jpg",
            "takenAt": "2026-03-01T00:00:00",
            "dateFallback": False,
            "lat": 37.5,
            "lon": 127.0,
            "place": "Seoul",
        }
        restored = PhotoEntry.from_json(legacy)
        assert restored.exif.taken_at == datetime(2026, 3, 1)
        assert restored.uploaded_at == datetime(2026, 3, 1)

    def test_json_uses_camel_case_for_the_browser(self):
        payload = entry(taken_at=datetime(2026, 1, 2, 3, 4), date_fallback=True).to_json()
        assert payload["takenAt"] == "2026-01-02T03:04:00"
        assert payload["dateFallback"] is True


def test_sorts_newest_first():
    old = entry(hash="old", taken_at=datetime(2020, 1, 1))
    new = entry(hash="new", taken_at=datetime(2026, 1, 1))
    assert [e.hash for e in sort_newest_first([old, new])] == ["new", "old"]
