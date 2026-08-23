/**
 * The GitHub client runs in a browser, so the browser is what these tests fake:
 * `fetch`, `localStorage` and `location` are replaced with stubs that record
 * what the client asked for and answer with whatever the test needs.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createClient, detectRepo, encodeBase64 } from "../../github.js";

const REPO = { owner: "ehhj0525", name: "ehhj0525.github.io", branch: "main" };
const CONTENTS = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents`;

/** Node has no DOM, so these globals have to be installed rather than assigned. */
function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  define("localStorage", {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  });
  return map;
}

/**
 * Install a fake `fetch`. The handler is called with each request and answers
 * `{ status, body }`; the array of requests made is returned for assertions.
 */
function recordFetch(handler) {
  const calls = [];
  define("fetch", async (url, options = {}) => {
    const call = {
      url: String(url),
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body === undefined ? undefined : JSON.parse(options.body),
    };
    calls.push(call);
    const { status = 200, body = {}, unparseable = false } = (await handler(call, calls.length)) ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (unparseable) throw new SyntaxError("Unexpected token < in JSON");
        return body;
      },
    };
  });
  return calls;
}

const base64 = (text) => Buffer.from(text, "utf8").toString("base64");

/** What the Contents API returns for a file that exists. */
const file = (text, sha) => ({ status: 200, body: { sha, encoding: "base64", content: base64(text) } });

const rejected = (status, message) => ({ status, body: { message } });

async function refuses(promise, message) {
  const error = await promise.then(
    () => null,
    (thrown) => thrown
  );
  assert.ok(error, "expected the call to fail");
  assert.match(error.message, message);
  return error;
}

beforeEach(() => {
  memoryStorage({ "grace.githubToken": "github_pat_test" });
});

describe("detectRepo", () => {
  const at = (hostname, pathname) => define("location", { hostname, pathname });

  it("reads the owner and the repository from a user-pages URL", async () => {
    at("ehhj0525.github.io", "/upload.html");
    recordFetch(() => rejected(404, "Not Found"));

    assert.deepEqual(await detectRepo(), REPO);
  });

  it("takes a project page's repository from the first path segment", async () => {
    at("ehhj0525.github.io", "/gallery/upload.html");
    recordFetch(() => rejected(404, "Not Found"));

    assert.deepEqual(await detectRepo(), { owner: "ehhj0525", name: "gallery", branch: "main" });
  });

  it("lets config.json override what the URL suggests", async () => {
    at("ehhj0525.github.io", "/upload.html");
    recordFetch(() => ({ body: { repo: { name: "elsewhere", branch: "gh-pages" } } }));

    assert.deepEqual(await detectRepo(), { owner: "ehhj0525", name: "elsewhere", branch: "gh-pages" });
  });

  it("falls back to the URL when config.json cannot be read", async () => {
    at("ehhj0525.github.io", "/upload.html");
    define("fetch", async () => {
      throw new TypeError("offline");
    });

    assert.deepEqual(await detectRepo(), REPO);
  });
});

describe("the token", () => {
  it("is trimmed on the way in and reported once present", () => {
    const stored = memoryStorage();
    const github = createClient(REPO);

    assert.equal(github.hasToken(), false);
    github.saveToken("  github_pat_pasted\n");

    assert.equal(stored.get("grace.githubToken"), "github_pat_pasted");
    assert.equal(github.hasToken(), true);
  });

  it("can be forgotten", () => {
    const stored = memoryStorage({ "grace.githubToken": "github_pat_test" });
    const github = createClient(REPO);

    github.forgetToken();

    assert.equal(stored.has("grace.githubToken"), false);
    assert.equal(github.hasToken(), false);
  });
});

