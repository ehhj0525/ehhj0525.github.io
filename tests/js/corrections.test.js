/**
 * The corrections model works on the text of overrides.json, so these tests are
 * mostly plain strings in and plain strings out — no browser and no GitHub.
 *
 * The one exception is saving, which is handed a stand-in for the GitHub client
 * that behaves the way github.js's writeFile does: read, write, and try again
 * against fresh state when the branch moves underneath it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addPlace,
  applyCorrection,
  correctionFor,
  dateIsGuessed,
  DEFAULT_RADIUS_M,
  forDateInput,
  keyFor,
  loadCorrections,
  loadRecentPhotos,
  readCorrections,
  RECENT_PHOTOS,
  savePlace,
  saveCorrection,
} from "../../corrections.js";

/** overrides.json as the pipeline and a hand-editor both write it. */
const written = (document) => JSON.stringify(document, null, 2) + "\n";

const EMPTY = written({ photos: {}, places: [] });

function refuses(call, message) {
  assert.throws(call, (error) => {
    assert.match(error.message, message);
    return true;
  });
}

describe("readCorrections", () => {
  it("reads the photos and the places", () => {
    const text = written({
      photos: { "from-kakao.jpg": { takenAt: "2025-12-25T08:00:00" } },
      places: [{ name: "할머니집", lat: 37.45, lon: 127.13, radiusM: 300 }],
    });

    const corrections = readCorrections(text);

    assert.deepEqual(corrections.photos["from-kakao.jpg"], { takenAt: "2025-12-25T08:00:00" });
    assert.equal(corrections.places[0].name, "할머니집");
  });

  it("reads a file that has never been written as no corrections at all", () => {
    assert.deepEqual(readCorrections(null), { photos: {}, places: [] });
    assert.deepEqual(readCorrections(""), { photos: {}, places: [] });
  });

  it("fills in whichever half a hand-edited file left out", () => {
    assert.deepEqual(readCorrections('{"places":[]}'), { photos: {}, places: [] });
  });

  it("says which file is unreadable rather than repeating a parser's complaint", () => {
    refuses(() => readCorrections("{ photos: }"), /overrides\.json/);
  });
});

