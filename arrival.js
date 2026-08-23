/**
 * Waiting for uploaded photos to turn up in the gallery.
 *
 * An upload is a commit, and a commit is not a photo on a website: the pipeline
 * has to read it, and then Pages has to publish what the pipeline wrote. The
 * page used to say so and stop there — "the site rebuilds automatically in a
 * minute or two" — which left the one question that was actually being asked
 * unanswered. Did it work? The only ways to find out were to go and look, and to
 * read a build log written in English on a page meant for programmers.
 *
 * So the page waits and watches instead, by asking the published manifest
 * whether the photos are in it yet. The pipeline names each entry after the file
 * it came from, which is what makes this possible at all.
 *
 * Two things it must do besides succeed. It must stop: a phone left on this page
 * cannot poll a website for the rest of the afternoon. And it must be honest
 * about giving up — a photo can genuinely never arrive, because a photo already
 * in the gallery is deduplicated silently by the pipeline, and the file simply
 * disappears without ever becoming an entry of its own.
 *
 * Nothing here knows what a network is: the looking and the waiting are handed
 * in, so the whole of it can be tested in milliseconds.
 */

/** When to stop waiting. Long enough for a queued run and a slow publish. */
export const GIVE_UP_MS = 8 * 60_000;

/**
 * How long to wait before looking again, this far into the wait.
 *
 * Often at first, because that is when it is about to happen and when somebody
 * is still watching the screen; more slowly later, when the phone has probably
 * been put down and this is a page nobody is reading.
 */
export function nextLook(waitedMs) {
  if (waitedMs < 2 * 60_000) return 10_000;
  if (waitedMs < 5 * 60_000) return 20_000;
  return 30_000;
}

/**
 * Watch until every one of `names` is either in the gallery or reported
 * unreadable, or until it is time to give up. Answers with all three lists —
 * `arrived`, `failed` and `missing` — in the order the photos were uploaded.
 *
 * `tools` are `loadPhotos` and `loadFailures` (the published manifest and the
 * failure report), `sleep`, and three optional things: `onProgress`, called after
 * every look so the page can keep count on screen; `stopped`, asked before each
 * wait, for abandoning a watch nobody is reading any more; and `reportedBefore`,
 * the photos the failure report was already naming when this batch was sent.
 *
 * That last one matters more than it looks. The report is not a record of this
 * upload: a file the pipeline cannot read is set aside in photos/failed/ and
 * stays named for as long as it sits there, which is until somebody deletes it.
 * So the commonest recovery there is — a photo failed, upload it again — would
 * otherwise be called a failure within ten seconds, before the pipeline had so
 * much as started, and a perfectly good upload would be reported as lost.
 */
export async function watchForArrival(
  names,
  { loadPhotos, loadFailures, sleep, onProgress, stopped, reportedBefore = [] }
) {
  const waiting = new Set(names);
  const arrived = new Set();
  const failed = new Set();
  const already = new Set(reportedBefore);
  const inUploadOrder = (found) => names.filter((name) => found.has(name));

  let waited = 0;
  while (waiting.size > 0 && waited < GIVE_UP_MS && !stopped?.()) {
    const pause = nextLook(waited);
    await sleep(pause);
    waited += pause;

    for (const [name, where] of await look(waiting, already, { loadPhotos, loadFailures })) {
      waiting.delete(name);
      (where === "gallery" ? arrived : failed).add(name);
    }

    onProgress?.({
      arrived: inUploadOrder(arrived),
      failed: inUploadOrder(failed),
      missing: inUploadOrder(waiting),
    });
  }

  return {
    arrived: inUploadOrder(arrived),
    failed: inUploadOrder(failed),
    missing: inUploadOrder(waiting),
  };
}

/**
 * One look at the site: which of the photos still being waited for have turned
 * up, and where.
 *
 * A look that fails is not an answer. Pages goes on serving the old copy while
 * it publishes a new one, a phone loses its signal in a lift, and either would
 * otherwise read as "not there yet" — which is what we already believed — so
 * there is nothing to do but come back later.
 */
async function look(waiting, already, { loadPhotos, loadFailures }) {
  let published;
  let unreadable;
  try {
    [published, unreadable] = await Promise.all([loadPhotos(), loadFailures()]);
  } catch {
    return [];
  }

  const named = (records) => new Set(records.map((record) => record.name));
  const inGallery = named(published);
  // Only what the report has started saying since this batch was sent. A name it
  // was already carrying says nothing about the photo just uploaded under it.
  const unread = named(unreadable.filter((record) => !already.has(record.name)));

  return [...waiting]
    .filter((name) => inGallery.has(name) || unread.has(name))
    .map((name) => [name, inGallery.has(name) ? "gallery" : "failed"]);
}
