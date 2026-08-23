/**
 * After an upload the photos are not in the gallery yet: a workflow has to read
 * them, and then Pages has to publish what it wrote. Until now the page said so
 * and left it there — "a minute or two" — and the only way to find out whether
 * it had worked was to go and look, or to read a build log.
 *
 * What is checked here is the waiting: that it ends as soon as the photos are
 * really there, that a photo the pipeline could not read is not waited for
 * forever, that a blip in the middle does not end it, and that it does give up —
 * a phone left on a page must not poll a website until its battery is flat.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GIVE_UP_MS, nextLook, watchForArrival } from "../../arrival.js";

const UPLOADED = ["one.jpg", "two.jpg"];

/**
 * The site as it answers over the course of a wait: `answers` is what the
 * manifest holds at each successive look, and `failures` what the failure report
 * holds. The last answer stands for every look after it.
 *
 * `events` records what happened in order, which is how "it waited before it
 * looked" and "it stopped looking" are checked at all.
 */
function site({ answers = [], failures = [] } = {}) {
  const events = [];
  let looks = 0;

  const at = (list) => list[Math.min(looks, list.length - 1)] ?? [];

  return {
    events,
    get looks() {
      return looks;
    },
    tools: {
      sleep: async (ms) => {
        events.push(`waited ${ms}`);
      },
      loadPhotos: async () => {
        const held = at(answers);
        if (held instanceof Error) throw held;
        return held.map((name) => ({ name, hash: name }));
      },
      loadFailures: async () => {
        const held = at(failures);
        events.push(`looked ${looks}`);
        looks += 1;
        return held.map((name) => ({ name, reason: "cannot identify image file" }));
      },
    },
  };
}

describe("waiting for photos to appear in the gallery", () => {
  it("does not wait at all when nothing was uploaded", async () => {
    const { tools, events } = site();

    assert.deepEqual(await watchForArrival([], tools), { arrived: [], failed: [], missing: [] });
    assert.deepEqual(events, []);
  });

  it("waits before looking, because nothing can have arrived yet", async () => {
    const { tools, events } = site({ answers: [UPLOADED] });

    await watchForArrival(UPLOADED, tools);

    assert.equal(events[0], `waited ${nextLook(0)}`);
    assert.equal(events[1], "looked 0");
  });

  it("stops as soon as every photo is really there", async () => {
    const gallery = site({ answers: [UPLOADED] });
    const outcome = await watchForArrival(UPLOADED, gallery.tools);

    assert.deepEqual(outcome, { arrived: UPLOADED, failed: [], missing: [] });
    assert.equal(gallery.looks, 1, "looked more than once at a gallery that already had them");
  });

  it("keeps waiting while only some of them are there", async () => {
    // A burst of uploads is processed in one run, but Pages publishes when it
    // publishes, and a second run can be queued behind the first.
    const { tools } = site({ answers: [[], ["one.jpg"], UPLOADED] });

    assert.deepEqual(await watchForArrival(UPLOADED, tools), {
      arrived: UPLOADED,
      failed: [],
      missing: [],
    });
  });

  it("says which photos arrived, in the order they were uploaded", async () => {
    const { tools } = site({ answers: [["two.jpg", "one.jpg"]] });

    assert.deepEqual((await watchForArrival(UPLOADED, tools)).arrived, UPLOADED);
  });

  it("does not wait for a photo the pipeline could not read", async () => {
    const { tools } = site({ answers: [["one.jpg"]], failures: [["two.jpg"]] });

    assert.deepEqual(await watchForArrival(UPLOADED, tools), {
      arrived: ["one.jpg"],
      failed: ["two.jpg"],
      missing: [],
    });
  });

  it("ignores a photo the report has been naming since before this upload", async () => {
    const { tools } = site({ answers: [UPLOADED], failures: [["something-else.jpg"]] });

    assert.deepEqual(await watchForArrival(UPLOADED, tools), {
      arrived: UPLOADED,
      failed: [],
      missing: [],
    });
  });

  it("does not call a re-upload a failure on the strength of the old one", async () => {
    // The report keeps naming a photo for as long as its file sits in
    // photos/failed/, which is until somebody deletes it. So uploading the same
    // photo again — the whole point of the report — starts with its own name
    // already in there, and looking ten seconds later proves nothing.
    const gallery = site({ answers: [[], [], UPLOADED], failures: [["two.jpg"]] });

    const outcome = await watchForArrival(UPLOADED, {
      ...gallery.tools,
      reportedBefore: ["two.jpg"],
    });

    assert.deepEqual(outcome, { arrived: UPLOADED, failed: [], missing: [] });
  });

  it("still reports a photo the report names for the first time", async () => {
    const gallery = site({ answers: [["one.jpg"]], failures: [["something-else.jpg", "two.jpg"]] });

    const outcome = await watchForArrival(UPLOADED, {
      ...gallery.tools,
      reportedBefore: ["something-else.jpg"],
    });

    assert.deepEqual(outcome, { arrived: ["one.jpg"], failed: ["two.jpg"], missing: [] });
  });

  it("stops when the page has stopped reading, rather than polling on for minutes", async () => {
    // A second batch supersedes the first; the first must not go on asking the
    // site for photos nobody is waiting to hear about.
    const gallery = site({ answers: [[]] });
    let looks = 0;

    const outcome = await watchForArrival(UPLOADED, {
      ...gallery.tools,
      loadFailures: async () => {
        looks += 1;
        return [];
      },
      stopped: () => looks >= 2,
    });

    assert.equal(looks, 2, "kept looking after it was told to stop");
    assert.deepEqual(outcome.missing, UPLOADED);
  });

  it("carries on after a look that failed, which is a blip and not an answer", async () => {
    const { tools } = site({ answers: [new Error("Failed to fetch"), UPLOADED] });

    assert.deepEqual((await watchForArrival(UPLOADED, tools)).arrived, UPLOADED);
  });

  it("gives up rather than polling a phone flat, and says what never came", async () => {
    const { tools, events } = site({ answers: [["one.jpg"]] });

    assert.deepEqual(await watchForArrival(UPLOADED, tools), {
      arrived: ["one.jpg"],
      failed: [],
      missing: ["two.jpg"],
    });

    const waited = events
      .filter((event) => event.startsWith("waited"))
      .reduce((total, event) => total + Number(event.split(" ")[1]), 0);
    assert.ok(waited >= GIVE_UP_MS, `gave up after ${waited}ms, before the deadline`);
    assert.ok(waited < GIVE_UP_MS + 60_000, `waited ${waited}ms, well past the deadline`);
  });

  it("tells the page after every look, so the count on screen moves", async () => {
    const seen = [];
    const { tools } = site({ answers: [[], ["one.jpg"], UPLOADED] });

    await watchForArrival(UPLOADED, { ...tools, onProgress: (state) => seen.push(state) });

    assert.deepEqual(
      seen.map((state) => state.arrived),
      [[], ["one.jpg"], UPLOADED]
    );
  });
});

describe("how long to wait before looking again", () => {
  it("looks often while the pipeline is likely still running", () => {
    assert.equal(nextLook(0), 10_000);
    assert.equal(nextLook(60_000), 10_000);
  });

  it("eases off once the wait is longer than the job usually takes", () => {
    assert.ok(nextLook(3 * 60_000) > nextLook(0));
    assert.ok(nextLook(6 * 60_000) >= nextLook(3 * 60_000));
  });
});
