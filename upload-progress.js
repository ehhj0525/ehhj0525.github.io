/**
 * The wording of the upload page's progress line. Photos are committed one at a
 * time, so a phone-full of them takes minutes, and this line is what says
 * whether to keep the phone awake or put it in a pocket.
 *
 * It lives apart from upload.js so the counting can be tested without a
 * browser. How the count is worded is in language.js, where each language
 * counts photos its own way.
 */

import { t } from "./language.js";

/**
 * How far a running batch has got. A photo that failed is still done with, so
 * the count always arrives at the total rather than stalling short of it.
 */
export const batchProgress = (done, total) => t("upload.progress.running", { done, total });

/**
 * What a finished batch came to. Both numbers are always stated, so a batch
 * that quietly dropped a photo cannot read as a clean run.
 */
export const batchSummary = (added, failed) => t("upload.progress.summary", { added, failed });
