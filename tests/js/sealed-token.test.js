/**
 * The sealed token is published to a public repository, so these tests are less
 * about "does it encrypt" than about the properties that make publishing it
 * survivable: nothing readable in the artefact, a fresh salt every time, a
 * refusal that says the same thing however it was arrived at, and old artefacts
 * still opening after the parameters are raised.
 *
 * Everything is sealed at a token iteration count so the suite stays fast; one
 * test uses the shipped count, to prove the real parameters work.
 *
 * The script the workflow runs is exercised the only way that proves the thing
 * that matters about it: run it for real, and read everything it printed.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { ITERATIONS, loadSealedToken, seal, unseal } from "../../sealed-token.js";

// Obvious fakes. No real token or passphrase belongs in this repository.
const TOKEN = "github_pat_11ABCDEFG0abcdefghijKL_M3nOpQrStUvWxYz";
const PASSPHRASE = "correct horse battery staple";

// Enough to exercise the code path without spending a second per test.
const CHEAP = { iterations: 1_000 };

const sealed = (token = TOKEN, passphrase = PASSPHRASE) => seal(token, passphrase, CHEAP);

const bytes = (base64) => Uint8Array.from(Buffer.from(base64, "base64"));
const base64 = (raw) => Buffer.from(raw).toString("base64");

/** The same artefact with one byte of `field` flipped. */
function tampered(artefact, field) {
  const raw = bytes(artefact[field]);
  raw[0] ^= 1;
  return { ...artefact, [field]: base64(raw) };
}

async function refuses(promise, message) {
  const error = await promise.then(
    () => null,
    (thrown) => thrown
  );
  assert.ok(error, "expected the call to fail");
  assert.match(error.message, message);
  return error;
}

describe("seal", () => {
  it("writes down everything needed to open it again", async () => {
    const artefact = await sealed();

    assert.equal(artefact.version, 1);
    assert.equal(artefact.kdf, "PBKDF2-SHA256");
    assert.equal(artefact.cipher, "AES-256-GCM");
    assert.equal(artefact.iterations, CHEAP.iterations);
    assert.ok(artefact.salt && artefact.iv && artefact.ciphertext);
  });

  it("leaves no trace of the token in what gets published", async () => {
    const published = JSON.stringify(await sealed());

    assert.ok(!published.includes(TOKEN));
    assert.ok(!published.includes(base64(TOKEN)));
    assert.ok(!published.includes(PASSPHRASE));
  });

  it("draws a new salt and iv each time, so two seals share nothing", async () => {
    const [first, second] = [await sealed(), await sealed()];

    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
  });

  it("refuses a passphrase short enough to be guessed offline", async () => {
    const tooWeak = /at least 4 separate words/;

    await refuses(seal(TOKEN, "hunter2", CHEAP), tooWeak);
    await refuses(seal(TOKEN, "only three words", CHEAP), tooWeak);
    await refuses(seal(TOKEN, "a b c d", CHEAP), tooWeak);
    await refuses(seal(TOKEN, "  ", CHEAP), tooWeak);
  });

  it("cannot be talked round by padding a short passphrase out", async () => {
    // The rule counts words, not characters, precisely so that this does not
    // work — length made of punctuation costs a guessing machine nothing.
    await refuses(seal(TOKEN, "a b c d!!!!!!!!!!!!!!!!", CHEAP), /at least 4 separate words/);
  });

  it("accepts four words in a language that writes them shortly", async () => {
    // A floor on total length would have failed this while passing four English
    // words of the same strength. The gallery is a Korean-speaking household's.
    const korean = "할머니 사진 올리는 열쇠";

    assert.equal(await unseal(await sealed(TOKEN, korean), korean), TOKEN);
  });

  it("refuses to seal nothing at all", async () => {
    await refuses(seal("", PASSPHRASE, CHEAP), /no token/);
  });

  it("is slow enough, at the count it actually ships with", async () => {
    // OWASP's 2023 floor for PBKDF2-HMAC-SHA256. A test rather than a comment,
    // so the number cannot be quietly lowered to make something else faster.
    assert.ok(ITERATIONS >= 600_000, `${ITERATIONS} is below the floor`);

    const artefact = await seal(TOKEN, PASSPHRASE);

    assert.equal(artefact.iterations, ITERATIONS);
    assert.equal(await unseal(artefact, PASSPHRASE), TOKEN);
  });
});

