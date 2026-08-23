import json
from datetime import datetime
from pathlib import Path

import pytest
from PIL import Image

from grace_pipeline import manifest
from grace_pipeline.run import run

NOW = datetime(2026, 8, 13, 23, 0, 0)


@pytest.fixture
def site(tmp_path: Path) -> Path:
    (tmp_path / "photos").mkdir()
    (tmp_path / "config.json").write_text(json.dumps({"birthDate": "2025-06-01", "title": "Grace"}))
    return tmp_path


def add_photo(site: Path, name: str, *, colour="red", size=(1200, 800), taken=None, gps=None) -> Path:
    path = site / "photos" / name
    image = Image.new("RGB", size, colour)
    exif = Image.Exif()
    if taken:
        exif[0x0132] = taken
    if gps:
        lat, lon = gps
        # Assigning the GPS IFD wholesale is the form that survives Image.Exif.tobytes()
        # on every supported Pillow; mutating get_ifd() in place is silently dropped
        # before Pillow 11.
        exif[0x8825] = {
            1: "N" if lat >= 0 else "S",
            2: (abs(lat), 0.0, 0.0),
            3: "E" if lon >= 0 else "W",
            4: (abs(lon), 0.0, 0.0),
        }
    image.save(path, "JPEG", exif=exif)
    return path


def photos_in(site: Path) -> list[dict]:
    return json.loads((site / "photos.json").read_text())["photos"]


def failures_in(site: Path) -> list[dict]:
    return json.loads((site / "failed.json").read_text())["failed"]


def no_geocoding(lat, lon):
    raise AssertionError("should not have been called")


class TestProcessing:
    def test_renders_web_and_thumbnail_and_indexes_the_photo(self, site):
        add_photo(site, "IMG_1.jpg", taken="2026:03:01 09:00:00")

        run(site, fetch=lambda lat, lon: None, now=NOW)

        entry = photos_in(site)[0]
        assert entry["takenAt"] == "2026-03-01T09:00:00"
        assert entry["dateFallback"] is False
        assert (site / entry["web"]).exists()
        assert (site / entry["thumb"]).exists()

    def test_deletes_the_original_because_the_repo_is_not_an_archive(self, site):
        original = add_photo(site, "IMG_1.jpg")

        run(site, fetch=no_geocoding, now=NOW)

        assert not original.exists()

    def test_web_version_is_capped_but_small_photos_are_not_upscaled(self, site):
        add_photo(site, "big.jpg", size=(4000, 3000))
        add_photo(site, "small.jpg", size=(300, 200), colour="blue")

        run(site, fetch=no_geocoding, now=NOW)

        by_name = {entry["name"]: entry for entry in photos_in(site)}
        assert max(Image.open(site / by_name["big.jpg"]["web"]).size) == 2048
        assert Image.open(site / by_name["small.jpg"]["web"]).size == (300, 200)

    def test_a_photo_without_exif_falls_back_to_the_upload_date(self, site):
        add_photo(site, "from-kakao.jpg")

        run(site, fetch=no_geocoding, now=NOW)

        entry = photos_in(site)[0]
        assert entry["takenAt"] == NOW.isoformat()
        assert entry["dateFallback"] is True
        assert entry["lat"] is None

    def test_reads_gps_and_resolves_a_place_name(self, site):
        add_photo(site, "seoul.jpg", gps=(37.0, 127.0))

        run(site, fetch=lambda lat, lon: "Seoul", now=NOW)

        entry = photos_in(site)[0]
        assert (entry["lat"], entry["lon"]) == (37.0, 127.0)
        assert entry["place"] == "Seoul"

    def test_rotates_photos_the_camera_tagged_sideways(self, site):
        exif = Image.Exif()
        exif[0x0112] = 6  # "rotate 90 clockwise to display"
        Image.new("RGB", (1200, 800), "grey").save(site / "photos" / "sideways.jpg", "JPEG", exif=exif)

        run(site, fetch=no_geocoding, now=NOW)

        web = Image.open(site / photos_in(site)[0]["web"])
        assert web.size == (800, 1200), "the rotation should be baked into the pixels"
        assert web.getexif().get(0x0112) is None, "and the tag dropped, or browsers rotate it twice"

    def test_converts_iphone_heic_because_no_browser_can_display_it(self, site):
        pillow_heif = pytest.importorskip("pillow_heif")
        pillow_heif.register_heif_opener()
        exif = Image.Exif()
        exif[0x0132] = "2026:05:05 12:00:00"
        Image.new("RGB", (1600, 1200), "orange").save(
            site / "photos" / "IMG_9999.HEIC", "HEIF", exif=exif
        )

        run(site, fetch=no_geocoding, now=NOW)

        entry = photos_in(site)[0]
        assert entry["takenAt"] == "2026-05-05T12:00:00"
        assert Image.open(site / entry["web"]).format == "JPEG"

    def test_ignores_files_that_are_not_photos(self, site):
        (site / "photos" / "notes.txt").write_text("hello")
        (site / "photos" / ".DS_Store").write_text("junk")

        run(site, fetch=no_geocoding, now=NOW)

        assert photos_in(site) == []

    def test_a_corrupt_file_does_not_abort_the_whole_build(self, site):
        (site / "photos" / "broken.jpg").write_bytes(b"not really a jpeg")
        add_photo(site, "good.jpg")

        summary = run(site, fetch=no_geocoding, now=NOW)

        assert [entry["name"] for entry in photos_in(site)] == ["good.jpg"]
        assert summary.failed == 1

    def test_a_file_that_cannot_be_read_is_set_aside_rather_than_retried_forever(self, site):
        (site / "photos" / "broken.jpg").write_bytes(b"not really a jpeg")

        run(site, fetch=no_geocoding, now=NOW)
        second = run(site, fetch=no_geocoding, now=NOW)

        assert (site / "photos" / "failed" / "broken.jpg").exists()
        assert second.failed == 0, "the inbox should be clear on the next build"


