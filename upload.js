/**
 * The upload page: pick photos on a phone, commit them straight into photos/
 * via the GitHub Contents API. The pipeline does the rest on the next push.
 *
 * Everything about talking to GitHub — the repository, the token, the commits —
 * lives in github.js; this file is only the page around it.
 */

import { watchForArrival } from "./arrival.js";
import { loadConfig } from "./config.js";
import {
  correctionFor,
  dateIsGuessed,
  DEFAULT_RADIUS_M,
  forDateInput,
  keyFor,
  loadCorrections,
  loadRecentPhotos,
  readCorrections,
  saveCorrection,
  savePlace,
} from "./corrections.js";
import { failureHeading, loadFailures } from "./failure-report.js";
import { createClient, detectRepo, encodeBase64 } from "./github.js";
import { installApp } from "./install-app.js";
import { t, useLanguage } from "./language.js";
import { loadPhotos } from "./manifest.js";
import { createPicker } from "./map-picker.js";
import { openingView, pointFrom, pointText } from "./map-point.js";
import { qrSvg } from "./qr.js";
import { loadSealedToken, unseal } from "./sealed-token.js";
import { setupUrl, tokenFromFragment } from "./setup-link.js";
import { expiryNotice } from "./token-expiry.js";
import { em, strong, translatePage } from "./translate-page.js";
import { batchProgress, batchSummary } from "./upload-progress.js";

const MAX_BYTES = 40 * 1024 * 1024; // the Contents API gets unhappy well before this
const NAME_ATTEMPTS = 5; // how many numbered variants to try before giving up on a filename

// Several browsers report an empty type for .heic — the iPhone default — so the
// filename has to be trusted when the MIME type says nothing.
const PHOTO_EXTENSION = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;

const looksLikePhoto = (file) => file.type.startsWith("image/") || PHOTO_EXTENSION.test(file.name);

const el = {
  setup: document.getElementById("setup"),
  picker: document.getElementById("picker"),
  tokenForm: document.getElementById("token-form"),
  tokenInput: document.getElementById("token-input"),
  tokenLink: document.getElementById("token-link"),
  setupError: document.getElementById("setup-error"),
  passphrase: document.getElementById("passphrase"),
  passphraseForm: document.getElementById("passphrase-form"),
  passphraseInput: document.getElementById("passphrase-input"),
  passphraseButton: document.getElementById("passphrase-button"),
  tokenIntro: document.getElementById("token-intro"),
  tokenGotchas: document.getElementById("token-gotchas"),
  repoName: document.getElementById("repo-name"),
  expiry: document.getElementById("expiry"),
  expiryText: document.getElementById("expiry-text"),
  failed: document.getElementById("failed"),
  failedHeading: document.getElementById("failed-heading"),
  failedList: document.getElementById("failed-list"),
  failedKept: document.getElementById("failed-kept"),
  failedLink: document.getElementById("failed-link"),
  drop: document.getElementById("drop"),
  fileInput: document.getElementById("file-input"),
  progress: document.getElementById("progress"),
  queue: document.getElementById("queue"),
  doneNote: document.getElementById("done-note"),
  actionsLink: document.getElementById("actions-link"),
  arrival: document.getElementById("arrival"),
  showCode: document.getElementById("show-code"),
  handOff: document.getElementById("hand-off"),
  setupCode: document.getElementById("setup-code"),
  hideCode: document.getElementById("hide-code"),
  forget: document.getElementById("forget"),
  toFix: document.getElementById("to-fix"),
  fix: document.getElementById("fix"),
  fixBack: document.getElementById("fix-back"),
  fixList: document.getElementById("fix-list"),
  fixState: document.getElementById("fix-state"),
  place: document.getElementById("place"),
  placeMap: document.getElementById("place-map"),
  placeLocate: document.getElementById("place-locate"),
  placeLocateState: document.getElementById("place-locate-state"),
  placeForm: document.getElementById("place-form"),
  placeName: document.getElementById("place-name"),
  placeLat: document.getElementById("place-lat"),
  placeLon: document.getElementById("place-lon"),
  placeRadius: document.getElementById("place-radius"),
  placeSave: document.getElementById("place-save"),
  placeState: document.getElementById("place-state"),
  placeNamed: document.getElementById("place-named"),
};

