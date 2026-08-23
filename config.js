/**
 * config.json — the handful of settings the site is built around, read the same
 * way by both pages.
 *
 * There is no build step, so this is the one place a setting can be changed
 * without editing code: the son's name over the gallery, the birth date the age
 * badges count from, the language everything is said in, and the repository the
 * upload page writes to.
 *
 * A missing or unreadable file is not an error to report. The site is a static
 * one and the settings are conveniences: without them it still shows the photos,
 * in English, with no age badges.
 */

const SETTINGS = "config.json";

/** What the site does without a setting for it. */
const DEFAULTS = { title: "Grace", birthDate: null, language: "en" };

export async function loadConfig() {
  try {
    // GitHub Pages caches aggressively, and this file changes by hand.
    const response = await fetch(`${SETTINGS}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    return { ...DEFAULTS, ...(await response.json()) };
  } catch {
    return { ...DEFAULTS };
  }
}