class TestFailureReport:
    def test_records_the_name_and_the_reason_a_file_could_not_be_read(self, site):
        (site / "photos" / "broken.jpg").write_bytes(b"not really a jpeg")

        run(site, fetch=no_geocoding, now=NOW)

        record = failures_in(site)[0]
        assert record["name"] == "broken.jpg"
        assert record["reason"], "the report has to say why, not only that it happened"
        assert str(site) not in record["reason"], "the build machine's paths are nobody's business"

    def test_a_build_with_nothing_wrong_writes_no_report(self, site):
        add_photo(site, "IMG_1.jpg")

        run(site, fetch=no_geocoding, now=NOW)

        assert not (site / "failed.json").exists()

    def test_the_report_outlives_the_build_that_set_the_file_aside(self, site):
        """The file is out of the inbox by then, so nothing re-discovers the failure."""
        (site / "photos" / "broken.jpg").write_bytes(b"not really a jpeg")
        run(site, fetch=no_geocoding, now=NOW)

        run(site, fetch=no_geocoding, now=NOW)

        assert [record["name"] for record in failures_in(site)] == ["broken.jpg"]

    def test_deleting_the_set_aside_file_clears_the_report(self, site):
        """Removing the file from the repository is how the owner dismisses the report."""
        (site / "photos" / "broken.jpg").write_bytes(b"not really a jpeg")
        (site / "photos" / "also-broken.png").write_bytes(b"not really a png")
        run(site, fetch=no_geocoding, now=NOW)

        (site / "photos" / "failed" / "broken.jpg").unlink()
        run(site, fetch=no_geocoding, now=NOW)

        assert [record["name"] for record in failures_in(site)] == ["also-broken.png"]

    def test_the_report_goes_away_entirely_once_the_last_file_is_deleted(self, site):
        (site / "photos" / "broken.jpg").write_bytes(b"not really a jpeg")
        run(site, fetch=no_geocoding, now=NOW)

        (site / "photos" / "failed" / "broken.jpg").unlink()
        run(site, fetch=no_geocoding, now=NOW)

        assert not (site / "failed.json").exists()


class TestIdempotence:
    def test_the_same_photo_uploaded_twice_appears_once(self, site):
        add_photo(site, "IMG_1.jpg")
        run(site, fetch=no_geocoding, now=NOW)
        add_photo(site, "IMG_1_copy.jpg")

        summary = run(site, fetch=no_geocoding, now=NOW)

        assert len(photos_in(site)) == 1
        assert summary.duplicates == 1

    def test_rerunning_with_no_new_photos_changes_nothing(self, site):
        add_photo(site, "IMG_1.jpg")
        run(site, fetch=lambda lat, lon: None, now=NOW)
        before = (site / "photos.json").read_text()

        run(site, fetch=no_geocoding, now=datetime(2027, 1, 1))

        assert (site / "photos.json").read_text() == before

    def test_a_geocoder_outage_does_not_erase_place_names_already_published(self, site):
        def outage(lat, lon):
            raise RuntimeError("Nominatim is down")

        add_photo(site, "seoul.jpg", gps=(37.0, 127.0))
        run(site, fetch=lambda lat, lon: "Seoul", now=NOW)
        (site / "geocache.json").unlink()  # the only copy of the answer

        run(site, fetch=outage, now=NOW)

        assert photos_in(site)[0]["place"] == "Seoul"

    def test_place_names_are_not_looked_up_twice_across_builds(self, site):
        add_photo(site, "a.jpg", gps=(37.0, 127.0))
        run(site, fetch=lambda lat, lon: "Seoul", now=NOW)

        add_photo(site, "b.jpg", colour="green", gps=(37.0, 127.0))
        run(site, fetch=no_geocoding, now=NOW)

        assert {entry["place"] for entry in photos_in(site)} == {"Seoul"}


