/**
 * How the gallery writes time. The two languages do not agree about any of it:
 * a month heading turns inside out, and an age that English counts in "months"
 * and "years" — agreeing the plural as it goes — Korean says in 개월 and 살,
 * where there is no plural to agree with.
 *
 * The dates are deliberately not on a month boundary or on the birthday itself:
 * these are read with the browser's own clock, and a test that straddles
 * midnight somewhere would pass here and fail on someone else's laptop.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ageLabel, formatDate, monthHeading } from "../../dates.js";
import { useLanguage } from "../../language.js";

const BIRTH = "2025-01-20";

/** The age badge for a photo taken `months` whole months after the birth date. */
const at = (months) => {
  const month = String((months % 12) + 1).padStart(2, "0");
  const year = 2025 + Math.floor(months / 12);
  return ageLabel(BIRTH, `${year}-${month}-25`);
};

describe("a month heading", () => {
  it("names the month and then the year in English", () => {
    useLanguage("en");
    assert.equal(monthHeading("2025-06"), "June 2025");
  });

  it("counts down from the year in Korean, which is how Korean writes a date", () => {
    useLanguage("ko");
    assert.equal(monthHeading("2025-06"), "2025년 6월");
  });
});

describe("a photo's date", () => {
  it("is written the English way", () => {
    useLanguage("en");
    assert.equal(formatDate("2025-06-14T12:00:00"), "June 14, 2025");
  });

  it("is written the Korean way", () => {
    useLanguage("ko");
    assert.equal(formatDate("2025-06-14T12:00:00"), "2025년 6월 14일");
  });

  it("is nothing at all when there is no reading it, in either language", () => {
    for (const code of ["en", "ko"]) {
      useLanguage(code);
      assert.equal(formatDate("not a date"), "");
      assert.equal(formatDate(null), "");
    }
  });
});

describe("an age badge", () => {
  it("is not shown at all when no birth date is set", () => {
    useLanguage("en");
    assert.equal(ageLabel(null, "2025-06-15"), null);
    assert.equal(ageLabel("", "2025-06-15"), null);
  });

  it("is not shown for a photo from before he was born", () => {
    useLanguage("en");
    assert.equal(ageLabel(BIRTH, "2024-11-15"), null);
  });

  it("is not shown when either date makes no sense", () => {
    useLanguage("en");
    assert.equal(ageLabel("whenever", "2025-06-15"), null);
    assert.equal(ageLabel(BIRTH, "whenever"), null);
  });

  describe("in English", () => {
    it("names the first month rather than counting it", () => {
      useLanguage("en");
      assert.equal(at(0), "newborn");
    });

    it("agrees the plural with the count", () => {
      useLanguage("en");
      assert.equal(at(1), "1 month");
      assert.equal(at(3), "3 months");
    });

    it("goes on counting months to the end of the second year", () => {
      useLanguage("en");
      assert.equal(at(12), "12 months");
      assert.equal(at(23), "23 months");
    });

    it("turns to years, agreeing that plural too", () => {
      useLanguage("en");
      assert.equal(at(24), "2 years");
      assert.equal(at(36), "3 years");
    });

    it("says the months left over after the years", () => {
      useLanguage("en");
      assert.equal(at(25), "2 years 1 month");
      assert.equal(at(26), "2 years 2 months");
    });
  });

  describe("in Korean", () => {
    it("names the first month rather than counting it", () => {
      useLanguage("ko");
      assert.equal(at(0), "신생아");
    });

    it("counts months in 개월, with no plural to agree", () => {
      useLanguage("ko");
      assert.equal(at(1), "1개월");
      assert.equal(at(3), "3개월");
      assert.equal(at(23), "23개월");
    });

    it("counts years in 살", () => {
      useLanguage("ko");
      assert.equal(at(24), "2살");
      assert.equal(at(36), "3살");
    });

    it("says the months left over after the years", () => {
      useLanguage("ko");
      assert.equal(at(25), "2살 1개월");
      assert.equal(at(26), "2살 2개월");
    });
  });
});
