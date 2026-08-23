/**
 * photos.json — the published index of every photo, as the pages read it.
 *
 * (Not manifest.webmanifest, which is the home-screen app's. This is the
 * Manifest the gallery is drawn from.)
 *
 * Three screens read it now: the gallery draws it, the fix screen lists the most
 * recent of it, and the upload page watches it to see whether the photos it just
 * committed have arrived. All three want the same two things — the freshest copy
 * there is, and nothing to handle when there is no copy at all.
 *
 * A file that cannot be read is not an error to report. Before the first build
 * there is no manifest; offline there may be no answer; and in both cases the
 * honest thing for a page to show is a gallery with nothing in it yet.
 */

const MANIFEST = "photos.json";

/** Every photo the last build knew about, newest first — or none at all. */
export async function loadPhotos() {
  try {
    // GitHub Pages caches hard, and this file is rewritten by every build: a
    // photo added a minute ago has to show up now, not when a cache expires.
    const response = await fetch(`${MANIFEST}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    const payload = await response.json();
    return payload.photos ?? [];
  } catch {
    return [];
  }
}
