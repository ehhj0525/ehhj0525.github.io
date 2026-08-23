/**
 * A QR code is only worth anything if a phone camera reads it, and nothing here
 * can hold up a phone. So the symbols this encoder produces are compared module
 * for module against ones an independent encoder produced for the same text —
 * if they agree, a scanner that reads one reads the other.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { qrModules, qrSvg } from "../../qr.js";
import { HELLO, SETUP_URL, V10_FULL, V1_FULL, V2_FIRST } from "./qr-golden.js";

const drawn = (modules) => modules.map((row) => [...row].map((m) => (m ? "#" : ".")).join(""));

const matches = ({ text, rows }) => assert.deepEqual(drawn(qrModules(text)), rows);

describe("qrModules", () => {
  it("encodes a short string exactly as a reference encoder does", () => {
    matches(HELLO);
  });

  it("stays on the smallest version the text fits into", () => {
    matches(V1_FULL);
    assert.equal(qrModules(V1_FULL.text).length, 21);
  });

  it("steps up a version for the byte that no longer fits", () => {
    matches(V2_FIRST);
    assert.equal(qrModules(V2_FIRST.text).length, 25);
  });

  it("encodes a setup link, token and all", () => {
    matches(SETUP_URL);
  });

  it("encodes as much as the largest version it knows holds", () => {
    matches(V10_FULL);
    assert.equal(qrModules(V10_FULL.text).length, 57);
  });

  it("says so rather than truncating when the text will not fit", () => {
    assert.throws(() => qrModules("B".repeat(214)), /too long/);
  });

  it("encodes text as UTF-8, so the bytes are what a scanner reads back", () => {
    // 한 is three bytes, so this is 42 bytes in a 14-byte version 1 symbol.
    assert.equal(qrModules("한".repeat(14)).length, 29);
  });
});

describe("qrSvg", () => {
  it("surrounds the symbol with the quiet zone a scanner needs", () => {
    const svg = qrSvg(HELLO.text);
    assert.match(svg, /viewBox="0 0 29 29"/); // 21 modules plus 4 either side
  });

  it("draws every dark module where it belongs, and nothing else", () => {
    const drawnBack = HELLO.rows.map(() => Array(HELLO.rows.length).fill("."));
    for (const [, col, row] of qrSvg(HELLO.text).matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      drawnBack[row - 4][col - 4] = "#"; // back out of the quiet zone
    }
    assert.deepEqual(
      drawnBack.map((row) => row.join("")),
      HELLO.rows
    );
  });

  it("paints a light background, so a dark page cannot swallow the code", () => {
    assert.match(qrSvg(HELLO.text), /<rect[^>]*fill="#fff"/);
  });
});
