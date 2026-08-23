/**
 * The upload page: pick photos on a phone, commit them straight into photos/
 * via the GitHub Contents API. The pipeline does the rest on the next push.
 *
 * Everything about talking to GitHub — the repository, the token, the commits —
 * lives in github.js; this file is only the page around it.
 */

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
import { t, useLanguage } from "./language.js";
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
 * Commit one photo. Two uploads before the pipeline runs can collide on a
 * filename, so a taken name gets a numbered variant rather than an error.
 */
async function commitPhoto(file, content) {
  const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : "";

  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    const name = attempt === 0 ? safeName : `${stem}-${attempt}${extension}`;
    try {
      return await github.createFile(`photos/${name}`, { content, message: `photo: add ${name}` });
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
  const rows = [...files].map((file) => [file, queueRow(file)]);
  let done = 0;
  let succeeded = 0;
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
      await commitPhoto(file, encodeBase64(await file.arrayBuffer()));
      row.set(t("upload.queue.added"), "done");
      succeeded += 1;
    } catch (error) {
      row.set(error.message, "failed");
    }
    // Outside the catch: a photo that failed is one fewer left to wait for.
    done += 1;
    showCount();
  }

  el.progress.textContent = batchSummary(succeeded, rows.length - succeeded);
  if (succeeded > 0) el.doneNote.hidden = false;
}

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
  form.append(taken.field, lat.field, lon.field, place.field, save, state);
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

  showNamedPlaces();
  el.fixList.replaceChildren(...photos.map(fixRow));
  report(el.fixState, photos.length === 0 ? t("upload.fix.empty") : "");
  el.fixState.hidden = photos.length > 0;
}

function hideFix() {
  el.fix.hidden = true;
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
  el.actionsLink.href = `https://github.com/${github.repo.owner}/${github.repo.name}/actions`;

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
