/**
 * What the upload page says about a token that is running out.
 *
 * Fine-grained tokens expire within a year, and the failure is silent: uploads
 * simply stop working one day. A month's notice is enough to make a new token
 * without ever meeting that day.
 *
 * It lives apart from upload.js so the wording and the counting down can be
 * tested without a browser.
 */

const DAY = 24 * 60 * 60 * 1000;
const WARN_WITHIN_DAYS = 30;

/**
 * The line to show for a token expiring at `expiresAt`, or `null` when there is
 * nothing worth saying — the expiry is unknown, or it is still far off.
 *
 * Days are rounded down, so the notice never promises a day that is not there.
 */
export function expiryNotice(expiresAt, now = new Date()) {
  if (!expiresAt) return null;

  const days = Math.floor((expiresAt - now) / DAY);
  if (days > WARN_WITHIN_DAYS) return null;
  if (days >= 2) return `This token expires in ${days} days.`;
  return days === 1 ? "This token expires tomorrow." : "This token expires today.";
}