/** Node has no DOM, so `fetch` has to be installed rather than assigned. */
function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** Install a fake `fetch` answering with `{ status, body }`, and record the requests. */
function respondWith(handler) {
  const calls = [];
  define("fetch", async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const { status = 200, body = {} } = (await handler()) ?? {};
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  return calls;
}

/** A manifest as the pipeline writes one: newest *taken* first. */
const manifestOf = (...photos) =>
  photos.map(({ name, takenAt = "2026-08-06T09:36:58", uploadedAt = takenAt }) => ({
    hash: name,
    name,
    takenAt,
    uploadedAt,
    dateFallback: false,
  }));

/** Enough photos to fill the screen, all taken recently and added long ago. */
const aScreenful = (count) =>
  Array.from({ length: count }, (_, index) => ({
    name: `${index}.jpg`,
    takenAt: `2026-08-06T09:${String(index).padStart(2, "0")}`,
    uploadedAt: "2020-01-01T00:00:00",
  }));

describe("loadRecentPhotos", () => {
  it("reads the photos the site has published, newest first as the manifest holds them", async () => {
    respondWith(() => ({ body: { photos: manifestOf({ name: "newest.jpg" }, { name: "older.jpg" }) } }));

    const photos = await loadRecentPhotos();

    assert.deepEqual(
      photos.map((photo) => photo.name),
      ["newest.jpg", "older.jpg"]
    );
  });

  it("reads no more than a screenful of them", async () => {
    respondWith(() => ({ body: { photos: manifestOf(...aScreenful(RECENT_PHOTOS + 5)) } }));

    assert.equal((await loadRecentPhotos()).length, RECENT_PHOTOS);
  });

  /*
   * An old photo uploaded today is the ordinary case for a family gallery, and
   * it is exactly the one whose place wants naming. By taken-at it sorts below
   * everything and would never be on the screen at all.
   */
  it("chooses the photos added most recently, not the ones taken most recently", async () => {
    const scanned = { name: "1998.jpg", takenAt: "1998-04-11T09:00:00", uploadedAt: "2026-08-23T10:00:00" };
    respondWith(() => ({ body: { photos: manifestOf(...aScreenful(RECENT_PHOTOS), scanned) } }));

    const names = (await loadRecentPhotos()).map((photo) => photo.name);

    assert.equal(names.length, RECENT_PHOTOS);
    assert.ok(names.includes("1998.jpg"), "the photo added today should be on the screen");
  });

  it("lists what it chose in the manifest's order, so the timeline scan still reads", async () => {
    respondWith(() => ({
      body: {
        photos: manifestOf(
          { name: "taken-later.jpg", takenAt: "2026-08-06T09:36:58", uploadedAt: "2020-01-01T00:00:00" },
          { name: "taken-earlier.jpg", takenAt: "1998-04-11T09:00:00", uploadedAt: "2026-08-23T10:00:00" }
        ),
      },
    }));

    assert.deepEqual(
      (await loadRecentPhotos()).map((photo) => photo.name),
      ["taken-later.jpg", "taken-earlier.jpg"]
    );
  });

  it("falls back to when a photo was taken, for a manifest written before uploadedAt", async () => {
    respondWith(() => ({
      body: { photos: manifestOf(...aScreenful(RECENT_PHOTOS)).map(({ uploadedAt, ...photo }) => photo) },
    }));

    assert.equal((await loadRecentPhotos()).length, RECENT_PHOTOS);
  });

  it("asks for a fresh copy, since every build rewrites the manifest", async () => {
    const calls = respondWith(() => ({ body: { photos: [] } }));

    await loadRecentPhotos();

    assert.match(calls[0].url, /^photos\.json\?/);
    assert.equal(calls[0].options.cache, "no-store");
  });

  it("comes to nothing when the manifest cannot be read", async () => {
    respondWith(() => ({ status: 404 }));
    assert.deepEqual(await loadRecentPhotos(), []);

    define("fetch", async () => {
      throw new TypeError("offline");
    });
    assert.deepEqual(await loadRecentPhotos(), []);
  });
});

describe("loadCorrections", () => {
  it("reads the file as it stands on the branch, not as the site published it", async () => {
    const read = [];
    const github = {
      readFile: async (path) => {
        read.push(path);
        return { text: '{"photos":{"a.jpg":{"place":"할머니집"}}}' };
      },
    };

    const corrections = await loadCorrections(github);

    assert.deepEqual(read, ["overrides.json"]);
    assert.deepEqual(corrections.photos["a.jpg"], { place: "할머니집" });
  });

  it("is empty when nothing has ever been corrected", async () => {
    const corrections = await loadCorrections({ readFile: async () => null });

    assert.deepEqual(corrections, { photos: {}, places: [] });
  });
});

describe("forDateInput", () => {
  it("trims a manifest date to what a date field can hold", () => {
    assert.equal(forDateInput("2026-08-06T09:36:58"), "2026-08-06T09:36");
  });

  it("leaves a date that is already the length of the field, so it survives a round trip", () => {
    assert.equal(forDateInput("2025-12-25T08:00"), "2025-12-25T08:00");
  });

  it("is empty when there is no date to show", () => {
    assert.equal(forDateInput(undefined), "");
    assert.equal(forDateInput(null), "");
  });
});

describe("correctionFor", () => {
  const corrections = readCorrections(
    written({
      photos: {
        "2b7ff5186d9620e9": { place: "by hash" },
        "from-kakao.jpg": { place: "by name" },
      },
    })
  );

  it("prefers the hash, which is the more specific of the two keys", () => {
    const photo = { hash: "2b7ff5186d9620e9", name: "from-kakao.jpg" };

    assert.deepEqual(correctionFor(corrections, photo), { place: "by hash" });
  });

  it("falls back to the filename that was uploaded", () => {
    assert.deepEqual(correctionFor(corrections, { hash: "unknown", name: "from-kakao.jpg" }), {
      place: "by name",
    });
  });

  it("is empty for a photo nobody has corrected", () => {
    assert.deepEqual(correctionFor(corrections, { hash: "unknown", name: "unknown.jpg" }), {});
  });
});

describe("keyFor", () => {
  const keyed = (...keys) => readCorrections(JSON.stringify({ photos: Object.fromEntries(keys.map((key) => [key, {}])) }));
  const photo = { hash: "2b7ff5186d9620e9", name: "from-kakao.jpg" };

  it("is the hash, which survives the file being renamed", () => {
    assert.equal(keyFor(keyed(), photo), photo.hash);
  });

  it("is the filename where a hand edit keyed it that way, so the save lands on that entry", () => {
    assert.equal(keyFor(keyed("from-kakao.jpg"), photo), "from-kakao.jpg");
  });

  it("is the hash when both are there, which is the one the pipeline obeys", () => {
    assert.equal(keyFor(keyed("2b7ff5186d9620e9", "from-kakao.jpg"), photo), photo.hash);
  });
});

describe("dateIsGuessed", () => {
  it("is what the pipeline recorded when nothing said when the photo was taken", () => {
    assert.equal(dateIsGuessed({ takenAt: "2026-08-23T10:00:00", dateFallback: true }), true);
    assert.equal(dateIsGuessed({ takenAt: "2026-08-06T09:36:58", dateFallback: false }), false);
  });

  it("is not guessed at here from the dates themselves", () => {
    const noRecord = { takenAt: "2026-08-23T10:00:00", uploadedAt: "2026-08-23T10:00:00" };

    assert.equal(dateIsGuessed(noRecord), false);
  });
});

describe("applyCorrection", () => {
  it("writes a photo that has never been corrected", () => {
    const text = applyCorrection(EMPTY, "from-kakao.jpg", {
      takenAt: "2025-12-25T08:00",
      lat: "37.5",
      lon: "127.0",
      place: "할머니집",
    });

    assert.deepEqual(readCorrections(text).photos, {
      "from-kakao.jpg": { takenAt: "2025-12-25T08:00", lat: 37.5, lon: 127.0, place: "할머니집" },
    });
  });

  it("merges with the correction already there rather than replacing it", () => {
    const before = written({ photos: { "a.jpg": { takenAt: "2025-12-25T08:00", place: "할머니집" } } });

    const after = applyCorrection(before, "a.jpg", { lat: 37.5, lon: 127.0 });

    assert.deepEqual(readCorrections(after).photos["a.jpg"], {
      takenAt: "2025-12-25T08:00",
      place: "할머니집",
      lat: 37.5,
      lon: 127.0,
    });
  });

  it("leaves every other photo's correction alone", () => {
    const before = written({ photos: { "a.jpg": { place: "할머니집" }, "b.jpg": { place: "집" } } });

    const after = applyCorrection(before, "a.jpg", { place: "바다" });

    assert.deepEqual(readCorrections(after).photos["b.jpg"], { place: "집" });
  });

  it("removes a field that has been cleared, so the photo reverts to its own metadata", () => {
    const before = written({ photos: { "a.jpg": { takenAt: "2025-12-25T08:00", place: "할머니집" } } });

    const after = applyCorrection(before, "a.jpg", { place: "" });

    assert.deepEqual(readCorrections(after).photos["a.jpg"], { takenAt: "2025-12-25T08:00" });
  });

  it("removes the photo itself once its last correction is cleared", () => {
    const before = written({ photos: { "a.jpg": { place: "할머니집" }, "b.jpg": { place: "집" } } });

    const after = applyCorrection(before, "a.jpg", { place: null });

    assert.deepEqual(Object.keys(readCorrections(after).photos), ["b.jpg"]);
    assert.equal(after.includes("null"), false);
  });

  it("touches only the fields it was given", () => {
    const before = written({ photos: { "a.jpg": { takenAt: "2025-12-25T08:00", place: "할머니집" } } });

    const after = applyCorrection(before, "a.jpg", {});

    assert.equal(after, before);
  });

  it("clears both coordinates when either one goes, since neither is any use alone", () => {
    const before = written({ photos: { "a.jpg": { lat: 37.5, lon: 127.0, place: "할머니집" } } });

    const after = applyCorrection(before, "a.jpg", { lat: "", lon: "127.0" });

    assert.deepEqual(readCorrections(after).photos["a.jpg"], { place: "할머니집" });
  });

  it("keeps hand-written keys it does not understand", () => {
    const before = written({
      photos: { "a.jpg": { place: "할머니집", note: "Grace's first birthday" } },
      places: [{ name: "집", lat: 37.5, lon: 127.0 }],
      rotate: { "a.jpg": 90 },
    });

    const after = JSON.parse(applyCorrection(before, "a.jpg", { takenAt: "2025-12-25T08:00" }));

    assert.equal(after.photos["a.jpg"].note, "Grace's first birthday");
    assert.deepEqual(after.rotate, { "a.jpg": 90 });
    assert.equal(after.places.length, 1);
  });

  it("keeps a hand-written key even when every field the screen knows is cleared", () => {
    const before = written({ photos: { "a.jpg": { place: "할머니집", note: "keep me" } } });

    const after = applyCorrection(before, "a.jpg", { place: "" });

    assert.deepEqual(readCorrections(after).photos["a.jpg"], { note: "keep me" });
  });

  it("writes the file the way the pipeline and a hand-editor write it", () => {
    const text = applyCorrection(null, "a.jpg", { place: "할머니집" });

    assert.equal(text, written({ photos: { "a.jpg": { place: "할머니집" } }, places: [] }));
  });

  it("refuses coordinates that are not numbers", () => {
    refuses(() => applyCorrection(EMPTY, "a.jpg", { lat: "north", lon: "127.0" }), /number/);
  });

  it("refuses coordinates that are off the globe", () => {
    refuses(() => applyCorrection(EMPTY, "a.jpg", { lat: 91, lon: 127.0 }), /-90 and 90/);
    refuses(() => applyCorrection(EMPTY, "a.jpg", { lat: 37.5, lon: 181 }), /-180 and 180/);
  });

  it("refuses a date the pipeline would not be able to read", () => {
    refuses(() => applyCorrection(EMPTY, "a.jpg", { takenAt: "christmas" }), /date/);
  });

  it("refuses to write over a hand edit that left the file the wrong shape", () => {
    refuses(() => applyCorrection('{"photos":[]}', "a.jpg", { place: "집" }), /"photos"/);
  });
});

describe("addPlace", () => {
  it("adds a point, a radius and a name", () => {
    const text = addPlace(EMPTY, { name: "할머니집", lat: "37.45", lon: "127.13", radiusM: "300" });

    assert.deepEqual(readCorrections(text).places, [
      { name: "할머니집", lat: 37.45, lon: 127.13, radiusM: 300 },
    ]);
  });

  it("keeps the places already named", () => {
    const before = written({ places: [{ name: "집", lat: 37.5, lon: 127.0, radiusM: 150 }] });

    const after = addPlace(before, { name: "할머니집", lat: 37.45, lon: 127.13 });

    assert.deepEqual(
      readCorrections(after).places.map((place) => place.name),
      ["집", "할머니집"]
    );
  });

  it("gives a place the same default radius the pipeline would have used", () => {
    const text = addPlace(EMPTY, { name: "할머니집", lat: 37.45, lon: 127.13 });

    assert.equal(readCorrections(text).places[0].radiusM, DEFAULT_RADIUS_M);
  });

  it("moves a place that is named again rather than naming it twice", () => {
    const before = written({ places: [{ name: "할머니집", lat: 37.45, lon: 127.13, note: "keep me" }] });

    const after = addPlace(before, { name: "할머니집", lat: 37.46, lon: 127.14, radiusM: 300 });

    assert.deepEqual(readCorrections(after).places, [
      { name: "할머니집", lat: 37.46, lon: 127.14, note: "keep me", radiusM: 300 },
    ]);
  });

  it("refuses a place with no name, which would label nothing", () => {
    refuses(() => addPlace(EMPTY, { name: "  ", lat: 37.45, lon: 127.13 }), /name/);
  });

  it("refuses a place with no point", () => {
    refuses(() => addPlace(EMPTY, { name: "할머니집", lat: "", lon: "" }), /number/);
  });

  it("refuses a radius that is not a positive number", () => {
    refuses(() => addPlace(EMPTY, { name: "집", lat: 37.45, lon: 127.13, radiusM: "-1" }), /radius/);
  });
});

/**
 * A stand-in for the GitHub client. It stores one file and moves its sha on
 * every write, exactly like the branch does, and retries a write whose sha went
 * stale — which is what github.js's writeFile does.
 */
function memoryRepo(text) {
  const stored = { text, sha: 1 };
  let interruption = null;

  return {
    text: () => stored.text,
    /** Let one other save land in the moment between this next read and its write. */
    interruptNextWriteWith(save) {
      interruption = save;
    },
    async writeFile(path, file) {
      assert.equal(path, "overrides.json");
      assert.ok(file.message, "a commit needs a message");

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const readAt = stored.sha;
        const next = typeof file.text === "function" ? file.text(stored.text) : file.text;

        if (interruption) {
          const landing = interruption;
          interruption = null;
          await landing();
        }
        if (stored.sha !== readAt) continue; // the branch moved: 409, read and try again

        stored.text = next;
        stored.sha += 1;
        return;
      }
      throw new Error("the branch will not stop moving");
    },
  };
}

