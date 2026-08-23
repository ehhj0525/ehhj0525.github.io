/**
 * The notice is only ever a sentence on a page, so a sentence is what is
 * checked here: when one is due at all, and how it reads as the day nears.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DEFAULT_LANGUAGE, useLanguage } from "../../language.js";
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

  describe("in Korean", () => {
    beforeEach(() => useLanguage("ko"));
    afterEach(() => useLanguage(DEFAULT_LANGUAGE));

    it("counts the days down", () => {
      assert.equal(expiryNotice(inDays(12), NOW), "이 토큰은 12일 뒤에 만료돼요.");
    });

    it("names tomorrow and today rather than counting them", () => {
      assert.equal(expiryNotice(inDays(1), NOW), "이 토큰은 내일 만료돼요.");
      assert.equal(expiryNotice(inDays(0.2), NOW), "이 토큰은 오늘 만료돼요.");
    });

    it("still says nothing while the expiry is far off", () => {
      assert.equal(expiryNotice(inDays(120), NOW), null);
    });
  });
});
