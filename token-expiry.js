/**
 * What the upload page says about a token that is running out.
 *
 * Fine-grained tokens expire within a year, and the failure is silent: uploads
 * simply stop working one day. A month's notice is enough to make a new token
 * without ever meeting that day.
 *
 * It lives apart from upload.js so the counting down can be tested without a
 * browser; the wording itself is in language.js.
 */

import { t } from "./language.js";

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
  if (days >= 2) return t("upload.expiry.days", { days });
  return days === 1 ? t("upload.expiry.tomorrow") : t("upload.expiry.today");
}
