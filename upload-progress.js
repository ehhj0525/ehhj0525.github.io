/**
 * The wording of the upload page's progress line. Photos are committed one at a
 * time, so a phone-full of them takes minutes, and this line is what says
 * whether to keep the phone awake or put it in a pocket.
 *
 * It lives apart from upload.js so the counting and the plurals can be tested
 * without a browser.
 */

const photos = (count) => `${count} photo${count === 1 ? "" : "s"}`;

/**
 * How far a running batch has got. A photo that failed is still done with, so
 * the count always arrives at the total rather than stalling short of it.
 */
export const batchProgress = (done, total) => `${done} of ${photos(total)} done`;

/**
 * What a finished batch came to. Both numbers are always stated, so a batch
 * that quietly dropped a photo cannot read as a clean run.
 */
export function batchSummary(added, failed) {
  const first = added === 0 ? "No photos added" : `${photos(added)} added`;
  return `${first}, ${failed === 0 ? "none" : failed} failed.`;
}
