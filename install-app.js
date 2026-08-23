/**
 * Registering the worker that makes this an app rather than a bookmark.
 *
 * A phone offers to put a site on the home screen as an app of its own — its own
 * icon, no browser bar — only when the site can answer for itself with no
 * network, and sw.js is what does the answering. See cache-policy.js for what it
 * is allowed to keep.
 *
 * Called from both pages, and that is the point of it being here. The upload page
 * is the one a phone that adds photos actually lives on, and installing from
 * there has to work as well as installing from the gallery — a device that was
 * set up to upload and never once opened the gallery would otherwise be the one
 * device with no app on it.
 *
 * It is a module worker, which a browser too old for one refuses. That refusal is
 * nothing to report: the site then works exactly as it did before there was a
 * worker at all.
 */

export function installApp() {
  // Relative, so it registers with the scope the site is served from — the root
  // of a user site, or the subdirectory of a project page.
  navigator.serviceWorker?.register("sw.js", { type: "module" }).catch(() => {});
}