describe("request", () => {
  it("authenticates with the stored token and pins the API version", async () => {
    const calls = recordFetch(() => ({ body: { login: "ehhj0525" } }));

    await createClient(REPO).request("/user");

    assert.equal(calls[0].url, "https://api.github.com/user");
    assert.equal(calls[0].headers.Authorization, "Bearer github_pat_test");
    assert.equal(calls[0].headers.Accept, "application/vnd.github+json");
    assert.equal(calls[0].headers["X-GitHub-Api-Version"], "2022-11-28");
  });

  it("raises GitHub's own message, keeping the status", async () => {
    recordFetch(() => rejected(404, "Not Found"));

    const error = await refuses(createClient(REPO).request("/user"), /Not Found/);
    assert.equal(error.status, 404);
  });

  it("falls back to the status when the failure is not JSON", async () => {
    recordFetch(() => ({ status: 502, unparseable: true }));

    await refuses(createClient(REPO).request("/user"), /GitHub returned 502/);
  });
});

describe("verifyToken", () => {
  const answering = (user, repo) =>
    recordFetch((call) => (call.url.endsWith("/user") ? user : repo));

  it("returns the user when the token can see the repository", async () => {
    answering({ body: { login: "ehhj0525" } }, { body: { full_name: "ehhj0525/ehhj0525.github.io" } });

    const user = await createClient(REPO).verifyToken();

    assert.equal(user.login, "ehhj0525");
  });

  it("explains an expired token rather than repeating '401'", async () => {
    answering(rejected(401, "Bad credentials"), {});

    await refuses(createClient(REPO).verifyToken(), /invalid, or it has expired/);
  });

  it("explains a token that is not scoped to this repository", async () => {
    answering({ body: { login: "EHHJ0525" } }, rejected(404, "Not Found"));

    await refuses(
      createClient(REPO).verifyToken(),
      /owned by EHHJ0525 but cannot see ehhj0525\/ehhj0525\.github\.io/
    );
  });

  it("explains a token created under the wrong account", async () => {
    answering({ body: { login: "someone-else" } }, rejected(404, "Not Found"));

    await refuses(
      createClient(REPO).verifyToken(),
      /belongs to someone-else, but this site lives in ehhj0525's account/
    );
  });
});

describe("readFile", () => {
  it("returns the current text and sha of a file", async () => {
    const calls = recordFetch(() => file('{"places":["할머니집"]}', "sha-1"));

    const found = await createClient(REPO).readFile("overrides.json");

    assert.equal(calls[0].url, `${CONTENTS}/overrides.json?ref=main`);
    assert.equal(found.text, '{"places":["할머니집"]}');
    assert.equal(found.sha, "sha-1");
  });

  it("encodes each segment of the path", async () => {
    const calls = recordFetch(() => file("{}", "sha-1"));

    await createClient(REPO).readFile("photos/우리 아기.jpg");

    assert.equal(calls[0].url, `${CONTENTS}/photos/${encodeURIComponent("우리 아기.jpg")}?ref=main`);
  });

  it("returns nothing at all for a file that does not exist", async () => {
    recordFetch(() => rejected(404, "Not Found"));

    assert.equal(await createClient(REPO).readFile("overrides.json"), null);
  });

  it("raises anything that is not a missing file", async () => {
    recordFetch(() => rejected(401, "Bad credentials"));

    await refuses(createClient(REPO).readFile("overrides.json"), /Bad credentials/);
  });
});

