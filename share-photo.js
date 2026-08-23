/**
 * Sending one photo to somebody.
 *
 * Every photo already has an address of its own — that is what photo-url.js is
 * for — but the only way to pass one on was to copy it out of the address bar,
 * which on a phone is a thing nobody does. This is the button instead.
 *
 * What it tries first is the photo itself rather than a link to it: a photo sent
 * into a chat is looked at where it lands, by a grandparent who may never follow
 * a link, and the file is the thing they can then keep. Where the browser will
 * not carry a file it carries the address, which opens the gallery on that photo;
 * where there is no share sheet at all the address goes to the clipboard. The
 * point is that the button always does something.
 *
 * Everything the browser provides is passed in rather than reached for, so all
 * of that can be tested without one — see the tests for the shape of it.
 */

import { formatDate } from "./dates.js";

/** The phone took it from here; it says so itself, so there is nothing to add. */
export const SHARED = "shared";

/** No share sheet, so the address went to the clipboard. Worth saying. */
export const COPIED = "copied";

/** The sheet was opened and dismissed. A decision, not a failure. */
export const CANCELLED = "cancelled";

/** Nothing on this browser can send anything anywhere. */
export const UNAVAILABLE = "unavailable";

/** Something was there and refused. */
export const FAILED = "failed";

/**
 * The line a photo carries: where it was taken and when. Under it in the
 * gallery, and with it when it is sent — the same sentence either way, because
 * it is the same fact about the same photo.
 */
export function photoCaption(photo) {
  return [photo.place, formatDate(photo.takenAt)].filter(Boolean).join(" · ");
}

/**
 * What a shared photo should be called when it lands on somebody's phone.
 *
 * The name it was uploaded under, which is usually the camera's own and says
 * when it was taken — but always with a .jpg on the end, because a JPEG is what
 * the pipeline keeps and what is actually being sent. An iPhone photo uploaded
 * as .HEIC would otherwise arrive as a file that lies about itself, and some
 * phones simply refuse to open one of those.
 */
export function shareFileName(photo) {
  const stem = String(photo.name ?? "").replace(/\.[^.]*$/, "");
  return `${stem || photo.hash}.jpg`;
}

/**
 * Send `photo` somewhere, and say what came of it — one of the outcomes above,
 * never an exception.
 *
 * `tools` is what the browser can do: `url` and `title` for what is being sent,
 * `share` and `canShare` from `navigator`, the photo as a `file` if one is ready,
 * and `copy` for the clipboard. Any of them may be missing, and each one missing
 * simply means the next thing is tried.
 *
 * The file is handed in rather than fetched here, and nothing is awaited before
 * `share` is called. A share sheet may only be opened by a tap, and a tap that
 * has since waited on a network fetch is no longer one as far as iOS is
 * concerned: it refuses the sheet, and the photo would go to the clipboard as a
 * link on the very phones this was written for. So the fetching happens while
 * the photo is being looked at — see app.js — and by the time anybody taps, the
 * file is simply here.
 */
export async function sharePhoto(photo, { url, title, share, canShare, file, copy }) {
  if (share) {
    try {
      await share(payload(photo, { url, title, canShare, file }));
      return SHARED;
    } catch (refused) {
      // Dismissing the sheet arrives here as an error, and answering it by
      // quietly copying a link would be doing something after being told not to.
      if (refused.name === "AbortError") return CANCELLED;
    }
  }

  if (!copy) return UNAVAILABLE;
  try {
    await copy(url);
    return COPIED;
  } catch {
    return FAILED;
  }
}

/**
 * What to hand the share sheet: the photo itself where this browser will carry
 * one, and the address on its own where it will not.
 *
 * The address goes along with the file as well. A phone that shows both gives
 * the family a photo to keep and a way back to the rest of them; one that shows
 * only the file has still sent the photo, which is what the tap was for.
 */
function payload(photo, { url, title, canShare, file }) {
  const link = { title, text: photoCaption(photo), url };
  // No file where the photo could not be read — offline, most likely, or a tap
  // that came before the fetch did. The link still works.
  if (!file || !canShare) return link;

  const withFile = { files: [file], ...link };
  return canShare(withFile) ? withFile : link;
}
