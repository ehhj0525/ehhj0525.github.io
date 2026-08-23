/**
 * The whole point of the setup link is where in it the token sits, so that is
 * what is checked here: written into the fragment, read back out of it, and
 * nothing anywhere a browser would put in a request.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { setupUrl, tokenFromFragment } from "../../setup-link.js";

const PAGE = "https://ehhj0525.github.io/upload.html";
const TOKEN = "github_pat_11ABCDEFG0abcdefghijKL_M3nOpQrStUvWxYz";

describe("setupUrl", () => {
  it("carries the token in the fragment, which browsers never send", () => {
    const url = new URL(setupUrl(PAGE, TOKEN));
    assert.equal(url.hash, `#token=${TOKEN}`);
    assert.equal(url.search, "");
    assert.ok(!url.pathname.includes(TOKEN));
  });

  it("opens the page it was made on, so the link needs no editing", () => {
    assert.ok(setupUrl(PAGE, TOKEN).startsWith(`${PAGE}#`));
  });

  it("replaces a fragment the page was already showing", () => {
    const url = new URL(setupUrl(`${PAGE}#anything`, TOKEN));
    assert.equal(url.hash, `#token=${TOKEN}`);
  });

  it("escapes a token, so punctuation in one cannot break the link", () => {
    const url = setupUrl(PAGE, "a token/with&punctuation=in+it");
    assert.equal(tokenFromFragment(new URL(url).hash), "a token/with&punctuation=in+it");
  });
});

describe("tokenFromFragment", () => {
  it("reads back the token a setup link carries", () => {
    assert.equal(tokenFromFragment(new URL(setupUrl(PAGE, TOKEN)).hash), TOKEN);
  });

  it("finds none on a page opened the ordinary way", () => {
    assert.equal(tokenFromFragment(""), null);
    assert.equal(tokenFromFragment("#"), null);
  });

  it("finds none in a fragment that is about something else", () => {
    assert.equal(tokenFromFragment("#gallery"), null);
  });

  it("treats an empty token as no token, rather than as one that is blank", () => {
    assert.equal(tokenFromFragment("#token="), null);
  });
});
