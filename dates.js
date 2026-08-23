/**
 * How the gallery writes time: the heading over a month, the date under a
 * photo, and how old he was when it was taken.
 *
 * None of the three survives being translated word by word. English heads a
 * month "June 2025" and Korean "2025년 6월"; English counts an age in months
 * and years and agrees a plural with each, where Korean says 개월 and 살 and has
 * no plural to agree with. So the arithmetic is here — it is the same in every
 * language — and the wording is in language.js, where each language says it its
 * own way.
 *
 * The dates are read with `Intl` in the language the site is set to, rather
 * than in whatever language the phone happens to be in: the setting is what
 * decides how the site reads, not the visitor's browser.
 *
 * It lives apart from app.js so all of that can be tested without a browser.
 */

import { language, t } from "./language.js";

/** The heading over a month, from the "2025-06" a photo is filed under. */
export function monthHeading(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1).toLocaleDateString(language(), {
    month: "long",
    year: "numeric",
  });
}

/** The date under a photo, or nothing at all where the date will not parse. */
export function formatDate(iso) {
  const date = new Date(iso ?? NaN);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(language(), { year: "numeric", month: "long", day: "numeric" });
}

/**
 * How old the child was when the photo was taken — "3 months", "1 year 2
 * months", "1살 2개월". Returns null for photos from before they were born,
 * and when no birth date is set.
 *
 * Months are counted whole: the month only turns over on the day of the month
 * they were born, which is how a person counts a baby's age out loud.
 */
export function ageLabel(birthDate, when) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const date = new Date(when);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(date.getTime())) return null;

  let months = (date.getFullYear() - birth.getFullYear()) * 12 + (date.getMonth() - birth.getMonth());
  if (date.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return null;
  if (months === 0) return t("gallery.age.newborn");
  if (months < 24) return t("gallery.age.months", { months });

  return t("gallery.age.years", { years: Math.floor(months / 12), months: months % 12 });
}
