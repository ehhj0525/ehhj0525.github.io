/**
 * The notice is only ever a sentence on a page, so a sentence is what is
 * checked here: when one is due at all, and how it reads as the day nears.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { expiryNotice } from "../../token-expiry.js";

const NOW = new Date("2026-08-23T09:00:00Z");
const inDays = (days) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

describe("expiryNotice", () => {
  it("says nothing when the expiry is unknown", () => {
    assert.equal(expiryNotice(null, NOW), null);
  });

  it("says nothing while the expiry is still months off", () => {
    assert.equal(expiryNotice(inDays(120), NOW), null);
  });

  it("says nothing the day before the warning is due", () => {
    assert.equal(expiryNotice(inDays(31), NOW), null);
  });

  it("starts warning a month out", () => {
    assert.equal(expiryNotice(inDays(30), NOW), "This token expires in 30 days.");
  });

  it("counts the days down", () => {
    assert.equal(expiryNotice(inDays(12), NOW), "This token expires in 12 days.");
  });

  it("rounds down, so a day is never claimed that is not there", () => {
    assert.equal(expiryNotice(inDays(2.9), NOW), "This token expires in 2 days.");
  });

  it("names tomorrow rather than counting it", () => {
    assert.equal(expiryNotice(inDays(1), NOW), "This token expires tomorrow.");
  });

  it("names today for the last few hours", () => {
    assert.equal(expiryNotice(inDays(0.2), NOW), "This token expires today.");
  });

  it("does not count backwards past an expiry that has already gone", () => {
    assert.equal(expiryNotice(inDays(-3), NOW), "This token expires today.");
  });
});
