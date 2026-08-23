/**
 * The service worker: what makes this a thing you install rather than a page you
 * visit.
 *
 * Two jobs, and the second is the reason for the first. A phone will only put a
 * site on the home screen as an app of its own — its own icon, no browser bar —
 * when the site can answer for itself with no network; without this file it is a
 * bookmark. And having said it can, it has to actually do it: the gallery is
 * looked at on trains and in waiting rooms, and the photographs are the one part
 * of it that never changes once written, so they are exactly what a phone should
 * be keeping.
 *
 * Which request is which is not decided here — see cache-policy.js, where it
 * can be tested without a browser. This file is only the doing of it.
 *
 * A module worker, because that is what can import the policy. It means no
 * offline gallery on a browser too old for `import` in a worker (before Safari
 * 16.4), which is a page that works exactly as it did before rather than a
 * broken one.
 */

import {
  cacheKeyFor,
  FRESH,
  LIBRARY,
  PAGE,
  PHOTO,
  routeFor,
  SHELL_FILES,
  shellFor,
} from "./cache-policy.js";

/**
 * Bump this when the shell changes shape — a page added, a module renamed.
 *
 * Two reasons, and the second is the one that bites. It is what makes an old
 * shell disappear rather than pile up; and editing this file is what tells the
 * browser there is a new worker at all. A shell list that grew while this file
 * stayed byte-for-byte identical may never be noticed, and the module added
 * would then be the one thing missing when the app is opened offline.
 *
 * Only the shell carries the version. The photographs must not: they are named
 * after their own contents and so can never be out of date, and versioning them
 * would mean that renaming a module threw away every photograph the family had
 * on their phones — the one thing here that is expensive to fetch again, in the
 * name of a staleness that cannot happen.
 */
const VERSION = "v1";

const SHELL = `grace-shell-${VERSION}`;
const PHOTOS = "grace-photos";
const LIBRARIES = "grace-libraries";

/** Everything this site is allowed to have put in the origin's cache storage. */
const OURS = [SHELL, PHOTOS, LIBRARIES];

/** Which of the origin's caches are this site's at all. See discardOldCaches. */
const OUR_PREFIX = "grace-";

/**
 * How many photographs to keep. A thumbnail is tens of kilobytes and a web
 * version a few hundred, so this is a couple of hundred megabytes at the very
 * worst and typically far less — and a phone evicts the whole lot if it needs
 * the room, which is the browser's decision to make and not this file's.
 */
const KEEP_LIMIT = 600;

self.addEventListener("install", (event) => {
  event.waitUntil(fillShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(discardOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const route = routeFor(event.request, self.registration.scope);

  // PASS, and anything this worker has no answer for, is left to the browser —
  // which includes every write to GitHub, token and all.
  if (route === PHOTO) event.respondWith(keptCopy(event.request, PHOTOS, { trimmed: true }));
  else if (route === LIBRARY) event.respondWith(keptCopy(event.request, LIBRARIES));
  else if (route === FRESH) event.respondWith(fresh(event.request));
  else if (route === PAGE) event.respondWith(page(event.request));
});

/* ------------------------------------------------------------------ install */

/**
 * Fetch the shell one file at a time rather than in one `addAll`, which fails
 * whole. photos.json does not exist until the first build has run, and a fresh
 * deployment with nothing in it yet is no reason to leave the site uninstallable.
 */
async function fillShell() {
  const cache = await caches.open(SHELL);
  await Promise.allSettled(
    SHELL_FILES.map(async (file) => {
      const url = new URL(file, self.registration.scope);
      const response = await fetch(url, { cache: "reload" });
      if (response.ok) await cache.put(url.href, response);
    })
  );
}

/**
 * Throw away a previous version's shell, and nothing else.
 *
 * Only caches this site put there: cache storage belongs to the origin, and
 * github.io gives every repository in an account the same origin — so anything
 * not named ours is another site's, and deleting it would empty a neighbour's
 * app on the way past.
 */
const discardOldCaches = async () => {
  const names = await caches.keys();
  const stale = names.filter((name) => name.startsWith(OUR_PREFIX) && !OURS.includes(name));
  await Promise.all(stale.map((name) => caches.delete(name)));
};

/* -------------------------------------------------------------- responding */

/**
 * Keeping a copy, and never at the cost of the answer.
 *
 * Nothing here is awaited by the code that answers a request. A phone with no
 * room left rejects a write to the cache, and a rejection reaching the code
 * below would turn a response fetched perfectly well into a failure — or, worse,
 * into an older copy of itself.
 */
function keep(cacheName, key, response, trimmed = false) {
  caches
    .open(cacheName)
    .then(async (cache) => {
      await cache.put(key, response);
      if (trimmed) await trim(cache);
    })
    .catch(() => {});
}

/**
 * A file named after its own contents — a photograph, or a library pinned to a
 * version. Once it is here it is right forever, so it is answered from the cache
 * without so much as asking the network.
 */
async function keptCopy(request, cacheName, { trimmed = false } = {}) {
  // Opened rather than asked through `caches.match(…, { cacheName })`, which is
  // being asked about a cache that does not exist yet on a first visit, and
  // whose answer to that has not always been the same one.
  const cache = await caches.open(cacheName);
  const held = await cache.match(request);
  if (held) return held;

  const response = await fetch(request);
  if (response.ok) keep(cacheName, request, response.clone(), trimmed);
  return response;
}

/**
 * Everything a build rewrites. Asked for every time, exactly as the pages would
 * have asked without this worker — the cached copy exists only for the times
 * there is no network to ask.
 */
async function fresh(request) {
  const key = cacheKeyFor(request.url);
  let response;
  try {
    response = await fetch(request);
  } catch (offline) {
    const held = await caches.match(key);
    if (held) return held;
    throw offline;
  }

  if (response.ok) keep(SHELL, key, response.clone());
  return response;
}

/**
 * Opening the site: the live page, or the one that was kept for this address.
 *
 * Kept under the page's own name rather than the address asked for. There is one
 * document behind every address here — `?photo=…` names which photo to open, not
 * which file to serve — so filing them separately would keep one copy of the
 * same page per link anybody had ever followed.
 */
async function page(request) {
  const shell = shellFor(request.url, self.registration.scope);

  let response;
  try {
    response = await fetch(request);
  } catch (offline) {
    const held = await caches.match(shell);
    if (held) return held;
    throw offline;
  }

  if (response.ok) keep(SHELL, shell, response.clone());
  return response;
}

/**
 * Keep the cache of photographs from growing without end. `keys()` hands them
 * back in the order they were put in, so the oldest go first — which for a
 * gallery browsed newest-first is very nearly the least likely to be wanted.
 *
 * Only the photographs are ever trimmed. The libraries are in a cache of their
 * own precisely so that this cannot reach them.
 */
async function trim(cache) {
  const keys = await cache.keys();
  for (const old of keys.slice(0, keys.length - KEEP_LIMIT)) await cache.delete(old);
}
