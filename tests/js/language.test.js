/**
 * The site is read in Korean by the family it is for, and in English by anyone
 * else. What is checked here is that neither language can quietly lose a
 * sentence: the two tables have to line up key for key, every key the pages ask
 * for has to be in them, and a key that is somehow missing must still put words
 * on the screen rather than a blank.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DEFAULT_LANGUAGE, language, t, TRANSLATIONS, useLanguage } from "../../language.js";

const ROOT = new URL("../../", import.meta.url);

/** Every file the pages are made of — the source the keys are asked for from. */
const sources = (extension) =>
  readdirSync(ROOT)
    .filter((name) => name.endsWith(extension) && name !== "language.js")
    .map((name) => [name, readFileSync(new URL(name, ROOT), "utf8")]);

/** Every `t("…")` in a file. Keys are written out in full so this can find them. */
const keysAskedFor = (code) => [...code.matchAll(/\bt\("([^"]+)"/g)].map(([, key]) => key);

/** Every key the markup carries, in whichever attribute it translates. */
const keysInMarkup = (html) =>
  [...html.matchAll(/data-i18n(?:-placeholder|-label)?="([^"]+)"/g)].map(([, key]) => key);

const kindOf = (value) => (typeof value === "function" ? "function" : typeof value);

describe("the language in use", () => {
  it("is English when the setting is missing", () => {
    assert.equal(useLanguage(undefined), "en");
    assert.equal(language(), "en");
  });

  it("is English when the setting is blank", () => {
    assert.equal(useLanguage("  "), "en");
  });

  it("is English when the setting names a language the site does not have", () => {
    assert.equal(useLanguage("fr"), "en");
    assert.equal(useLanguage("constructor"), "en"); // which every object answers to
  });

  it("is Korean when the setting says so", () => {
    assert.equal(useLanguage("ko"), "ko");
  });

  it("reads a language regardless of how it is capitalised", () => {
    assert.equal(useLanguage("KO"), "ko");
  });

  it("reads a language written with its region, as a browser writes one", () => {
    assert.equal(useLanguage("ko-KR"), "ko");
  });
});

describe("what a page is told to say", () => {
  it("is the sentence in the language in use", () => {
    useLanguage("ko");
    assert.equal(t("gallery.timeline"), "타임라인");
    useLanguage("en");
    assert.equal(t("gallery.timeline"), "Timeline");
  });

  it("is filled in from what the page knows", () => {
    useLanguage("en");
    assert.equal(t("gallery.photoIn", { place: "Seoul" }), "Photo taken in Seoul");
    useLanguage("ko");
    assert.equal(t("gallery.photoIn", { place: "서울" }), "서울에서 찍은 사진");
  });

  it("is never blank, even for a key no table has heard of", () => {
    useLanguage("ko");
    const said = t("nothing.says.this");
    assert.equal(said, "nothing.says.this");
    assert.notEqual(said.trim(), "");
  });
});

describe("the two tables", () => {
  const english = Object.keys(TRANSLATIONS[DEFAULT_LANGUAGE]);

  it("have the same keys, so no sentence falls back to English unnoticed", () => {
    for (const [code, table] of Object.entries(TRANSLATIONS)) {
      assert.deepEqual(Object.keys(table).sort(), [...english].sort(), `${code} does not match English`);
    }
  });

  it("say each key the same way — a sentence with numbers in it in both, or neither", () => {
    for (const [code, table] of Object.entries(TRANSLATIONS)) {
      for (const key of english) {
        assert.equal(
          kindOf(table[key]),
          kindOf(TRANSLATIONS[DEFAULT_LANGUAGE][key]),
          `${code}'s "${key}" is not the same kind of thing as English's`
        );
      }
    }
  });

  it("hold nothing blank", () => {
    for (const [code, table] of Object.entries(TRANSLATIONS)) {
      for (const [key, said] of Object.entries(table)) {
        if (typeof said === "string") assert.notEqual(said.trim(), "", `${code}'s "${key}" is blank`);
      }
    }
  });
});

describe("the keys the site asks for", () => {
  // Loose on purpose, and only for finding a key nothing wants any more: a
  // couple of keys are held in a table of their own and asked for by way of a
  // variable, which no search for `t("…")` can see.
  const files = [...sources(".js"), ...sources(".html")];
  const mentioned = (key) => files.some(([, text]) => text.includes(`"${key}"`));

  it("are all in the tables", () => {
    for (const [name, code] of sources(".js")) {
      for (const key of keysAskedFor(code)) {
        assert.ok(key in TRANSLATIONS[DEFAULT_LANGUAGE], `${name} asks for "${key}", which no table has`);
      }
    }
  });

  it("are all in the tables when the markup asks for them", () => {
    for (const [name, html] of sources(".html")) {
      for (const key of keysInMarkup(html)) {
        assert.ok(key in TRANSLATIONS[DEFAULT_LANGUAGE], `${name} asks for "${key}", which no table has`);
      }
    }
  });

  it("name an element with nothing in it but words", () => {
    // Swapping a sentence swaps everything inside the element, so an element
    // with a link or an emphasis in it would lose it. Those sentences are built
    // out of parts by the page instead. Anything between the key and the first
    // closing tag after it is that element's contents, and a `<` in there is
    // markup this would throw away.
    for (const [name, html] of sources(".html")) {
      for (const [at, key] of [...html.matchAll(/ data-i18n="([^"]+)"/g)].map((m) => [m.index, m[1]])) {
        const contents = html.slice(at, html.indexOf("</", at));
        assert.doesNotMatch(contents, /</, `${name}'s "${key}" wraps markup, which it would lose`);
      }
    }
  });

  it("are plain sentences where the markup carries them, because that is all it can hold", () => {
    for (const [name, html] of sources(".html")) {
      for (const key of keysInMarkup(html)) {
        assert.equal(kindOf(TRANSLATIONS[DEFAULT_LANGUAGE][key]), "string", `${name}'s "${key}"`);
      }
    }
  });

  it("account for every key in the tables, so a retired sentence is not left behind", () => {
    for (const key of Object.keys(TRANSLATIONS[DEFAULT_LANGUAGE])) {
      assert.ok(mentioned(key), `nothing asks for "${key}"`);
    }
  });
});