class TestRemoval:
    def test_deleting_the_web_file_removes_the_photo_from_the_site(self, site):
        add_photo(site, "IMG_1.jpg")
        run(site, fetch=no_geocoding, now=NOW)
        entry = photos_in(site)[0]

        (site / entry["web"]).unlink()
        summary = run(site, fetch=no_geocoding, now=NOW)

        assert photos_in(site) == []
        assert summary.removed == 1
        assert not (site / entry["thumb"]).exists(), "the orphaned thumbnail should be cleaned up too"


class TestOverrides:
    def test_an_override_keyed_by_filename_fixes_a_stripped_photo(self, site):
        add_photo(site, "from-kakao.jpg")
        (site / "overrides.json").write_text(
            json.dumps(
                {
                    "photos": {
                        "from-kakao.jpg": {
                            "takenAt": "2025-12-25T08:00:00",
                            "lat": 37.5,
                            "lon": 127.0,
                        }
                    }
                }
            )
        )

        run(site, fetch=lambda lat, lon: "Seoul", now=NOW)

        entry = photos_in(site)[0]
        assert entry["takenAt"] == "2025-12-25T08:00:00"
        assert entry["dateFallback"] is False
        assert entry["place"] == "Seoul"

    def test_a_named_place_beats_the_geocoder(self, site):
        add_photo(site, "grandma.jpg", gps=(37.0, 127.0))
        (site / "overrides.json").write_text(
            json.dumps({"places": [{"name": "할머니집", "lat": 37.0, "lon": 127.0, "radiusM": 300}]})
        )

        run(site, fetch=no_geocoding, now=NOW)

        assert photos_in(site)[0]["place"] == "할머니집"

    def test_naming_a_place_relabels_photos_already_published(self, site):
        """Deciding "that is Grandma's house" must fix every photo taken there, not just future ones."""
        add_photo(site, "grandma.jpg", gps=(37.0, 127.0))
        run(site, fetch=lambda lat, lon: "Bundang-gu", now=NOW)
        assert photos_in(site)[0]["place"] == "Bundang-gu"

        (site / "overrides.json").write_text(
            json.dumps({"places": [{"name": "할머니집", "lat": 37.0, "lon": 127.0, "radiusM": 300}]})
        )
        run(site, fetch=no_geocoding, now=NOW)

        assert photos_in(site)[0]["place"] == "할머니집"

    def test_deleting_an_override_reverts_to_what_the_photo_said(self, site):
        """A mistyped date must be undoable — the original file is long gone."""
        add_photo(site, "IMG_1.jpg", taken="2026:03:01 09:00:00")
        (site / "overrides.json").write_text(
            json.dumps({"photos": {"IMG_1.jpg": {"takenAt": "1999-01-01T00:00:00"}}})
        )
        run(site, fetch=no_geocoding, now=NOW)
        assert photos_in(site)[0]["takenAt"] == "1999-01-01T00:00:00"

        (site / "overrides.json").write_text(json.dumps({}))
        run(site, fetch=no_geocoding, now=NOW)

        assert photos_in(site)[0]["takenAt"] == "2026-03-01T09:00:00"

    def test_deleting_an_override_on_a_stripped_photo_restores_the_upload_date(self, site):
        add_photo(site, "from-kakao.jpg")
        (site / "overrides.json").write_text(
            json.dumps({"photos": {"from-kakao.jpg": {"takenAt": "1999-01-01T00:00:00", "lat": 1.0, "lon": 2.0}}})
        )
        run(site, fetch=lambda lat, lon: "Somewhere", now=NOW)

        (site / "overrides.json").write_text(json.dumps({}))
        run(site, fetch=no_geocoding, now=datetime(2030, 1, 1))

        entry = photos_in(site)[0]
        assert entry["takenAt"] == NOW.isoformat(), "the original upload date, not today's"
        assert entry["dateFallback"] is True
        assert entry["lat"] is None

    def test_editing_an_override_updates_an_already_published_photo(self, site):
        """Overrides must apply on re-run, not only at first import."""
        add_photo(site, "IMG_1.jpg")
        run(site, fetch=no_geocoding, now=NOW)

        (site / "overrides.json").write_text(
            json.dumps({"photos": {"IMG_1.jpg": {"takenAt": "2024-05-05T05:05:00"}}})
        )
        run(site, fetch=no_geocoding, now=NOW)

        assert photos_in(site)[0]["takenAt"] == "2024-05-05T05:05:00"


def test_manifest_is_sorted_newest_first(site):
    add_photo(site, "old.jpg", taken="2020:01:01 00:00:00")
    add_photo(site, "new.jpg", colour="green", taken="2026:01:01 00:00:00")

    run(site, fetch=no_geocoding, now=NOW)

    assert [entry["name"] for entry in photos_in(site)] == ["new.jpg", "old.jpg"]


def test_entries_survive_a_round_trip_through_the_manifest_file(site):
    add_photo(site, "IMG_1.jpg", gps=(37.0, 127.0))
    run(site, fetch=lambda lat, lon: "Seoul", now=NOW)

    entries = manifest.load(site / "photos.json")

    assert entries[0].place == "Seoul"
    assert entries[0].lat == 37.0