describe("unseal", () => {
  it("gives back the token to the passphrase it was sealed under", async () => {
    assert.equal(await unseal(await sealed(), PASSPHRASE), TOKEN);
  });

  it("opens an artefact sealed at a lower count than is current", async () => {
    // What keeps raising the iteration count from stranding every device that
    // was set up before: the artefact says how it was made, and that is obeyed.
    const artefact = await seal(TOKEN, PASSPHRASE, { iterations: 500 });

    assert.equal(artefact.iterations, 500);
    assert.equal(await unseal(artefact, PASSPHRASE), TOKEN);
  });

  it("refuses the wrong passphrase", async () => {
    await refuses(unseal(await sealed(), "wrong horse battery staple"), /did not unlock/);
  });

  it("says the same thing however the passphrase was wrong", async () => {
    // The artefact is public and can be guessed at forever, so a refusal must
    // not tell an attacker which part of a guess was closer.
    const artefact = await sealed();
    const complaints = await Promise.all(
      [
        "wrong horse battery staple",
        "correct horse battery stapler",
        "something else entirely again",
        PASSPHRASE.toUpperCase(),
      ].map((guess) => unseal(artefact, guess).catch((error) => error.message))
    );

    assert.equal(new Set(complaints).size, 1, complaints.join(" / "));
  });

  it("cannot tell a tampered artefact from a wrong passphrase", async () => {
    const artefact = await sealed();
    const wrong = await refuses(unseal(artefact, "wrong horse battery staple"), /did not unlock/);

    for (const field of ["ciphertext", "salt", "iv"]) {
      const error = await refuses(unseal(tampered(artefact, field), PASSPHRASE), /did not unlock/);
      assert.equal(error.message, wrong.message, `a tampered ${field} gave itself away`);
    }
  });

  it("treats a changed iteration count as a passphrase that does not work", async () => {
    const artefact = await sealed();

    await refuses(unseal({ ...artefact, iterations: 999 }, PASSPHRASE), /did not unlock/);
  });

  it("says an unreadable artefact is unreadable, not a bad passphrase", async () => {
    const artefact = await sealed();
    const unreadable = /cannot be read/;

    await refuses(unseal({ ...artefact, version: 2 }, PASSPHRASE), unreadable);
    await refuses(unseal({ ...artefact, kdf: "scrypt" }, PASSPHRASE), unreadable);
    await refuses(unseal({ ...artefact, cipher: "AES-256-CBC" }, PASSPHRASE), unreadable);
    await refuses(unseal({ ...artefact, ciphertext: undefined }, PASSPHRASE), unreadable);
    await refuses(unseal({ ...artefact, salt: "not base64!" }, PASSPHRASE), unreadable);
    await refuses(unseal({ ...artefact, iterations: "lots" }, PASSPHRASE), unreadable);
    await refuses(unseal({}, PASSPHRASE), unreadable);
    await refuses(unseal(null, PASSPHRASE), unreadable);
  });

  it("refuses an empty passphrase the same way it refuses a wrong one", async () => {
    await refuses(unseal(await sealed(), ""), /did not unlock/);
  });

  it("marks the unreadable case, and only that one, for the page to word", async () => {
    // The page says something different about an artefact it cannot read — that
    // is about the page being old, not about the passphrase — so it has to be
    // able to tell without matching on the wording.
    const artefact = await sealed();

    const unreadable = await refuses(unseal({}, PASSPHRASE), /cannot be read/);
    const wrong = await refuses(unseal(artefact, "nope nope nope nope"), /did not unlock/);

    assert.equal(unreadable.unreadable, true);
    assert.equal(wrong.unreadable, undefined);
  });
});

