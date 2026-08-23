/**
 * Swapping the English out of the markup is the one part of the language that
 * touches a page, so the page is what is faked here: a handful of nodes, each
 * carrying the attribute that names the sentence it is really a copy of.
 *
 * What is worth checking is that each attribute puts its sentence where that
 * attribute means it to go — text a visitor reads, a hint inside a box, a label
 * only a screen reader ever hears — and that the page ends up declaring which
 * language it is now in, which is what decides the voice it is read aloud in.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DEFAULT_LANGUAGE, t, useLanguage } from "../../language.js";
import { em, strong, translatePage } from "../../translate-page.js";

/** Node has no DOM, so `document` has to be installed rather than assigned. */
function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const node = (attributes) => ({
  attributes,
  getAttribute(name) {
    return this.attributes[name];
  },
  setAttribute(name, value) {
    this.attributes[name] = value;
  },
});

/** A page of those nodes, found by the one attribute each selector asks for. */
function page(...nodes) {
  const documentElement = {};
  define("document", {
    documentElement,
    querySelectorAll: (selector) => nodes.filter((one) => selector.slice(1, -1) in one.attributes),
    createElement: (tag) => ({ ...node({}), tag, textContent: "" }),
  });
  return documentElement;
}

beforeEach(() => useLanguage("ko"));
afterEach(() => useLanguage(DEFAULT_LANGUAGE));

describe("saying a page in the language in use", () => {
  it("declares the language, which is what a screen reader reads it in", () => {
    const html = page();

    translatePage();

    assert.equal(html.lang, "ko");
  });

  it("declares English too, rather than leaving whatever the markup said", () => {
    useLanguage("fr"); // no such language here, so English
    const html = page();

    translatePage();

    assert.equal(html.lang, "en");
  });

  it("swaps the words of anything that names a sentence", () => {
    const tab = node({ "data-i18n": "gallery.timeline" });
    page(tab);

    translatePage();

    assert.equal(tab.textContent, "타임라인");
  });

  it("swaps the hint inside a box, which is text nobody else would reach", () => {
    const box = node({ "data-i18n-placeholder": "upload.passphrase.placeholder" });
    page(box);

    translatePage();

    assert.equal(box.placeholder, "업로드 암호");
  });

  it("swaps a label only a screen reader hears", () => {
    const close = node({ "data-i18n-label": "gallery.close" });
    page(close);

    translatePage();

    assert.equal(close.getAttribute("aria-label"), "닫기");
  });

  it("leaves alone what carries no sentence of its own", () => {
    const plain = node({ class: "drop-icon" });
    page(plain);

    translatePage();

    assert.equal(plain.textContent, undefined);
  });
});

describe("a sentence built of parts", () => {
  /** What the sentence is made of, as tag names with the plain text between. */
  const shapeOf = (parts) => parts.map((part) => (typeof part === "string" ? "…" : part.tag));

  it("marks up the part the language asks to have marked up", () => {
    page();

    const emphasised = strong("fine-grained personal access token");

    assert.equal(emphasised.tag, "strong");
    assert.equal(emphasised.textContent, "fine-grained personal access token");
  });

  it("puts the parts in the order that language puts them, which is not the same order", () => {
    const repo = { tag: "code" };
    page();

    useLanguage("en");
    const english = t("upload.token.intro", { strong, em, repo });
    useLanguage("ko");
    const korean = t("upload.token.intro", { strong, em, repo });

    // English names the token, then the permission, then the repository;
    // Korean names the repository first and the token last.
    assert.deepEqual(shapeOf(english), ["…", "strong", "…", "em", "…", "code", "…"]);
    assert.deepEqual(shapeOf(korean), ["…", "code", "…", "em", "…", "strong", "…"]);
  });
});