let github;

/**
 * Commit one photo, and hand back the name it was committed under.
 *
 * Two uploads before the pipeline runs can collide on a filename, so a taken
 * name gets a numbered variant rather than an error — which is exactly why the
 * name has to come back from here: it is what the manifest will call the photo,
 * and so what the page watches the gallery for afterwards.
 */
async function commitPhoto(file, content) {
  const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : "";

  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    const name = attempt === 0 ? safeName : `${stem}-${attempt}${extension}`;
    try {
      await github.createFile(`photos/${name}`, { content, message: `photo: add ${name}` });
      return name;
    } catch (error) {
      const nameTaken = error.status === 422 || error.status === 409;
      if (!nameTaken || attempt === NAME_ATTEMPTS - 1) throw error;
    }
  }
}

/* ------------------------------------------------------------------ queue */

function queueRow(file) {
  const row = document.createElement("li");

  const preview = document.createElement("img");
  preview.className = "preview";
  preview.alt = "";
  const objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;
  preview.addEventListener("load", () => URL.revokeObjectURL(objectUrl));
  // HEIC has no browser preview; an empty box is fine.
  preview.addEventListener("error", () => URL.revokeObjectURL(objectUrl));

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = file.name;

  const state = document.createElement("span");
  state.className = "state";
  state.textContent = t("upload.queue.waiting");

  row.append(preview, name, state);
  el.queue.append(row);

  return {
    set(text, status) {
      state.textContent = text;
      if (status) row.classList.add(status);
    },
  };
}

/**
 * Uploads run one at a time on purpose: each commit moves the branch head, and
 * parallel commits to the same branch reject each other.
 */
async function upload(files) {
  el.doneNote.hidden = true;
  el.arrival.hidden = true;

  // Asked before anything is committed, and read after: what the failure report
  // was already saying is not news about this batch. Uploading a photo again is
  // how a failed one is retried, so its name is very often in there already.
  const reportedBefore = loadFailures();

  const rows = [...files].map((file) => [file, queueRow(file)]);
  const committed = [];
  let done = 0;
  const showCount = () => {
    el.progress.textContent = batchProgress(done, rows.length);
  };

  // A second batch starts its own count rather than carrying on the last one.
  el.progress.hidden = false;
  showCount();

  for (const [file, row] of rows) {
    try {
      if (!looksLikePhoto(file)) throw new Error(t("upload.queue.notPhoto"));
      if (file.size > MAX_BYTES) throw new Error(t("upload.queue.tooLarge"));
      row.set(t("upload.queue.uploading"));
      committed.push(await commitPhoto(file, encodeBase64(await file.arrayBuffer())));
      row.set(t("upload.queue.added"), "done");
    } catch (error) {
      row.set(error.message, "failed");
    }
    // Outside the catch: a photo that failed is one fewer left to wait for.
    done += 1;
    showCount();
  }

  el.progress.textContent = batchSummary(committed.length, rows.length - committed.length);
  if (committed.length > 0) {
    el.doneNote.hidden = false;
    // Nothing waits on this: it takes minutes.
    watchTheGallery(committed, (await reportedBefore).map((record) => record.name));
  }
}

/* -------------------------------------------------------- did they arrive? */

/**
 * Watch the gallery until the photos just committed are really in it.
 *
 * A commit is not a photo on a website — a workflow has to read it and Pages has
 * to publish the result — and until now the page said as much and stopped there,
 * leaving the only question anybody actually has ("did it work?") to be answered
 * by going and looking, or by reading a build log written for programmers.
 *
 * Which photos to watch for is the batch's committed filenames: the pipeline
 * names each manifest entry after the file it came from. The waiting itself is
 * in arrival.js, where it is tested.
 */
