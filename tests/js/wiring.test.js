/**
 * Both pages are hand-written markup that a script then reaches into by id, and
 * nothing anywhere checks that the two agree. A renamed element does not fail to
 * load: the page comes up, and one button quietly does nothing — on a phone, in
 * somebody else's hands, a week later.
 *
 * So this is the check. Every id a page's script asks for has to be in that
 * page's markup, and every element the stylesheets style by id has to be
 * somewhere too.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ROOT = new URL("../../", import.meta.url);

const read = (name) => readFileSync(new URL(name, ROOT), "utf8");

/** Every `document.getElementById("…")` in a script. */
const idsAskedFor = (code) =>
  [...code.matchAll(/getElementById\("([^"]+)"\)/g)].map(([, id]) => id);

/** Every id the markup actually carries. */
const idsInMarkup = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id));

/**
 * Every `#id` a stylesheet styles. A colour is written with a hash too, so
 * anything that is nothing but hex digits is one of those rather than an id —
 * which is also why no element here is called "fff".
 */
const idsStyled = (css) =>
  [...css.matchAll(/#([A-Za-z][\w-]*)/g)]
    .map(([, id]) => id)
    .filter((id) => !/^[0-9a-f]{3,8}$/i.test(id));

const PAGES = [
  ["index.html", "app.js"],
  ["upload.html", "upload.js"],
];

describe("what a page's script reaches for", () => {
  for (const [page, script] of PAGES) {
    it(`is all in ${page}`, () => {
      const present = idsInMarkup(read(page));
      for (const id of idsAskedFor(read(script))) {
        assert.ok(present.has(id), `${script} asks for #${id}, which ${page} does not have`);
      }
    });
  }
});

describe("what a stylesheet styles by id", () => {
  const everywhere = new Set(PAGES.flatMap(([page]) => [...idsInMarkup(read(page))]));

  // The rules in these two files are shared between the pages, so an id in
  // either may belong to either page — but it has to belong to one of them.
  for (const sheet of ["style.css", "upload.css"]) {
    it(`is on one of the pages, for ${sheet}`, () => {
      for (const id of idsStyled(read(sheet))) {
        assert.ok(everywhere.has(id), `${sheet} styles #${id}, which no page has`);
      }
    });
  }
});