describe("saving", () => {
  it("commits the corrected photo, and hands back what it committed", async () => {
    const github = memoryRepo(EMPTY);

    const committed = await saveCorrection(github, "from-kakao.jpg", { takenAt: "2025-12-25T08:00" });

    assert.deepEqual(readCorrections(github.text()).photos, {
      "from-kakao.jpg": { takenAt: "2025-12-25T08:00" },
    });
    assert.equal(committed, github.text());
  });

  it("commits the named place", async () => {
    const github = memoryRepo(EMPTY);

    const committed = await savePlace(github, { name: "할머니집", lat: 37.45, lon: 127.13 });

    assert.equal(readCorrections(github.text()).places[0].name, "할머니집");
    assert.equal(committed, github.text());
  });

  it("keeps both corrections when two saves land close together", async () => {
    const github = memoryRepo(EMPTY);
    github.interruptNextWriteWith(() => saveCorrection(github, "b.jpg", { place: "집" }));

    const committed = await saveCorrection(github, "a.jpg", { place: "할머니집" });

    assert.deepEqual(readCorrections(github.text()).photos, {
      "b.jpg": { place: "집" },
      "a.jpg": { place: "할머니집" },
    });
    // What came back is the merge that landed, not the one that lost the race —
    // the screen redraws itself from it.
    assert.equal(committed, github.text());
  });

  it("keeps a hand edit that lands while the screen is saving", async () => {
    const github = memoryRepo(EMPTY);
    github.interruptNextWriteWith(() =>
      github.writeFile("overrides.json", {
        text: written({ photos: {}, places: [], rotate: { "a.jpg": 90 } }),
        message: "hand-edited",
      })
    );

    await saveCorrection(github, "a.jpg", { place: "할머니집" });

    assert.deepEqual(JSON.parse(github.text()).rotate, { "a.jpg": 90 });
  });
});