let watching = 0;

async function watchTheGallery(names, reportedBefore) {
  // A second batch supersedes the first: two watches writing to one line would
  // each undo the other's count. The old one is abandoned rather than merely
  // silenced, or it would go on asking the site for photos for eight minutes
  // after anybody stopped caring about them.
  const mine = (watching += 1);
  const stale = () => mine !== watching;

  const say = (...parts) => {
    if (stale()) return;
    el.arrival.replaceChildren(...parts);
    el.arrival.hidden = false;
  };

  say(t("upload.arrival.watching", { done: 0, total: names.length }));

  const outcome = await watchForArrival(names, {
    loadPhotos,
    loadFailures,
    reportedBefore,
    stopped: stale,
    sleep: (ms) => new Promise((resume) => setTimeout(resume, ms)),
    onProgress: ({ arrived }) =>
      say(t("upload.arrival.watching", { done: arrived.length, total: names.length })),
  });
  if (stale()) return;

  // A photo the pipeline could not read is now named in the report, which is
  // where the reason for it is.
  if (outcome.failed.length > 0) showFailures();

  // Both halves of a partly-arrived batch, because both are news: a batch with
  // one duplicate in it is the ordinary case, and being told only about the one
  // that never appeared reads as though none of them did.
  const said = [];
  if (outcome.arrived.length > 0) {
    said.push(...t("upload.arrival.arrived", { count: outcome.arrived.length, link: galleryLink() }));
  }
  if (outcome.missing.length > 0) {
    if (said.length > 0) said.push(" ");
    said.push(...t("upload.arrival.slow", { count: outcome.missing.length, link: actionsLink() }));
  } else {
    // Nothing is still coming, so the sentence about waiting has nothing to say.
    el.doneNote.hidden = true;
  }

  if (said.length > 0) say(...said);
  else el.arrival.hidden = true; // every one of them failed, and the report says so
}

/** Where the workflow's own account of the build is. */
const actionsUrl = () => `https://github.com/${github.repo.owner}/${github.repo.name}/actions`;

/**
 * A link of its own each time. The nodes handed to a sentence become part of it,
 * so passing the note's own link would move it out of the note.
 */
function link(href, text, away = false) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = text;
  if (away) {
    anchor.target = "_blank";
    anchor.rel = "noopener";
  }
  return anchor;
}

const actionsLink = () => link(actionsUrl(), t("upload.done.link"), true);

// Not in a new tab: this one has done its job, and the gallery is where the
// photos are.
const galleryLink = () => link("./", t("upload.arrival.link"));

/* --------------------------------------------------------- failure report */

function failureRow({ name, reason }) {
  const row = document.createElement("li");

  const photo = document.createElement("span");
  photo.className = "name";
  photo.textContent = name;

  const why = document.createElement("span");
  why.className = "reason";
  why.textContent = reason;

  row.append(photo, why);
  return row;
}

/**
 * Report the photos the pipeline could not read, if there are any.
 *
 * Shown whenever the picker is, rather than after a batch: the pipeline runs a
 * minute or two behind the upload, so by the time a photo has failed the batch
 * that carried it is over and this page is usually closed. Waiting for a batch
 * to end would show the report to nobody, and hide it from someone who came
 * here to find out where their photo went.
 */
async function showFailures() {
  const records = await loadFailures();
  el.failed.hidden = records.length === 0;
  if (records.length === 0) return;

  el.failedHeading.textContent = failureHeading(records.length);
  el.failedList.replaceChildren(...records.map(failureRow));
  // Deleting the file is what clears the report, so the way to it is part of it.
  const { owner, name, branch } = github.repo;
  el.failedLink.href = `https://github.com/${owner}/${name}/tree/${branch}/photos/failed`;
}

/* ------------------------------------------------------------ fix a photo */

