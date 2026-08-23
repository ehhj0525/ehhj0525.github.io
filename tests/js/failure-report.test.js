/**
 * The report is only ever a list on a page, so the list is what is checked
 * here — and, just as much, the times it has to come to nothing. A clean build
 * writes no failed.json at all, so a missing file is the ordinary case and not
 * an error to show anybody.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { failureHeading, loadFailures } from "../../failure-report.js";
import { DEFAULT_LANGUAGE, useLanguage } from "../../language.js";

/** Node has no DOM, so `fetch` has to be installed rather than assigned. */
function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/**
 * Install a fake `fetch`. The handler answers with `{ status, body }`, or
 * throws to stand for a network that is not there; the requests made are
 * returned for assertions.
 */
function respondWith(handler) {
  const calls = [];
  define("fetch", async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const { status = 200, body = {}, unparseable = false } = (await handler()) ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (unparseable) throw new SyntaxError("Unexpected token < in JSON");
        return body;
      },
    };
  });
  return calls;
}

const REPORT = {
  failed: [
    { name: "broken.jpg", reason: "cannot identify image file 'broken.jpg'" },
    { name: "clip.mov", reason: "cannot identify image file 'clip.mov'" },
  ],
};

describe("loadFailures", () => {
  it("reads the name and the reason of every photo that could not be read", async () => {
    respondWith(() => ({ body: REPORT }));

    assert.deepEqual(await loadFailures(), REPORT.failed);
  });

  it("reports nothing when a clean build left no report behind", async () => {
    respondWith(() => ({ status: 404 }));

    assert.deepEqual(await loadFailures(), []);
  });

  it("reports nothing when the report cannot be fetched at all", async () => {
    respondWith(() => {
      throw new TypeError("Failed to fetch");
    });

    assert.deepEqual(await loadFailures(), []);
  });

  it("reports nothing when the report is not readable", async () => {
    respondWith(() => ({ unparseable: true }));

    assert.deepEqual(await loadFailures(), []);
  });

  it("reports nothing for a report that has been emptied", async () => {
    respondWith(() => ({ body: { failed: [] } }));

    assert.deepEqual(await loadFailures(), []);
  });

  it("asks for a fresh copy, or it would name a photo that has already been deleted", async () => {
    const calls = respondWith(() => ({ body: REPORT }));

    await loadFailures();

    assert.match(calls[0].url, /^failed\.json\?t=\d+$/);
    assert.equal(calls[0].options.cache, "no-store");
  });
});

describe("failureHeading", () => {
  it("counts a single photo in the singular", () => {
    assert.equal(failureHeading(1), "1 photo could not be processed");
  });

  it("counts several in the plural", () => {
    assert.equal(failureHeading(3), "3 photos could not be processed");
  });

  describe("in Korean", () => {
    beforeEach(() => useLanguage("ko"));
    afterEach(() => useLanguage(DEFAULT_LANGUAGE));

    it("counts photos with the counter they are counted with, one or many", () => {
      assert.equal(failureHeading(1), "읽지 못한 사진 1장");
      assert.equal(failureHeading(3), "읽지 못한 사진 3장");
    });
  });
});
