/**
 * Everything the site knows about talking to its own GitHub repository: which
 * repository it is, the token that is allowed to write to it, and reading and
 * writing files through the Contents API.
 *
 * The upload page uses this, and so does every maintenance screen added later —
 * none of them should have to learn the API's habits a second time.
 *
 * The token lives only in this browser's localStorage — it is never part of the
 * published site.
 */

const TOKEN_KEY = "grace.githubToken";
const API_ROOT = "https://api.github.com";

// Writing a file means reading its sha and then committing it, and the pipeline
// commits to the same branch on every push — so the sha can go stale between
// the two. Three attempts steps past a commit that lands mid-write without
// spinning forever when something is genuinely wrong.
const WRITE_ATTEMPTS = 3;

/**
 * Work out which repository this page is served from, so no page needs
 * hand-editing after deployment. config.json wins if it says otherwise.
 */
export async function detectRepo() {
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

/* --------------------------------------------------------------- encoding */

// String.fromCharCode has an argument-count limit, so bytes go in slices.
const CHUNK = 0x8000;

/** Base64 for the Contents API, which is the only way it accepts a file. */
export function encodeBase64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

function decodeBase64(content) {
  // GitHub wraps its base64 at 60 characters; atob is specified to ignore the
  // whitespace, but stripping it keeps that from being load-bearing.
  const binary = atob(content.replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

/* ----------------------------------------------------------------- client */

/**
 * A client bound to one repository. `repo` is what {@link detectRepo} returns:
 * `{ owner, name, branch }`.
 */
export function createClient(repo) {
  const contents = (path) => `/repos/${repo.owner}/${repo.name}/contents/${encodePath(path)}`;

  async function request(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
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

  /**
   * Check the token before accepting it, and say something useful when it fails.
   *
   * GitHub answers "Not Found" — not "Forbidden" — when a fine-grained token is
   * valid but not scoped to this repository, so the raw message sends people
   * hunting for the wrong problem.
   */
  async function verifyToken() {
    let user;
    try {
      user = await request("/user");
    } catch (error) {
      if (error.status === 401) throw new Error("this token is invalid, or it has expired");
      throw error;
    }

    try {
      await request(`/repos/${repo.owner}/${repo.name}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      throw new Error(
        user.login.toLowerCase() === repo.owner.toLowerCase()
          ? `this token is owned by ${user.login} but cannot see ${repo.owner}/${repo.name}. ` +
            `Edit the token and make sure "Repository access" includes ${repo.name}.`
          : `this token belongs to ${user.login}, but this site lives in ${repo.owner}'s account. ` +
            `Create the token while signed in as ${repo.owner}, with ${repo.owner}/${repo.name} selected.`
      );
    }
    return user;
  }

  /** The file as it stands on the branch, or `null` when there is no such file. */
  async function readFile(path) {
    try {
      const found = await request(`${contents(path)}?ref=${encodeURIComponent(repo.branch)}`, {
        cache: "no-store",
      });
      return {
        sha: found.sha,
        content: found.content,
        // Files over a megabyte come back without their content; nothing this
        // site edits is that big, and a caller that hits it should see null
        // rather than an empty string it might commit back.
        text: found.encoding === "base64" ? decodeBase64(found.content) : null,
      };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function put(path, commit) {
    try {
      return await request(contents(path), {
        method: "PUT",
        body: JSON.stringify({ branch: repo.branch, ...commit }),
      });
    } catch (error) {
      if (error.status === 403) {
        const refused = new Error('token cannot write here — it needs "Contents: Read and write"');
        refused.status = 403;
        throw refused;
      }
      throw error;
    }
  }

  /** A file to commit — either already-encoded `content`, or `text` to encode. */
  const payload = ({ content, text, message }) => ({
    message,
    content: content ?? encodeBase64(new TextEncoder().encode(text)),
  });

  /**
   * Commit a file that is not supposed to exist yet. A path that is already
   * taken comes back with its status intact so the caller can pick another one.
   */
  const createFile = (path, file) => put(path, payload(file));

  /**
   * Commit a file whether or not it already exists.
   *
   * Overwriting needs the file's current sha, so this reads before it writes.
   * If the branch moves in between — the pipeline commits on every push — GitHub
   * rejects the stale sha, and the write is simply made again against the state
   * that is there now.
   */
  async function writeFile(path, file) {
    let existing = await readFile(path);

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await put(path, { ...payload(file), sha: existing?.sha });
      } catch (error) {
        // 409 is the branch moving under a sha that was good when it was read.
        // 422 only means the same thing when no sha was sent at all — the file
        // appeared between the read and the write. Sent *with* a sha, 422 means
        // the request itself is bad, and repeating it would only fail again.
        const branchMoved = error.status === 409 || (error.status === 422 && !existing);
        if (!branchMoved || attempt === WRITE_ATTEMPTS) throw error;
        existing = await readFile(path);
      }
    }
  }

  return {
    repo,
    hasToken: () => Boolean(localStorage.getItem(TOKEN_KEY)),
    saveToken: (value) => localStorage.setItem(TOKEN_KEY, value.trim()),
    forgetToken: () => localStorage.removeItem(TOKEN_KEY),
    request,
    verifyToken,
    readFile,
    writeFile,
    createFile,
  };
}