/**
 * The corrections as they stand on the branch, held while the screen is open:
 * a row needs to know what is already set, and a save needs to know which key
 * it is set under. Every save hands back the file it committed, which replaces
 * this — so what is here is what landed, not what was asked for.
 */
let corrections = { photos: {}, places: [] };

// popstate arrives a beat after history.back(), so without this a second tap on
// the way out would go back twice and leave the page.
let leavingFix = false;

/**
 * The photos the fix screen is showing. Held because the maps below open on the
 * best guess the site can make, and the most recent photo that knows where it
 * was is the best guess there is.
 */
let shownPhotos = [];

/** A labelled field: what the correction says, over a hint of what the photo says. */
function fixField(label, value, { hint = "", type = "text" } = {}) {
  const field = document.createElement("label");
  field.append(label);

  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";
  input.placeholder = hint;
  input.spellcheck = false;

  field.append(input);
  return { field, input };
}

/**
 * One photo: shut, what the timeline shows; open, the four things a correction
 * can say about it.
 *
 * A field holds a value only where there is a correction — what the photo
 * itself recorded is the hint behind it. Filling the fields in from the photo
 * would turn opening a row into a correction that pins those values for good,
 * and would leave emptying a field meaning nothing.
 */
function fixRow(photo) {
  const correction = correctionFor(corrections, photo);
  const exif = photo.exif ?? {};

  const preview = document.createElement("img");
  preview.className = "preview";
  preview.src = photo.thumb;
  preview.alt = "";
  preview.loading = "lazy";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = photo.name;

  // The date written the way the field below writes it, rather than the way the
  // gallery says it: here it is there to be compared with what is about to be
  // typed in.
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = forDateInput(photo.takenAt).replace("T", " ");

  const summary = document.createElement("summary");
  summary.append(preview, name, when);

  if (dateIsGuessed(photo)) {
    const guessed = document.createElement("span");
    guessed.className = "guessed";
    guessed.textContent = t("upload.fix.guessed");
    summary.append(guessed);
  }

  const unrecorded = t("upload.fix.unrecorded");
  // datetime-local is a picker on a phone; where a browser has none it falls
  // back to a text field, and the same ISO text is read out of either.
  const taken = fixField(t("upload.fix.taken"), forDateInput(correction.takenAt), {
    type: "datetime-local",
  });
  const lat = fixField(t("upload.field.lat"), correction.lat, { hint: exif.lat ?? unrecorded });
  const lon = fixField(t("upload.field.lon"), correction.lon, { hint: exif.lon ?? unrecorded });
  const place = fixField(t("upload.field.place"), correction.place, {
    hint: photo.place ?? t("upload.fix.placeHint"),
  });

  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = t("upload.fix.save");

  const state = document.createElement("span");
  state.className = "state";
  state.setAttribute("role", "status");

  const form = document.createElement("form");
  form.className = "fix-form";
  form.append(taken.field, lat.field, lon.field, rowMap(photo, lat.input, lon.input), place.field, save, state);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveRow(photo, save, state, {
      takenAt: taken.input.value,
      lat: lat.input.value,
      lon: lon.input.value,
      place: place.input.value,
    });
  });

  const details = document.createElement("details");
  details.append(summary, form);

  const row = document.createElement("li");
  row.append(details);
  return row;
}

/* ------------------------------------------------------------- where it was */

/*
 * The maps for saying where something is, in place of typing a latitude into a
 * box.
 *
 * Both of them write into the fields rather than replacing them: the fields are
 * what gets saved, they can still be typed into by somebody who has the
 * coordinates written down, and emptying one still means "go back to what the
 * photo itself says". A map is an easier way to answer the question, not a
 * different question.
 *
 * Each is built the first time it is asked for. Leaflet measures its container
 * as it is created, so one built inside a shut disclosure would come out
 * zero-sized — which is also why reopening one refreshes it.
 */

let placePicker = null;

/** One picker per row of the fix list, so a row is only ever mapped once. */
const rowPickers = new Map();

