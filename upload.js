/**
 * The upload page: pick photos on a phone, commit them straight into photos/
 * via the GitHub Contents API. The pipeline does the rest on the next push.
 *
 * The token lives only in this browser's localStorage — it is never part of the
 * published site.
 */

const TOKEN_KEY = "grace.githubToken";
const MAX_BYTES = 40 * 1024 * 1024; // the Contents API gets unhappy well before this

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
  drop: document.getElementById("drop"),
  fileInput: document.getElementById("file-input"),
  queue: document.getElementById("queue"),
  doneNote: document.getElementById("done-note"),
  actionsLink: document.getElementById("actions-link"),
  forget: document.getElementById("forget"),
};

let repo = { owner: "", name: "", branch: "main" };

/**
 * Work out which repository this page is served from, so the page needs no
 * hand-editing after deployment. config.json wins if it says otherwise.
 */
async function resolveRepo() {
  const [owner] = location.hostname.split(".");
  const [firstSegment] = location.pathname.split("/").filter(Boolean);
  const isProjectPage = firstSegment && !firstSegment.endsWith(".html");

  const detected = {
    owner,
    name: isProjectPage ? firstSegment : `${owner}.github.io`,
    branch: "main",
  };

  try {
    const response = await fetch("config.json", { cache: "no-store" });
    if (response.ok) {
      const config = await response.json();
      return { ...detected, ...(config.repo ?? {}) };
    }
  } catch {
    /* the detected values are good enough */
  }
  return detected;
}

/* ------------------------------------------------------------ GitHub API */

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail.message || `GitHub returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function checkToken() {
  await github(`/repos/${repo.owner}/${repo.name}`);
}

async function toBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000; // String.fromCharCode has an argument-count limit
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Commit one photo. Two uploads before the pipeline runs can collide on a
 * filename, so a taken name gets a numbered variant rather than an error.
 */
async function commitPhoto(file, content) {
  const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const name = attempt === 0 ? safeName : `${stem}-${attempt}${extension}`;
    try {
      return await github(`/repos/${repo.owner}/${repo.name}/contents/photos/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `photo: add ${name}`,
          content,
          branch: repo.branch,
        }),
      });
    } catch (error) {
      const nameTaken = error.status === 422 || error.status === 409;
      if (!nameTaken || attempt === 4) throw error;
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
  let succeeded = 0;

  for (const [file, row] of rows) {
    try {
      if (!looksLikePhoto(file)) throw new Error("not a photo");
      if (file.size > MAX_BYTES) throw new Error("too large to upload");
      row.set("uploading…");
      await commitPhoto(file, await toBase64(file));
      row.set("added", "done");
      succeeded += 1;
    } catch (error) {
      row.set(error.message, "failed");
    }
  }

  if (succeeded > 0) el.doneNote.hidden = false;
}

/* ------------------------------------------------------------------ setup */

function showPicker() {
  el.setup.hidden = true;
  el.picker.hidden = false;
  el.actionsLink.href = `https://github.com/${repo.owner}/${repo.name}/actions`;
}

function showSetup(message) {
  el.setup.hidden = false;
  el.picker.hidden = true;
  el.setupError.hidden = !message;
  el.setupError.textContent = message ?? "";
}

async function start() {
  repo = await resolveRepo();
  el.repoName.textContent = `${repo.owner}/${repo.name}`;
  el.tokenLink.href = "https://github.com/settings/personal-access-tokens/new";

  if (localStorage.getItem(TOKEN_KEY)) {
    try {
      await checkToken();
      showPicker();
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      showSetup(`That saved token no longer works (${error.message}). Please add a new one.`);
    }
  } else {
    showSetup();
  }

  el.tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    localStorage.setItem(TOKEN_KEY, el.tokenInput.value.trim());
    try {
      await checkToken();
      el.tokenInput.value = "";
      showPicker();
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      showSetup(`That token did not work: ${error.message}`);
    }
  });

  el.forget.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
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
