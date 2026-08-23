/**
 * A service worker sits in front of every request the site makes, so a mistake
 * here is not a slow page but a wrong one: a stale manifest that hides a photo
 * uploaded a minute ago, or — worse — a cached answer to a request that carried
 * the upload token. What is checked here is which of those two things each kind
 * of request is: content named by its own hash, which can be kept for good, and
 * everything else, which has to be asked for again.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheKeyFor, FRESH, LIBRARY, PAGE, PASS, PHOTO, routeFor, shellFor } from "../../cache-policy.js";

const SCOPE = "https://ehhj0525.github.io/";

/** A request as the service worker is handed one, with the parts it looks at. */
const asked = (url, { method = "GET", mode = "no-cors" } = {}) => ({ url, method, mode });

const routeOf = (url, options) => routeFor(asked(url, options), SCOPE);

describe("what to do with a request", () => {
  it("keeps a photo for good, because its name is its content", () => {
    assert.equal(routeOf(`${SCOPE}web/9017b83d64b5ddd2.jpg`), PHOTO);
    assert.equal(routeOf(`${SCOPE}thumbs/9017b83d64b5ddd2.jpg`), PHOTO);
  });

  it("keeps a versioned library too, but apart from the photos", () => {
    // Kept together, the libraries would be the oldest entries in the cache and
    // so the first thrown away — leaving no map on the phone with no signal.
    assert.equal(routeOf("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"), LIBRARY);
    assert.equal(routeOf("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"), LIBRARY);
  });

  it("asks again for the manifest, which every upload rewrites", () => {
    assert.equal(routeOf(`${SCOPE}photos.json?t=1756000000000`), FRESH);
    assert.equal(routeOf(`${SCOPE}failed.json?t=1756000000000`), FRESH);
    assert.equal(routeOf(`${SCOPE}config.json`), FRESH);
  });

  it("asks again for the page's own code, so a fix is never held back", () => {
    assert.equal(routeOf(`${SCOPE}app.js`), FRESH);
    assert.equal(routeOf(`${SCOPE}style.css`), FRESH);
    assert.equal(routeOf(`${SCOPE}manifest.webmanifest`), FRESH);
  });

  it("treats opening the site as opening a page, whatever it asks for", () => {
    assert.equal(routeOf(SCOPE, { mode: "navigate" }), PAGE);
    assert.equal(routeOf(`${SCOPE}?photo=9017b83d64b5ddd2`, { mode: "navigate" }), PAGE);
    assert.equal(routeOf(`${SCOPE}upload.html?fix`, { mode: "navigate" }), PAGE);
  });

  it("stays out of the way of GitHub, which is where the token goes", () => {
    assert.equal(routeOf("https://api.github.com/user"), PASS);
    assert.equal(routeOf("https://api.github.com/repos/ehhj0525/ehhj0525.github.io/contents/photos"), PASS);
  });

  it("stays out of the way of anything that is not a plain read", () => {
    assert.equal(routeOf(`${SCOPE}photos.json`, { method: "POST" }), PASS);
    assert.equal(routeOf(`${SCOPE}web/9017b83d64b5ddd2.jpg`, { method: "PUT" }), PASS);
  });

  it("stays out of the way of map tiles, which are somebody else's to serve", () => {
    assert.equal(routeOf("https://a.tile.openstreetmap.org/12/3500/1600.png"), PASS);
  });

  it("stays out of the way of another site entirely", () => {
    assert.equal(routeOf("https://example.com/app.js"), PASS);
  });

  describe("served from a subdirectory, as a project page is", () => {
    const project = "https://ehhj0525.github.io/grace/";
    const inProject = (url, options) => routeFor(asked(url, options), project);

    it("reads the site's own files relative to it", () => {
      assert.equal(inProject(`${project}thumbs/abc123.jpg`), PHOTO);
      assert.equal(inProject(`${project}photos.json?t=1`), FRESH);
      assert.equal(inProject(project, { mode: "navigate" }), PAGE);
    });

    it("stays out of the way of the account's other sites, which share its host", () => {
      // github.io gives every repository in an account the same origin, so
      // being on it is not enough to be part of this site.
      assert.equal(inProject("https://ehhj0525.github.io/other-project/app.js"), PASS);
      assert.equal(inProject("https://ehhj0525.github.io/index.html"), PASS);
    });
  });
});

describe("what a cached copy is filed under", () => {
  it("drops the cache-buster, or nothing found offline would ever match", () => {
    assert.equal(cacheKeyFor(`${SCOPE}photos.json?t=1756000000000`), `${SCOPE}photos.json`);
  });

  it("leaves a request that carries no cache-buster alone", () => {
    assert.equal(cacheKeyFor(`${SCOPE}app.js`), `${SCOPE}app.js`);
  });

  it("keeps every other parameter, which may be what is being asked for", () => {
    assert.equal(
      cacheKeyFor(`${SCOPE}thing?size=large&t=1756000000000`),
      `${SCOPE}thing?size=large`
    );
  });

  it("drops the fragment, which never reaches a server anyway", () => {
    assert.equal(cacheKeyFor(`${SCOPE}upload.html#token=secret`), `${SCOPE}upload.html`);
  });
});

describe("the page a navigation falls back to offline", () => {
  it("is the gallery for the site's own address", () => {
    assert.equal(shellFor(SCOPE, SCOPE), `${SCOPE}index.html`);
    assert.equal(shellFor(`${SCOPE}?photo=9017b83d64b5ddd2`, SCOPE), `${SCOPE}index.html`);
  });

  it("is the upload page for the upload page, whatever it was asked for", () => {
    assert.equal(shellFor(`${SCOPE}upload.html`, SCOPE), `${SCOPE}upload.html`);
    assert.equal(shellFor(`${SCOPE}upload.html?fix`, SCOPE), `${SCOPE}upload.html`);
  });

  it("is the gallery for anything else, which is the only page there is", () => {
    assert.equal(shellFor(`${SCOPE}nothing/here`, SCOPE), `${SCOPE}index.html`);
  });
});