/** A point chosen on a map, into the two fields that are what actually saves. */
function writePoint(point, latInput, lonInput) {
  const text = pointText(point);
  latInput.value = text.lat;
  lonInput.value = text.lon;
}

/**
 * Everywhere the site already knows about, best guess first, for a map with
 * nothing else to open on.
 *
 * Corrections come before photos on purpose. A location saved on this screen a
 * minute ago is the freshest thing anybody has said about where this family
 * is — and it will not be in the manifest until the site rebuilds, so without
 * this, fixing a second photo would start from the whole world again exactly as
 * the first one did. Reversed, because a correction saved just now is written at
 * the end of the file.
 *
 * That matters most in the case this gallery is actually in: every photo in it
 * arrived with its metadata stripped, so nothing has a location at all and the
 * first map really does open on the world. One photo fixed, or one place named,
 * and every map after it opens in the right neighbourhood.
 */
const placesKnown = () => [
  ...Object.values(corrections.photos).reverse(),
  ...shownPhotos,
  ...corrections.places,
];

/** The map under the place form, with the circle the place will cover on it. */
function showPlacePicker() {
  if (placePicker) {
    placePicker.refresh();
    return;
  }

  placePicker = createPicker(el.placeMap, {
    view: openingView({
      point: pointFrom(el.placeLat.value, el.placeLon.value),
      nearby: placesKnown(),
    }),
    radiusM: el.placeRadius.value || DEFAULT_RADIUS_M,
    onPick: (point) => writePoint(point, el.placeLat, el.placeLon),
  });

  // With no map there is nowhere for a located point to go.
  el.placeLocate.hidden = !placePicker;
}

/**
 * Where the phone says it is. Worth the permission prompt: the place being named
 * is very often the house the phone is standing in.
 */
async function locateOnMap(picker, state) {
  if (!picker) return;

  report(state, t("upload.map.locating"));
  try {
    await picker.locate();
    report(state, "");
  } catch {
    // Refused, switched off, or timed out. Which of the three it was is nothing
    // anybody can act on — the map is still there to tap.
    report(state, t("upload.map.refused"), "failed");
  }
}

/** The same map for one photo, shut until it is asked for. */
function rowMap(photo, latInput, lonInput) {
  const canvas = document.createElement("div");
  canvas.className = "picker-map";

  const summary = document.createElement("summary");
  summary.textContent = t("upload.map.pick");

  const hint = document.createElement("p");
  hint.className = "picker-hint";
  hint.textContent = t("upload.map.hint");

  const disclosure = document.createElement("details");
  disclosure.className = "row-map";
  disclosure.append(summary, canvas, hint);

  disclosure.addEventListener("toggle", () => {
    if (!disclosure.open) return;

    const built = rowPickers.get(canvas);
    if (built) {
      built.refresh();
      return;
    }

    const picker = createPicker(canvas, {
      view: openingView({
        point: pointFrom(latInput.value, lonInput.value),
        photo,
        nearby: placesKnown(),
      }),
      onPick: (point) => writePoint(point, latInput, lonInput),
    });
    if (picker) rowPickers.set(canvas, picker);
  });

  return disclosure;
}

/** A screen being thrown away takes its maps with it, or they leak. */
function forgetRowPickers() {
  for (const picker of rowPickers.values()) picker.destroy();
  rowPickers.clear();
}

/** Say how a save went where it was asked for, rather than at the top of the screen. */
function report(state, text, outcome) {
  state.className = outcome ? `state ${outcome}` : "state";
  state.textContent = text;
}

async function saveRow(photo, button, state, fields) {
  report(state, t("upload.fix.saving"));
  button.disabled = true;
  try {
    const committed = await saveCorrection(github, keyFor(corrections, photo), fields);
    corrections = readCorrections(committed);
    report(state, t("upload.fix.saved"), "done");
  } catch (error) {
    report(state, error.message, "failed");
  } finally {
    button.disabled = false;
  }
}

