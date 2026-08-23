/**
 * What the upload page says about photos the pipeline could not read.
 *
 * A file that will not decode is set aside in photos/failed/ rather than
 * deleted, and recorded in failed.json. Nothing else says that happened — the
 * photo simply never appears in the gallery — so this is the only account of it
 * the page can give.
 *
 * It lives apart from upload.js so the reading can be tested without a browser;
 * the wording itself is in language.js.
 */

import { t } from "./language.js";

const REPORT = "failed.json";

/**
 * The photos the last build could not read, as recorded — `[]` when there is
 * nothing to report.
 *
 * The report is a positive signal only. A build with nothing wrong writes no
 * failed.json at all, so a missing file is the ordinary case and must come to
 * nothing; so must a network that is down or a file that will not parse.
 * Someone who opened this page to add photos can do nothing with the news that
 * a report failed to load.
 */
export async function loadFailures() {
  try {
    // The fresh copy is load-bearing, not tidiness: this list stops naming a
    // photo only when the pipeline rewrites the file, so a cached one would go
    // on reporting a photo the owner has already deleted — and look right.
    const response = await fetch(`${REPORT}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    const payload = await response.json();
    return payload.failed ?? [];
  } catch {
    return [];
  }
}

/** The line over the list. */
export const failureHeading = (count) => t("upload.failed.heading", { count });
