/**
 * The address of an open photo. No browser is involved: these functions are
 * handed a URL string and hand one back, which is exactly what the gallery
 * passes to the History API.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { indexOfPhoto, photoIdFromUrl, urlForPhoto, urlWithoutPhoto } from "../../photo-url.js";

const SITE = "https://ehhj0525.github.io/";
const HASH = "2b7ff5186d9620e9";

const photos = [{ hash: "aaa" }, { hash: HASH }, { hash: "ccc" }];

describe("photoIdFromUrl", () => {
  it("reads the photo a shared link names", () => {
    assert.equal(photoIdFromUrl(`${SITE}?photo=${HASH}`), HASH);
  });

  it("names no photo for the gallery itself", () => {
    assert.equal(photoIdFromUrl(SITE), null);
    assert.equal(photoIdFromUrl(`${SITE}?photo=`), null);
  });

  it("ignores anything else the URL carries", () => {
    assert.equal(photoIdFromUrl(`${SITE}gallery/?utm_source=chat&photo=${HASH}#top`), HASH);
  });
});

describe("urlForPhoto", () => {
  it("names the photo, relative to where the site is served from", () => {
    assert.equal(urlForPhoto(HASH, `${SITE}gallery/`), `/gallery/?photo=${HASH}`);
  });

  it("replaces the photo already named, so stepping does not stack parameters", () => {
    assert.equal(urlForPhoto("ccc", `${SITE}?photo=${HASH}`), "/?photo=ccc");
  });

  it("leaves the rest of the URL alone", () => {
    assert.equal(urlForPhoto(HASH, `${SITE}?ref=chat#top`), `/?ref=chat&photo=${HASH}#top`);
  });
});

describe("urlWithoutPhoto", () => {
  it("gives back the timeline on its own", () => {
    assert.equal(urlWithoutPhoto(`${SITE}?photo=${HASH}`), "/");
    assert.equal(urlWithoutPhoto(`${SITE}gallery/?photo=${HASH}`), "/gallery/");
  });

  it("keeps every other parameter", () => {
    assert.equal(urlWithoutPhoto(`${SITE}?ref=chat&photo=${HASH}`), "/?ref=chat");
  });

  it("changes nothing when no photo is named", () => {
    assert.equal(urlWithoutPhoto(`${SITE}?ref=chat`), "/?ref=chat");
  });

  it("round-trips with urlForPhoto", () => {
    const opened = urlForPhoto(HASH, `${SITE}?ref=chat`);
    assert.equal(urlWithoutPhoto(new URL(opened, SITE).href), "/?ref=chat");
  });
});

describe("indexOfPhoto", () => {
  it("finds the photo the URL named", () => {
    assert.equal(indexOfPhoto(photos, HASH), 1);
  });

  it("finds nothing for a photo that is no longer in the manifest", () => {
    assert.equal(indexOfPhoto(photos, "deleted-long-ago"), -1);
  });

  it("finds nothing when the URL named no photo", () => {
    assert.equal(indexOfPhoto(photos, null), -1);
  });

  it("finds nothing in an empty gallery", () => {
    assert.equal(indexOfPhoto([], HASH), -1);
  });
});
