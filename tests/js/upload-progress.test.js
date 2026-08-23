/**
 * The upload page can only be exercised by hand, so what is checked here is
 * the wording it puts on screen: the count while a batch runs and the summary
 * once it stops.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { batchProgress, batchSummary } from "../../upload-progress.js";

describe("batchProgress", () => {
  it("says how many of how many are done", () => {
    assert.equal(batchProgress(3, 12), "3 of 12 photos done");
  });

  it("starts at none of the total", () => {
    assert.equal(batchProgress(0, 12), "0 of 12 photos done");
  });

  it("counts a single photo in the singular", () => {
    assert.equal(batchProgress(0, 1), "0 of 1 photo done");
  });

  it("reaches the total, which is what makes the wait predictable", () => {
    assert.equal(batchProgress(12, 12), "12 of 12 photos done");
  });
});

describe("batchSummary", () => {
  it("states both numbers when every photo was added", () => {
    assert.equal(batchSummary(12, 0), "12 photos added, none failed.");
  });

  it("states both numbers when some failed", () => {
    assert.equal(batchSummary(10, 2), "10 photos added, 2 failed.");
  });

  it("does not claim a photo was added when none was", () => {
    assert.equal(batchSummary(0, 3), "No photos added, 3 failed.");
  });

  it("counts a single added photo in the singular", () => {
    assert.equal(batchSummary(1, 1), "1 photo added, 1 failed.");
  });
});