describe("loadSealedToken", () => {
  /** Node has no DOM, so `fetch` has to be installed rather than assigned. */
  function respondWith(handler) {
    const calls = [];
    Object.defineProperty(globalThis, "fetch", {
      value: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        const { status = 200, body = {}, unparseable = false } = (await handler()) ?? {};
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => {
            if (unparseable) throw new SyntaxError("Unexpected token < in JSON");
            return body;
          },
        };
      },
      configurable: true,
      writable: true,
    });
    return calls;
  }

  it("reads back an artefact that can then be unsealed", async () => {
    const published = await sealed();
    respondWith(() => ({ body: published }));

    assert.equal(await unseal(await loadSealedToken(), PASSPHRASE), TOKEN);
  });

  it("asks for a fresh copy, so a rotation is not hidden behind a cache", async () => {
    // Re-running the workflow replaces this file. A cached copy would refuse the
    // new passphrase and look exactly like the new passphrase being wrong.
    const calls = respondWith(() => ({ body: {} }));

    await loadSealedToken();

    assert.match(calls[0].url, /^sealed-token\.json\?/);
    assert.equal(calls[0].options.cache, "no-store");
  });

  it("finds none when the workflow has never been run", async () => {
    respondWith(() => ({ status: 404 }));

    assert.equal(await loadSealedToken(), null);
  });

  it("finds none when it cannot be fetched at all", async () => {
    Object.defineProperty(globalThis, "fetch", {
      value: async () => {
        throw new TypeError("offline");
      },
      configurable: true,
      writable: true,
    });

    assert.equal(await loadSealedToken(), null);
  });

  it("finds none when what came back is not JSON", async () => {
    respondWith(() => ({ unparseable: true }));

    assert.equal(await loadSealedToken(), null);
  });
});

describe("the sealing script", () => {
  const SCRIPT = new URL("../../.github/scripts/seal-token.js", import.meta.url).pathname;
  const run = promisify(execFile);

  /** Run the script as the workflow does, and hand back everything it emitted. */
  async function sealTokenScript(env) {
    const destination = join(await mkdtemp(join(tmpdir(), "grace-seal-")), "sealed-token.json");
    // A bare environment, so the surrounding shell cannot supply a secret the
    // test meant to leave out.
    const result = await run(process.execPath, [SCRIPT, destination], { env }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr })
    );
    const written = await readFile(destination, "utf8").catch(() => null);
    return { ...result, written };
  }

  it("publishes an artefact that opens, and prints neither secret", async () => {
    const { code, stdout, stderr, written } = await sealTokenScript({
      UPLOAD_TOKEN: TOKEN,
      UPLOAD_PASSPHRASE: PASSPHRASE,
    });

    assert.equal(code, 0, stderr);
    assert.equal(await unseal(JSON.parse(written), PASSPHRASE), TOKEN);

    // The build log of a public repository is public too.
    const printed = stdout + stderr;
    assert.ok(!printed.includes(TOKEN), printed);
    assert.ok(!printed.includes(PASSPHRASE), printed);
    assert.match(stdout, /PBKDF2-SHA256 at 2,000,000 iterations/);
  });

  it("writes nothing when a secret is missing or too weak", async () => {
    const missing = await sealTokenScript({ UPLOAD_PASSPHRASE: PASSPHRASE });
    assert.equal(missing.code, 1);
    assert.equal(missing.written, null);
    assert.match(missing.stderr, /UPLOAD_TOKEN is not set/);

    const weak = await sealTokenScript({ UPLOAD_TOKEN: TOKEN, UPLOAD_PASSPHRASE: "hunter2" });
    assert.equal(weak.code, 1);
    assert.equal(weak.written, null);
    assert.match(weak.stderr, /at least 4 separate words/);
    assert.ok(!(weak.stdout + weak.stderr).includes(TOKEN));
  });
});