/** The places already named, so the same one is not named twice by mistake. */
function showNamedPlaces() {
  const names = corrections.places.map((place) => place.name).filter(Boolean);
  el.placeNamed.hidden = names.length === 0;
  el.placeNamed.textContent = t("upload.place.named", { names: names.join(", ") });
}

async function addNamedPlace() {
  report(el.placeState, t("upload.fix.saving"));
  el.placeSave.disabled = true;
  try {
    const committed = await savePlace(github, {
      name: el.placeName.value,
      lat: el.placeLat.value,
      lon: el.placeLon.value,
      radiusM: el.placeRadius.value,
    });
    corrections = readCorrections(committed);
    showNamedPlaces();
    el.placeForm.reset();
    // The fields are empty again, so the map must not still be pointing at the
    // house they described — and the radius goes back to the pipeline's default
    // with the field that held it.
    placePicker?.clear();
    placePicker?.setRadius(el.placeRadius.value || DEFAULT_RADIUS_M);
    report(el.placeState, t("upload.place.added"), "done");
  } catch (error) {
    report(el.placeState, error.message, "failed");
  } finally {
    el.placeSave.disabled = false;
  }
}

/**
 * Show the screen, reading both halves of it fresh: the manifest from the site,
 * because that is where the thumbnails are anyway, and the corrections through
 * GitHub, because a published copy of those can be minutes behind a save.
 */
async function showFix() {
  el.setup.hidden = true;
  el.picker.hidden = true;
  el.handOff.hidden = true;
  el.fix.hidden = false;
  el.toFix.hidden = true;

  forgetRowPickers(); // the rows about to be replaced hold maps of their own
  el.fixList.replaceChildren();
  el.fixState.hidden = false;
  report(el.fixState, t("upload.fix.reading"));

  let photos;
  try {
    // Reading the manifest never fails loudly — an unbuilt site is an empty
    // screen, not an error. The corrections are read through GitHub, and that
    // can be refused.
    const [published, current] = await Promise.all([loadRecentPhotos(), loadCorrections(github)]);
    photos = published;
    corrections = current;
  } catch (error) {
    report(el.fixState, t("upload.fix.unreadable", { reason: error.message }), "failed");
    return;
  }

  shownPhotos = photos;
  showNamedPlaces();
  el.fixList.replaceChildren(...photos.map(fixRow));
  report(el.fixState, photos.length === 0 ? t("upload.fix.empty") : "");
  el.fixState.hidden = photos.length > 0;

  // The place form's own map was measured while this section was hidden.
  if (el.place.open) showPlacePicker();
}

function hideFix() {
  el.fix.hidden = true;
  forgetRowPickers();
  // The rows hold thumbnails and half-typed fields for a screen that is gone.
  el.fixList.replaceChildren();
  el.picker.hidden = false;
  el.toFix.hidden = false;
}

/*
 * The screen is a place of its own: it names itself in the address bar and owns
 * exactly one history entry, so the phone's back gesture leaves the screen
 * rather than the page. The same shape the gallery gives an open photo, and the
 * URL is the truth about which of the two is showing.
 */
function openFix() {
  history.pushState({ fix: true }, "", "?fix");
  showFix();
}

/**
 * The screen asked for in the address bar — a bookmark, or a reload while it
 * was open. The entry it arrived on becomes the picker and the screen is opened
 * on top of it, so going back lands on the picker rather than off the site.
 */
function openFixFromUrl() {
  if (!new URLSearchParams(location.search).has("fix")) return;

  history.replaceState(null, "", location.pathname);
  openFix();
}

/* ------------------------------------------------------------------ setup */

function showPicker() {
  el.setup.hidden = true;
  el.picker.hidden = false;
  el.handOff.hidden = true;
  el.fix.hidden = true;
  el.toFix.hidden = false;
  el.actionsLink.href = actionsUrl();

  // The token just verified, so it still works — this only says for how long.
  const notice = expiryNotice(github.tokenExpiry());
  el.expiryText.textContent = notice ?? "";
  el.expiry.hidden = !notice;

  showFailures(); // never rejects, and nothing here waits on it
  openFixFromUrl(); // whatever the address bar asked for, once there is a token for it
}

