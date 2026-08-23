/**
 * The upload token, locked under a passphrase, in a form that is safe to publish
 * on a site anyone can read.
 *
 * A workflow seals the token — the token and the passphrase live as repository
 * secrets, never in the repository — and commits only the sealed result. A
 * device being set up fetches that, asks for the passphrase, and unseals it
 * here, in the browser. There is no server, so there is nothing to ask.
 *
 * The consequence, stated plainly because everything else follows from it: this
 * repository is public, so the sealed token is downloadable by anyone and can be
 * guessed at offline, forever, with nothing to rate-limit it and no way to
 * notice it happening. That is why {@link seal} insists on a multi-word
 * passphrase and why the key derivation is deliberately expensive.
 *
 * Both sides run this same module — the workflow on Node, the page in the
 * browser — over WebCrypto, which both have. Sharing the code is what keeps the
 * two ends agreeing about the format. {@link loadSealedToken} is the one part
 * only the page uses; it is here because where the artefact is published is as
 * much a fact about it as how it is made.
 */

/* ------------------------------------------------------------- parameters */

const VERSION = 1;
const KDF = "PBKDF2-SHA256";
const CIPHER = "AES-256-GCM";

const SALT_BYTES = 16;
const IV_BYTES = 12; // what AES-GCM is specified around
const KEY_BITS = 256;

/**
 * How hard one guess is made to be.
 *
 * Measured: 2,000,000 iterations is ~0.16 s of native PBKDF2 on a laptop, so a
 * few times that on a phone — under a second, once, on the day a device is set
 * up. OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 600,000; a third of the work
 * would not make that once-ever pause noticeably shorter, so there is no reason
 * to sit at the floor.
 *
 * Why not far higher, given the ciphertext is public? Because PBKDF2 costs an
 * attacker no memory, only arithmetic, and their GPUs parallelise where a
 * phone's single derivation cannot. At this count a good GPU manages a few
 * thousand guesses a second. Going to twenty million costs the phone six seconds
 * and buys a factor of ten; adding one word to the passphrase costs nothing and
 * buys a factor of several thousand. So the iteration count is set where it
 * stops being felt, and the passphrase is where the security actually lives:
 * four words off a real word list is some 10^15 guesses — tens of thousands of
 * GPU-years — while a short password of the kind people pick unaided falls in
 * days. Hence the refusal below rather than a note in the documentation.
 */
export const ITERATIONS = 2_000_000;

const MIN_WORDS = 4;

// Enough to tell a word from a letter, and no more. A floor on the *total*
// length would have been the obvious rule and is the wrong one: four Korean
// words run to about half the characters of four English ones, so a total-length
// floor quietly demands more words of some languages than of others.
const MIN_WORD_CHARACTERS = 2;

// Every way of failing to open the artefact says one of exactly two things: it
// is not something this page knows how to read, or the passphrase did not work.
// A wrong passphrase, a tampered ciphertext and a doctored salt all land on the
// second — nothing gives an attacker a hint as to which part of a guess was
// closer.
const UNREADABLE = "the published token cannot be read by this page";
const WRONG_PASSPHRASE = "that passphrase did not unlock the token";

/**
 * An artefact this page cannot make sense of is not a passphrase problem, and
 * the page says something else about it — so it is flagged rather than left to
 * be recognised by its wording.
 */
function unreadable() {
  const error = new Error(UNREADABLE);
  error.unreadable = true;
  return error;
}

/* ----------------------------------------------------------------- base64 */

// A token is under a hundred bytes, so neither of these needs to be careful
// about argument-count limits the way github.js has to be for photos.

const toBase64 = (raw) => btoa(String.fromCharCode(...raw));

function fromBase64(text) {
  if (typeof text !== "string") throw unreadable();
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  } catch {
    throw unreadable();
  }
}

/* ------------------------------------------------------------- passphrase */

/**
 * The bytes to derive from.
 *
 * Trimmed and normalised on both sides by the same code, so a passphrase set as
 * a repository secret with a stray newline, or typed on a phone whose keyboard
 * composes Hangul differently from wherever the secret was written, still opens
 * the token it was meant to open.
 */
const passphraseBytes = (passphrase) =>
  new TextEncoder().encode(String(passphrase ?? "").trim().normalize("NFC"));