describe("writeFile", () => {
  it("creates a file that is not there yet", async () => {
    const calls = recordFetch((call) =>
      call.method === "GET" ? rejected(404, "Not Found") : { status: 201, body: { commit: { sha: "new" } } }
    );

    await createClient(REPO).writeFile("overrides.json", { text: "{}", message: "fix a date" });

    const [, put] = calls;
    assert.equal(put.method, "PUT");
    assert.equal(put.body.sha, undefined);
    assert.equal(put.body.branch, "main");
    assert.equal(put.body.message, "fix a date");
    assert.equal(Buffer.from(put.body.content, "base64").toString("utf8"), "{}");
  });

  it("updates a file that already exists, using its current sha", async () => {
    const calls = recordFetch((call) => (call.method === "GET" ? file("{}", "sha-1") : { body: {} }));

    await createClient(REPO).writeFile("overrides.json", { text: "{}", message: "fix a date" });

    assert.equal(calls[1].body.sha, "sha-1");
  });

  it("writes again against fresh state when the branch moved underneath it", async () => {
    const calls = recordFetch((call, nth) => {
      if (call.method === "GET") return file("{}", nth === 1 ? "stale" : "fresh");
      return nth === 2 ? rejected(409, "does not match") : { body: { commit: { sha: "new" } } };
    });

    await createClient(REPO).writeFile("overrides.json", { text: "{}", message: "fix a date" });

    assert.deepEqual(
      calls.map((call) => [call.method, call.body?.sha]),
      [
        ["GET", undefined],
        ["PUT", "stale"],
        ["GET", undefined],
        ["PUT", "fresh"],
      ]
    );
  });

  it("picks up a sha when the file appears mid-write", async () => {
    const calls = recordFetch((call, nth) => {
      if (call.method === "GET") return nth === 1 ? rejected(404, "Not Found") : file("{}", "theirs");
      return nth === 2 ? rejected(422, "sha wasn't supplied") : { body: {} };
    });

    await createClient(REPO).writeFile("overrides.json", { text: "{}", message: "fix a date" });

    assert.equal(calls[3].body.sha, "theirs");
  });

  it("surfaces a rejected request instead of repeating it", async () => {
    const calls = recordFetch((call) =>
      call.method === "GET" ? file("{}", "sha-1") : rejected(422, "content is not valid Base64")
    );

    await refuses(
      createClient(REPO).writeFile("overrides.json", { content: "not base64!", message: "fix" }),
      /not valid Base64/
    );

    assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
  });

  it("gives up when the branch will not stop moving", async () => {
    const calls = recordFetch((call) =>
      call.method === "GET" ? file("{}", "sha-1") : rejected(409, "does not match")
    );

    const error = await refuses(
      createClient(REPO).writeFile("overrides.json", { text: "{}", message: "fix" }),
      /does not match/
    );

    assert.equal(error.status, 409);
    assert.equal(calls.filter((call) => call.method === "PUT").length, 3);
  });

  it("explains a token that cannot write here", async () => {
    recordFetch((call) =>
      call.method === "GET" ? file("{}", "sha-1") : rejected(403, "Resource not accessible")
    );

    await refuses(
      createClient(REPO).writeFile("overrides.json", { text: "{}", message: "fix" }),
      /needs "Contents: Read and write"/
    );
  });
});

describe("createFile", () => {
  it("commits without reading first, since the file is meant to be new", async () => {
    const calls = recordFetch(() => ({ status: 201, body: { commit: { sha: "new" } } }));

    await createClient(REPO).createFile("photos/a.jpg", {
      content: encodeBase64(new Uint8Array([1, 2, 3])),
      message: "photo: add a.jpg",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[0].url, `${CONTENTS}/photos/a.jpg`);
    assert.equal(calls[0].body.sha, undefined);
  });

  it("keeps the status when the path is already taken, so the caller can rename", async () => {
    recordFetch(() => rejected(422, "Invalid request"));

    const error = await refuses(
      createClient(REPO).createFile("photos/a.jpg", { content: "AQID", message: "photo: add a.jpg" }),
      /Invalid request/
    );

    assert.equal(error.status, 422);
  });

  it("explains a token that cannot write here", async () => {
    recordFetch(() => rejected(403, "Resource not accessible"));

    await refuses(
      createClient(REPO).createFile("photos/a.jpg", { content: "AQID", message: "photo: add a.jpg" }),
      /needs "Contents: Read and write"/
    );
  });
});

describe("encodeBase64", () => {
  it("encodes more bytes than fit in one call to String.fromCharCode", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);

    assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString("base64"));
    assert.equal(encodeBase64(bytes.buffer), Buffer.from(bytes).toString("base64"));
  });
});