function showSetup(message) {
  el.setup.hidden = false;
  el.picker.hidden = true;
  el.handOff.hidden = true;
  el.fix.hidden = true;
  el.toFix.hidden = true;
  el.setupError.hidden = !message;
  el.setupError.textContent = message ?? "";

  offerPassphrase(); // never rejects, and nothing here waits on it
}

/**
 * Put the token now on this device to work: show the picker if GitHub accepts
 * it, or hand back why it did not, for the caller to word. Every way a token
 * arrives — already saved, typed, scanned — comes through here, so however one
 * turned up, a token that is invalid, expired or scoped to the wrong repository
 * is said to be so rather than left to look as though the page is set up.
 */
async function useStoredToken() {
  try {
    await github.verifyToken();
    showPicker();
    return null;
  } catch (error) {
    github.forgetToken();
    return error.message;
  }
}

/**
 * Set this device up from the passphrase — the fourth way a token gets here,
 * and the only one that does not need the token itself to hand.
 *
 * The sealed token is fetched again rather than kept from start-up: rotating it
 * publishes a new one, and an old copy would refuse a passphrase that is now
 * the right one.
 *
 * Returns the whole sentence to show, or `null` once the device is set up.
 */
async function usePassphrase(passphrase) {
  const sealed = await loadSealedToken();
  if (!sealed) return t("upload.passphrase.absent");

  let token;
  try {
    token = await unseal(sealed, passphrase);
  } catch (error) {
    // An artefact this page cannot read is not the passphrase's fault, and
    // saying it was would send someone hunting for the wrong problem.
    if (error.unreadable) return t("upload.passphrase.stale");
    // Everything else says one thing and nothing more. Anyone can download the
    // sealed token and guess at it offline for as long as they like, so a
    // message that let two wrong passphrases be told apart — which word was
    // right, how close a guess came — would be doing that work for them.
    return t("upload.passphrase.wrong");
  }

  github.saveToken(token);
  const refused = await useStoredToken();
  return refused && t("upload.passphrase.tokenRefused", { reason: refused });
}

/**
 * Offer the passphrase only where there is a sealed token to open with it.
 * Until the workflow has been run there is no such file, and a passphrase box
 * would be a door onto nothing.
 */
async function offerPassphrase() {
  el.passphrase.hidden = !(await loadSealedToken());
}

/**
 * The token this device arrived carrying, lifted out of the address bar as it
 * is read: a token left in a URL is a token in the history, in the next
 * screenshot, and in whatever the browser syncs between devices. replaceState
 * leaves nothing to go back to.
 */
function takeScannedToken() {
  const token = tokenFromFragment(location.hash);
  if (!token) return null;

  history.replaceState(null, "", location.pathname + location.search);
  return token;
}

