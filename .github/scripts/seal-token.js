/**
 * Seal the upload token under the passphrase, for the workflow to publish.
 *
 * Both secrets arrive in the environment and leave in nothing: the only thing
 * written is the sealed artefact, and the only thing printed is a line about
 * the parameters it was sealed with. There is no code path here that puts
 * either secret on stdout, on stderr, or into a filename.
 *
 * The sealing itself is sealed-token.js — the same module the upload page runs.
 * The two ends cannot drift apart about the format, because there is only one.
 *
 *   node .github/scripts/seal-token.js sealed-token.json
 */

import { writeFile } from "node:fs/promises";

import { seal, unseal } from "../../sealed-token.js";

const [, , destination] = process.argv;

function refuse(message) {
  console.error(message);
  process.exit(1);
}

if (!destination) refuse("Usage: node .github/scripts/seal-token.js <destination>");

const token = process.env.UPLOAD_TOKEN;
const passphrase = process.env.UPLOAD_PASSPHRASE;

if (!token?.trim()) refuse("UPLOAD_TOKEN is not set. Add it as a repository secret.");
if (!passphrase?.trim()) refuse("UPLOAD_PASSPHRASE is not set. Add it as a repository secret.");

const sealed = await seal(token, passphrase).catch((error) => refuse(error.message));

// Open it again before publishing it. A device being set up gets one shot at
// this — there is no server to ask — so an artefact nobody can unseal should
// fail the workflow, not sit on the site waiting to be discovered by hand.
const opened = await unseal(sealed, passphrase).catch(() => null);
if (opened !== token.trim()) refuse("The sealed token did not open again. Nothing was written.");

await writeFile(destination, `${JSON.stringify(sealed, null, 2)}\n`);

console.log(
  `Sealed the upload token into ${destination}: ` +
    `${sealed.kdf} at ${sealed.iterations.toLocaleString("en-US")} iterations, ${sealed.cipher}.`
);
