/**
 * An open photo is a place, and this is its address: `?photo=<hash>`.
 *
 * The convention lives here rather than in the gallery so that reading and
 * writing the address bar can be reasoned about — and tested — without a
 * browser. A query parameter rather than a fragment: GitHub Pages serves the
 * same page either way, and links pasted into chat apps survive it intact.
 */

const PARAM = "photo";

/** The photo hash the URL names, or null when it names none. */
export function photoIdFromUrl(url) {
  return new URL(url).searchParams.get(PARAM) || null;
}

/** The same URL, naming `id`. Relative, which is what the History API wants. */
export function urlForPhoto(id, currentUrl) {
  return rewrite(currentUrl, (params) => params.set(PARAM, id));
}

/** The same URL with no photo named: the timeline on its own. */
export function urlWithoutPhoto(currentUrl) {
  return rewrite(currentUrl, (params) => params.delete(PARAM));
}

/**
 * Where the photo `id` sits in `photos`, or -1 — which is also the answer for a
 * link to a photo that is no longer in the manifest.
 */
export function indexOfPhoto(photos, id) {
  return id ? photos.findIndex((photo) => photo.hash === id) : -1;
}

function rewrite(currentUrl, change) {
  const url = new URL(currentUrl);
  change(url.searchParams);
  return `${url.pathname}${url.search}${url.hash}`;
}