async function start() {
  installApp(); // this page is an entrance to the app as much as the gallery is

  const config = await loadConfig();
  useLanguage(config.language);
  translatePage();
  document.title = t("upload.title");

  github = createClient(await detectRepo(config));
  el.repoName.textContent = `${github.repo.owner}/${github.repo.name}`;
  el.tokenLink.href = "https://github.com/settings/personal-access-tokens/new";
  el.placeRadius.placeholder = DEFAULT_RADIUS_M; // the pipeline's own default, said once

  // The four sentences with something other than words in them. Where the
  // emphasis and the links fall is part of the sentence, so each language hands
  // back its own order for them rather than having one wrapped around a
  // translation — in Korean the repository is named before the permission is.
  el.tokenIntro.replaceChildren(...t("upload.token.intro", { strong, em, repo: el.repoName }));
  el.tokenGotchas.replaceChildren(...t("upload.token.gotchas", { strong, em }));
  el.failedKept.replaceChildren(...t("upload.failed.kept", { link: el.failedLink }));
  el.doneNote.replaceChildren(...t("upload.done", { link: el.actionsLink }));

  const scanned = takeScannedToken();
  if (scanned) {
    github.saveToken(scanned);
    const refused = await useStoredToken();
    if (refused) showSetup(t("upload.token.scanned", { reason: refused }));
  } else if (github.hasToken()) {
    const refused = await useStoredToken();
    if (refused) showSetup(t("upload.token.stale", { reason: refused }));
  } else {
    showSetup();
  }

  el.tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    github.saveToken(el.tokenInput.value);
    const refused = await useStoredToken();
    if (refused) {
      showSetup(t("upload.token.refused", { reason: refused }));
    } else {
      el.tokenInput.value = "";
    }
  });

  el.passphraseForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Deriving the key is slow on purpose — a second or so on a phone — so the
    // button has to say it is working. Without that the tap looks ignored, and
    // the next tap starts a second derivation racing the first.
    const label = el.passphraseButton.textContent;
    el.passphraseButton.disabled = true;
    el.passphraseButton.textContent = t("upload.passphrase.unlocking");
    try {
      const refused = await usePassphrase(el.passphraseInput.value);
      if (refused) {
        showSetup(refused);
      } else {
        el.passphraseInput.value = "";
      }
    } finally {
      el.passphraseButton.disabled = false;
      el.passphraseButton.textContent = label;
    }
  });

  el.showCode.addEventListener("click", () => {
    // Drawn on the way in and thrown away on the way out, so dismissing the
    // code really does take the token off the screen. The markup is the
    // encoder's own — geometry and nothing from anywhere else.
    el.setupCode.innerHTML = qrSvg(setupUrl(location.href, github.token()), t("upload.handoff.codeLabel"));
    el.handOff.hidden = false;
    el.handOff.scrollIntoView({ block: "nearest" });
  });

  el.hideCode.addEventListener("click", () => {
    el.handOff.hidden = true;
    el.setupCode.replaceChildren();
  });

  el.forget.addEventListener("click", () => {
    github.forgetToken();
    showSetup(t("upload.token.forgotten"));
  });

  el.toFix.addEventListener("click", (event) => {
    event.preventDefault();
    openFix();
  });

  el.fixBack.addEventListener("click", (event) => {
    event.preventDefault();
    if (leavingFix) return;
    leavingFix = true;
    history.back(); // which lands in the popstate handler, and that closes the screen
  });

  window.addEventListener("popstate", () => {
    leavingFix = false;
    if (history.state?.fix) showFix();
    else hideFix();
  });

  el.placeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addNamedPlace();
  });

  // Built on the way in rather than with the page: a Leaflet map behind a shut
  // disclosure is tiles fetched for nobody.
  el.place.addEventListener("toggle", () => {
    if (el.place.open) showPlacePicker();
  });

  // The circle is how you see whether the house is inside the radius, so it
  // follows the field as it is typed into.
  el.placeRadius.addEventListener("input", () => {
    placePicker?.setRadius(el.placeRadius.value || DEFAULT_RADIUS_M);
  });

  el.placeLocate.addEventListener("click", () => locateOnMap(placePicker, el.placeLocateState));

  el.fileInput.addEventListener("change", () => {
    if (el.fileInput.files.length) upload(el.fileInput.files);
    el.fileInput.value = ""; // let the same file be picked again after a failure
  });

  for (const type of ["dragenter", "dragover"]) {
    el.drop.addEventListener(type, (event) => {
      event.preventDefault();
      el.drop.classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    el.drop.addEventListener(type, () => el.drop.classList.remove("dragging"));
  }
  el.drop.addEventListener("drop", (event) => {
    event.preventDefault();
    // Everything dropped goes into the queue, so anything rejected says so
    // rather than vanishing.
    if (event.dataTransfer.files.length) upload(event.dataTransfer.files);
  });
}

start();
