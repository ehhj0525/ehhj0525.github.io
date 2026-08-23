/**
 * Sending one photo to somebody is the commonest thing anyone does with an open
 * photo, and every phone does it differently: one will hand over the file
 * itself, one only a link, and a desktop browser may have no share sheet at all.
 * What is checked here is that each of those ends in the photo being sent rather
 * than in a dead button — and that tapping "cancel" on the phone's own sheet is
 * understood as a decision rather than reported as a failure.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DEFAULT_LANGUAGE, useLanguage } from "../../language.js";
import {
  CANCELLED,
  COPIED,
  FAILED,
  photoCaption,
  SHARED,
  shareFileName,
  sharePhoto,
  UNAVAILABLE,
} from "../../share-photo.js";

const PHOTO = {
  hash: "9017b83d64b5ddd2",
  name: "20260820_101209.jpg",
  web: "web/9017b83d64b5ddd2.jpg",
  takenAt: "2026-08-20T10:12:09",
  place: "Seoul",
};

const LINK = "https://ehhj0525.github.io/?photo=9017b83d64b5ddd2";

/** A file as a phone that can share one would hand it over. */
const FILE = { name: "20260820_101209.jpg", type: "image/jpeg" };

/**
 * The browser's share sheet, in whatever state the test is about. `shares`
 * records what it was handed; `copies` what went to the clipboard.
 */
function browser({ share = true, files = true, clipboard = true, refuse = null } = {}) {
  const shares = [];
  const copies = [];

  return {
    shares,
    copies,
    tools: {
      url: LINK,
      title: "Grace",
      share:
        share &&
        (async (payload) => {
          shares.push(payload);
          if (refuse) throw refuse;
        }),
      canShare: (payload) => (files ? true : !("files" in payload)),
      file: FILE,
      copy:
        clipboard &&
        (async (text) => {
          copies.push(text);
        }),
    },
  };
}

const errorNamed = (name) => Object.assign(new Error(name), { name });

describe("the line a photo carries", () => {
  it("says where it was taken and when", () => {
    assert.equal(photoCaption(PHOTO), "Seoul · August 20, 2026");
  });

  it("says only the date for a photo with nowhere recorded", () => {
    assert.equal(photoCaption({ ...PHOTO, place: null }), "August 20, 2026");
  });

  it("says only the place when the date will not read", () => {
    assert.equal(photoCaption({ ...PHOTO, takenAt: "not a date" }), "Seoul");
  });

  it("is empty rather than punctuation when there is nothing to say", () => {
    assert.equal(photoCaption({ ...PHOTO, place: null, takenAt: null }), "");
  });

  describe("in Korean", () => {
    beforeEach(() => useLanguage("ko"));
    afterEach(() => useLanguage(DEFAULT_LANGUAGE));

    it("reads the date the way Korean writes one", () => {
      assert.equal(photoCaption({ ...PHOTO, place: "서울" }), "서울 · 2026년 8월 20일");
    });
  });
});

describe("what a shared photo is called", () => {
  it("keeps the name it was uploaded under", () => {
    assert.equal(shareFileName(PHOTO), "20260820_101209.jpg");
  });

  it("is a jpeg however the original was named, because that is what is sent", () => {
    // The pipeline keeps only a JPEG; sharing it as .HEIC would be a file that
    // lies about itself, and some phones refuse to open one.
    assert.equal(shareFileName({ ...PHOTO, name: "IMG_1234.HEIC" }), "IMG_1234.jpg");
  });

  it("falls back to the hash for a photo whose name was never recorded", () => {
    assert.equal(shareFileName({ ...PHOTO, name: "" }), "9017b83d64b5ddd2.jpg");
  });
});

describe("sharing a photo", () => {
  it("hands over the photo itself where the phone can take one", async () => {
    const { tools, shares } = browser();

    assert.equal(await sharePhoto(PHOTO, tools), SHARED);
    assert.deepEqual(shares, [{ files: [FILE], title: "Grace", text: "Seoul · August 20, 2026", url: LINK }]);
  });

  it("opens the sheet without waiting for anything first", () => {
    // A share sheet may only be opened by a tap, and iOS stops counting it as
    // one the moment anything has been awaited — so it must be opened in the
    // same breath as the tap, which is what this checks by not awaiting at all.
    const { tools, shares } = browser();

    sharePhoto(PHOTO, tools); // deliberately not awaited

    assert.equal(shares.length, 1, "the sheet was opened a turn late, and iOS would refuse it");
  });

  it("hands over the link where the phone cannot take a file", async () => {
    const { tools, shares } = browser({ files: false });

    assert.equal(await sharePhoto(PHOTO, tools), SHARED);
    assert.deepEqual(shares, [{ title: "Grace", text: "Seoul · August 20, 2026", url: LINK }]);
  });

  it("hands over the link when the photo itself could not be read", async () => {
    // Offline, or tapped before the fetch finished: the link still works, and is
    // better than a button that does nothing.
    const { tools, shares } = browser();
    tools.file = null;

    assert.equal(await sharePhoto(PHOTO, tools), SHARED);
    assert.deepEqual(shares, [{ title: "Grace", text: "Seoul · August 20, 2026", url: LINK }]);
  });

  it("says nothing happened when the sheet was dismissed", async () => {
    const { tools, copies } = browser({ refuse: errorNamed("AbortError") });

    assert.equal(await sharePhoto(PHOTO, tools), CANCELLED);
    assert.deepEqual(copies, [], "a dismissed sheet must not be answered by copying something");
  });

  it("copies the link when the sheet itself will not open", async () => {
    const { tools, copies } = browser({ refuse: errorNamed("NotAllowedError") });

    assert.equal(await sharePhoto(PHOTO, tools), COPIED);
    assert.deepEqual(copies, [LINK]);
  });

  it("copies the link on a browser with no share sheet at all", async () => {
    const { tools, copies } = browser({ share: false });

    assert.equal(await sharePhoto(PHOTO, tools), COPIED);
    assert.deepEqual(copies, [LINK]);
  });

  it("says so when there is neither a sheet nor a clipboard", async () => {
    const { tools } = browser({ share: false, clipboard: false });

    assert.equal(await sharePhoto(PHOTO, tools), UNAVAILABLE);
  });

  it("says so when the clipboard refuses too", async () => {
    const { tools } = browser({ share: false });
    tools.copy = async () => {
      throw errorNamed("NotAllowedError");
    };

    assert.equal(await sharePhoto(PHOTO, tools), FAILED);
  });
});
