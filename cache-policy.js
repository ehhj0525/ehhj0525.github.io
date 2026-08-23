/**
 * What the service worker is allowed to keep, and what it must always ask for.
 *
 * The site is installable, which means it has to open with no network at all —
 * and the gallery is mostly photographs, which is exactly the sort of thing
 * worth keeping on the phone. But the same site is also how photos are added,
 * and everything about that is the opposite: the manifest is rewritten by every
 * build, the upload token goes to api.github.com on every commit, and a cached
 * answer to either would be a wrong page rather than a slow one.
 *
 * So there is one rule that tells the two apart: a file named after the hash of
 * its own contents can never change, and everything else can. Photos are named
 * that way by the pipeline, and a library pinned to a version is as good as
 * named that way; both are kept, in caches of their own so that a flood of
 * photographs cannot push the libraries out. Everything else is fetched, every
 * time, and a cached copy is only ever the answer when the fetch fails.
 *
 * The policy lives here, apart from sw.js, because a service worker cannot be
 * exercised without a browser and this can — and because getting it wrong is
 * the one bug in this repository that would be served to the family from their
 * own phones, with a reload no cure for it.
 */

/**
 * A photograph. Keep it, and never ask again: the name says what the contents
 * are. There is no end to these, so they are the ones that get thrown away when
 * there are too many.
 */
export const PHOTO = "photo";

/**
 * A library pinned to a version — as fixed as a photograph, and a handful of
 * files rather than years of them, so these are kept apart and never thrown
 * away. Kept with the photographs they would be the oldest thing in the cache
 * and so the first to go, which is the opposite of what is wanted: the map is
 * worth the most on the phone with no signal.
 */
export const LIBRARY = "library";

/** Ask, every time. A cached copy answers only when the network does not. */
export const FRESH = "fresh";

/** Opening the site. Offline, the page it was asking for is served from cache. */
export const PAGE = "page";

/** Not ours to touch. */
export const PASS = "pass";

/**
 * The pages and the code behind them: everything needed to open the site with no
 * network at all, fetched once when the worker installs. The photographs are not
 * in here — they are kept as they are looked at, and there is no sense in a
 * first visit downloading years of them.
 *
 * The list is checked against the repository by the tests, so a module added and
 * not named here fails there rather than quietly leaving the installed app
 * unopenable offline.
 */
export const SHELL_FILES = [
  "index.html",
  "upload.html",
  "style.css",
  "upload.css",
  "manifest.webmanifest",
  "icon.svg",
  "app.js",
  "arrival.js",
  "cache-policy.js",
  "config.js",
  "corrections.js",
  "dates.js",
  "failure-report.js",
  "github.js",
  "install-app.js",
  "language.js",
  "manifest.js",
  "map-picker.js",
  "map-point.js",
  "map-tiles.js",
  "photo-url.js",
  "qr.js",
  "sealed-token.js",
  "setup-link.js",
  "share-photo.js",
  "token-expiry.js",
  "translate-page.js",
  "upload-progress.js",
  "upload.js",
  // Not the shell, but small, and having them means a first visit followed by a
  // journey underground still shows a gallery rather than an error.
  "config.json",
  "photos.json",
];

/** web/<hash>.jpg and thumbs/<hash>.jpg — the pipeline names both by content. */
const RENDITION = /^(web|thumbs)\/[0-9a-f]+\.jpg$/;

/**
 * A library pinned to a version, as the pages load Leaflet: unpkg serves one
 * exact file for that URL forever. Kept so that the map still draws on a phone
 * with no signal, which is where a map is worth the most.
 */
const VERSIONED_LIBRARY = /^https:\/\/unpkg\.com\/[^/]+@\d[^/]*\//;

/** The site's own cache-buster, added to files a build rewrites. */
const CACHE_BUSTER = "t";

/**
 * What to do with one request. `scope` is the service worker's registration
 * scope — an absolute URL, and the only thing that says which files are this
 * site's: github.io gives every repository in an account the same origin.
 */
export function routeFor(request, scope) {
  // Anything that changes something is between the page and the server. This is
  // what keeps a commit — or the token it is made with — out of any cache.
  if ((request.method ?? "GET") !== "GET") return PASS;

  if (VERSIONED_LIBRARY.test(request.url)) return LIBRARY;

  const path = pathWithin(request.url, scope);
  if (path === null) return PASS;

  // A navigation is answered with a page whatever its address says, because the
  // address carries which photo to open and there is one document behind them all.
  if (request.mode === "navigate") return PAGE;

  return RENDITION.test(path) ? PHOTO : FRESH;
}

/**
 * The address a cached copy is filed under: the request's own, less the
 * cache-buster the site adds to every file a build rewrites. Without this the
 * copy kept while online would be filed under a timestamp that never comes
 * round again, and nothing would be found offline.
 */
export function cacheKeyFor(url) {
  const at = new URL(url);
  at.searchParams.delete(CACHE_BUSTER);
  at.hash = "";
  // Deleting the only parameter leaves a bare "?" behind, which would not match.
  return at.search === "?" ? at.href.replace(/\?$/, "") : at.href;
}

/**
 * Which page answers a navigation that could not be fetched. The upload page is
 * its own document; everything else on this site is the gallery, including the
 * address of a single photo.
 */
export function shellFor(url, scope) {
  const path = pathWithin(url, scope) ?? "";
  return path.endsWith("upload.html") ? `${scope}upload.html` : `${scope}index.html`;
}

/**
 * Where a URL sits inside the scope — "thumbs/abc.jpg", or "" for the scope
 * itself — or null when it is not inside it at all. The query and the fragment
 * are not part of it: they say which photo to open, not which file to serve.
 */
function pathWithin(url, scope) {
  const at = new URL(url);
  const root = new URL(scope);
  if (at.origin !== root.origin || !at.pathname.startsWith(root.pathname)) return null;
  return at.pathname.slice(root.pathname.length);
}