/**
 * Why this passphrase is not good enough to publish a token under, or `null`
 * when it is. Only sealing asks: a device being set up has to accept whatever
 * the token was actually sealed with.
 */
function complaint(passphrase) {
  const words = String(passphrase ?? "").trim().split(/\s+/).filter(Boolean);
  // Counted in code points, so a rule about how long a word is means the same
  // thing in every script.
  const isWord = (word) => [...word].length >= MIN_WORD_CHARACTERS;

  if (words.length < MIN_WORDS || !words.every(isWord)) {
    // Says what is wanted and why in the same breath. Told only a number,
    // someone pads a short password out until they reach it — which is why
    // the rule counts words rather than length: the guessing is done by
    // machine, and what costs it time is how many words there were to combine,
    // never how many characters they came to.
    return (
      `the passphrase must be at least ${MIN_WORDS} separate words of ` +
      `${MIN_WORD_CHARACTERS} or more characters — ordinary words, not one short password ` +
      "padded out to look longer. The sealed token is public and is guessed at offline by " +
      "machine, where padding buys nothing and each further word buys a great deal"
    );
  }
  return null;
}

/* --------------------------------------------------------------- the lock */

async function deriveKey(passphrase, salt, iterations, usage) {
  const material = await crypto.subtle.importKey("raw", passphraseBytes(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    [usage]
  );
}

/**
 * Lock `token` under `passphrase`, as the object to publish.
 *
 * A fresh salt and iv every time, so re-running the workflow with the same
 * secrets shares nothing with what it published last time. `iterations` is
 * recorded in the result rather than assumed, so raising {@link ITERATIONS}
 * later does not strand an artefact made before the change.
 */
export async function seal(token, passphrase, { iterations = ITERATIONS } = {}) {
  if (!String(token ?? "").trim()) throw new Error("there is no token to seal");

  const refusal = complaint(passphrase);
  if (refusal) throw new Error(refusal);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, iterations, "encrypt");
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(String(token).trim())
  );

  return {
    version: VERSION,
    kdf: KDF,
    cipher: CIPHER,
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(sealed)),
  };
}

/**
 * The token back out of `sealed`, given the passphrase it was sealed under.
 *
 * Says the artefact "cannot be read" when this version cannot make sense of it —
 * a format from the future, a field that is missing or is not base64 — and that
 * the passphrase "did not unlock the token" for everything else, which is to say
 * for every way a well-formed artefact can fail to open.
 */
export async function unseal(sealed, passphrase) {
  const artefact = sealed ?? {};
  const readable =
    artefact.version === VERSION &&
    artefact.kdf === KDF &&
    artefact.cipher === CIPHER &&
    Number.isInteger(artefact.iterations) &&
    artefact.iterations > 0;
  if (!readable) throw unreadable();

  const salt = fromBase64(artefact.salt);
  const iv = fromBase64(artefact.iv);
  const ciphertext = fromBase64(artefact.ciphertext);

  try {
    const key = await deriveKey(passphrase, salt, artefact.iterations, "decrypt");
    const token = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(token);
  } catch {
    // AES-GCM authenticates what it decrypts, so a wrong key and a changed byte
    // fail identically — and are reported identically on purpose.
    throw new Error(WRONG_PASSPHRASE);
  }
}

/* ------------------------------------------------------------- the page's */

/** Where the workflow publishes it, alongside the rest of the site. */
const PUBLISHED = "sealed-token.json";

/**
 * The sealed token as published, or `null` when there is not one.
 *
 * No sealed token is the ordinary case, not an error: it only exists once the
 * owner has chosen to run the workflow, and the page simply does not offer a
 * passphrase without it. A site that never had one, a network that is down and
 * a file that will not parse all come to the same nothing — someone standing in
 * front of an empty upload page can do nothing with the news that a fetch
 * failed, and the token entry below it still works.
 */
export async function loadSealedToken() {
  try {
    // Never from the cache. Re-running the workflow replaces this file, and a
    // stale copy would refuse the new passphrase in a way indistinguishable
    // from the new passphrase being wrong.
    const response = await fetch(`${PUBLISHED}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    return await response.json();
  } catch {
    return null;
  }
}
