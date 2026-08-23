/**
 * The upload page: pick photos on a phone, commit them straight into photos/
 * via the GitHub Contents API. The pipeline does the rest on the next push.
 *
 * Everything about talking to GitHub — the repository, the token, the commits —
 * lives in github.js; this file is only the page around it.
 */

import { createClient, detectRepo, encodeBase64 } from "./github.js";
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
  repoName: document.getElementById("repo-name"),
  expiry: document.getElementById("expiry"),
  expiryText: document.getElementById("expiry-text"),
  drop: document.getElementById("drop"),
  fileInput: document.getElementById("file-input"),
  progress: document.getElementById("progress"),
  queue: document.getElementById("queue"),
  doneNote: document.getElementById("done-note"),
  actionsLink: document.getElementById("actions-link"),
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

/* ------------------------------------------------------------------ setup */

function showPicker() {
  el.setup.hidden = true;
  el.picker.hidden = false;
  el.actionsLink.href = `https://github.com/${github.repo.owner}/${github.repo.name}/actions`;

  // The token just verified, so it still works — this only says for how long.
  const notice = expiryNotice(github.tokenExpiry());
  el.expiryText.textContent = notice ?? "";
  el.expiry.hidden = !notice;
}

function showSetup(message) {
  el.setup.hidden = false;
  el.picker.hidden = true;
  el.setupError.hidden = !message;
  el.setupError.textContent = message ?? "";
}

async function start() {
  github = createClient(await detectRepo());
  el.repoName.textContent = `${github.repo.owner}/${github.repo.name}`;
  el.tokenLink.href = "https://github.com/settings/personal-access-tokens/new";

  if (github.hasToken()) {
    try {
      await github.verifyToken();
      showPicker();
    } catch (error) {
      github.forgetToken();
      showSetup(`That saved token no longer works (${error.message}). Please add a new one.`);
    }
  } else {
    showSetup();
  }

  el.tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    github.saveToken(el.tokenInput.value);
    try {
      await github.verifyToken();
      el.tokenInput.value = "";
      showPicker();
    } catch (error) {
      github.forgetToken();
      showSetup(`That token did not work: ${error.message}`);
    }
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
