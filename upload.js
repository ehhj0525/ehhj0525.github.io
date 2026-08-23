/**
 * The upload page: pick photos on a phone, commit them straight into photos/
 * via the GitHub Contents API. The pipeline does the rest on the next push.
 *
 * Everything about talking to GitHub — the repository, the token, the commits —
 * lives in github.js; this file is only the page around it.
 */

import { failureHeading, loadFailures } from "./failure-report.js";
import { createClient, detectRepo, encodeBase64 } from "./github.js";
import { qrSvg } from "./qr.js";
import { loadSealedToken, unseal } from "./sealed-token.js";
import { setupUrl, tokenFromFragment } from "./setup-link.js";
import { expiryNotice } from "./token-expiry.js";
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
  repoName: document.getElementById("repo-name"),
  expiry: document.getElementById("expiry"),
  expiryText: document.getElementById("expiry-text"),
  failed: document.getElementById("failed"),
  failedHeading: document.getElementById("failed-heading"),
  failedList: document.getElementById("failed-list"),
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
  state.textContent = "waiting";

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
      if (!looksLikePhoto(file)) throw new Error("not a photo");
      if (file.size > MAX_BYTES) throw new Error("too large to upload");
      row.set("uploading…");
      await commitPhoto(file, encodeBase64(await file.arrayBuffer()));
      row.set("added", "done");
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

/* ------------------------------------------------------------------ setup */

function showPicker() {
  el.setup.hidden = true;
  el.picker.hidden = false;
  el.handOff.hidden = true;
  el.actionsLink.href = `https://github.com/${github.repo.owner}/${github.repo.name}/actions`;

  // The token just verified, so it still works — this only says for how long.
  const notice = expiryNotice(github.tokenExpiry());
  el.expiryText.textContent = notice ?? "";
  el.expiry.hidden = !notice;

  showFailures(); // never rejects, and nothing here waits on it
}

function showSetup(message) {
  el.setup.hidden = false;
  el.picker.hidden = true;
  el.handOff.hidden = true;
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
  if (!sealed) return "There is no passphrase set up for this site. Use a token below.";

  let token;
  try {
    token = await unseal(sealed, passphrase);
  } catch (error) {
    // An artefact this page cannot read is not the passphrase's fault, and
    // saying it was would send someone hunting for the wrong problem.
    if (error.unreadable) {
      return (
        "This page cannot read the published token — this may be an old copy of the page. " +
        "Reload and try again."
      );
    }
    // Everything else says one thing and nothing more. Anyone can download the
    // sealed token and guess at it offline for as long as they like, so a
    // message that let two wrong passphrases be told apart — which word was
    // right, how close a guess came — would be doing that work for them.
    return "That passphrase did not work.";
  }

  github.saveToken(token);
  const refused = await useStoredToken();
  return refused && `The passphrase worked, but the token behind it did not: ${refused}`;
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
  github = createClient(await detectRepo());
  el.repoName.textContent = `${github.repo.owner}/${github.repo.name}`;
  el.tokenLink.href = "https://github.com/settings/personal-access-tokens/new";

  const scanned = takeScannedToken();
  if (scanned) {
    github.saveToken(scanned);
    const refused = await useStoredToken();
    if (refused) showSetup(`The code you scanned did not work: ${refused}`);
  } else if (github.hasToken()) {
    const refused = await useStoredToken();
    if (refused) showSetup(`That saved token no longer works (${refused}). Please add a new one.`);
  } else {
    showSetup();
  }

  el.tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    github.saveToken(el.tokenInput.value);
    const refused = await useStoredToken();
    if (refused) {
      showSetup(`That token did not work: ${refused}`);
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
    el.passphraseButton.textContent = "Unlocking…";
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
    el.setupCode.innerHTML = qrSvg(setupUrl(location.href, github.token()), "Setup code");
    el.handOff.hidden = false;
    el.handOff.scrollIntoView({ block: "nearest" });
  });

  el.hideCode.addEventListener("click", () => {
    el.handOff.hidden = true;
    el.setupCode.replaceChildren();
  });

  el.forget.addEventListener("click", () => {
    github.forgetToken();
    showSetup("Token removed from this device.");
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
