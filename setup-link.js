/**
 * The link one set-up device hands to another, as a QR code for its camera.
 *
 * The token rides in the URL fragment. A browser never sends the fragment to
 * the server, so a scanned link cannot leave the token in GitHub's access log,
 * in a proxy, or in anything else along the way — only in the phone that
 * scanned it, which is the whole point.
 *
 * It lives apart from upload.js so where the token sits can be tested without
 * a browser.
 */

const TOKEN_KEY = "token";

/** The link to encode: `page`, with `token` in its fragment and nothing else. */
export function setupUrl(page, token) {
  const url = new URL(page);
  url.hash = new URLSearchParams({ [TOKEN_KEY]: token }).toString();
  return url.href;
}

/** The token a fragment carries, or `null` for a page opened without one. */
export function tokenFromFragment(hash) {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get(TOKEN_KEY);
  return token || null;
}
