/**
 * Naming a place used to mean typing a latitude and a longitude into two boxes,
 * which is the least usable thing on the site: nobody knows their own
 * coordinates, and a digit typed wrong puts a photo in the sea without saying
 * anything. Now there is a map to tap instead, and this is the arithmetic behind
 * it — what a tap becomes in the corrections file, and where the map should be
 * looking when it opens, which decides whether the right place is one tap away
 * or a minute of dragging.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openingView, pointFrom, pointText, roundCoordinate } from "../../map-point.js";

const SEOUL = { lat: 37.5665, lon: 126.978 };
const GRANDMA = { name: "할머니집", lat: 37.45, lon: 127.13, radiusM: 150 };

/** The manifest as the gallery holds it: newest photo first. */
const PHOTOS = [
  { hash: "aaa", takenAt: "2026-08-20T10:12:09", lat: null, lon: null },
  { hash: "bbb", takenAt: "2026-08-09T18:27:09", lat: 37.4979, lon: 127.0276 },
  { hash: "ccc", takenAt: "2026-06-03T17:38:51", lat: 35.1796, lon: 129.0756 },
];

describe("a coordinate as the corrections file holds it", () => {
  it("is cut to about a metre, which is finer than a tap can be anyway", () => {
    // A tap hands over a double, and writing all seventeen digits of it into a
    // file a person also edits by hand is noise in every future diff.
    assert.equal(roundCoordinate(37.56653892345678), 37.56654);
  });

  it("keeps a short coordinate short rather than padding it out", () => {
    assert.equal(roundCoordinate(37.45), 37.45);
    assert.equal(roundCoordinate(127), 127);
  });

  it("reads one that arrived as text, as a field hands it over", () => {
    assert.equal(roundCoordinate("37.5665"), 37.5665);
  });

  it("is nothing at all for what is not a number", () => {
    assert.equal(roundCoordinate(""), null);
    assert.equal(roundCoordinate("  "), null);
    assert.equal(roundCoordinate("north"), null);
    assert.equal(roundCoordinate(null), null);
    assert.equal(roundCoordinate(undefined), null);
  });
});

describe("the point a pair of fields holds", () => {
  it("is the pair, read and rounded", () => {
    assert.deepEqual(pointFrom("37.56653892", "126.9779692"), { lat: 37.56654, lon: 126.97797 });
  });

  it("is nothing until both are filled in", () => {
    // The pipeline ignores a latitude with no longitude, so half a point is not
    // a point — and the map must not put a pin on one.
    assert.equal(pointFrom("37.5665", ""), null);
    assert.equal(pointFrom("", "126.978"), null);
    assert.equal(pointFrom("", ""), null);
  });

  it("is nothing for a pair that is not on the Earth", () => {
    assert.equal(pointFrom("91", "0"), null);
    assert.equal(pointFrom("0", "181"), null);
    assert.equal(pointFrom("-91", "-181"), null);
  });

  it("reads the equator and the meridian, which are numbers like any other", () => {
    assert.deepEqual(pointFrom("0", "0"), { lat: 0, lon: 0 });
  });
});

describe("a point written back into the fields", () => {
  it("is text, cut to the same precision the file keeps", () => {
    assert.deepEqual(pointText({ lat: 37.56653892, lon: 126.9779692 }), {
      lat: "37.56654",
      lon: "126.97797",
    });
  });
});

describe("where the map is looking when it opens", () => {
  it("is the point already chosen, close in, with the pin on it", () => {
    const view = openingView({ point: SEOUL, nearby: PHOTOS });

    assert.deepEqual(view.center, [SEOUL.lat, SEOUL.lon]);
    assert.equal(view.marker, true);
    assert.ok(view.zoom >= 15, "a chosen point should open close enough to see a house");
  });

  it("is where the photo itself says it was taken, when nothing has been chosen", () => {
    const photo = { lat: 37.4979, lon: 127.0276 };
    const view = openingView({ photo, nearby: PHOTOS });

    assert.deepEqual(view.center, [photo.lat, photo.lon]);
    assert.equal(view.marker, true);
  });

  it("is the first hint that knows where it is, for a photo that does not", () => {
    // The caller's order: the most recent photo that has a location is usually
    // home, or wherever the family has just been — the same part of the world as
    // the photo being fixed.
    const view = openingView({ photo: { lat: null, lon: null }, nearby: PHOTOS });

    assert.deepEqual(view.center, [37.4979, 127.0276]);
    assert.equal(view.marker, false, "a guess must not look like a decision");
  });

  it("is a place already named, when no photo has ever had a location", () => {
    const view = openingView({ nearby: [GRANDMA] });

    assert.deepEqual(view.center, [GRANDMA.lat, GRANDMA.lon]);
    assert.equal(view.marker, false);
  });

  it("is the whole world when the site knows nothing about anywhere", () => {
    const view = openingView({});

    assert.equal(view.center, null);
    assert.equal(view.marker, false);
  });

  it("opens on a guess further out than on a decision", () => {
    const chosen = openingView({ point: SEOUL });
    const guessed = openingView({ nearby: PHOTOS });

    assert.ok(guessed.zoom < chosen.zoom, "a guess should show more of the map, not less");
  });

  it("steps over a hint that was written without coordinates", () => {
    const view = openingView({ nearby: [{ name: "somewhere" }, GRANDMA] });

    assert.deepEqual(view.center, [GRANDMA.lat, GRANDMA.lon]);
  });
});
