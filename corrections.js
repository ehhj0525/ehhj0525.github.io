/**
 * overrides.json — the owner's corrections — as something a screen can edit.
 *
 * The file is hand-edited as often as it is edited by a screen, and the pipeline
 * re-applies it on every build, so everything here is a merge: one photo's
 * fields are changed and nothing else in the file is, down to the keys this
 * module has never heard of. Clearing a field removes it rather than writing
 * null, because an absent field is what makes the photo fall back to its own
 * metadata again.
 *
 * The editing is pure text in, text out, so it can be tested without a browser
 * and re-run against fresh contents when a save collides with another one.
 */

import { t } from "./language.js";
import { loadPhotos } from "./manifest.js";

/** The corrections file, at the root of the repository. */
export const CORRECTIONS_PATH = "overrides.json";

/** What the pipeline assumes a named place covers when it is not told. */
export const DEFAULT_RADIUS_M = 150;

/** How many photos the screen offers — a phone is a poor place to scroll a thousand. */
export const RECENT_PHOTOS = 30;

// The fields of a photo correction. Coordinates are one field in two halves:
// the pipeline ignores a latitude without a longitude, so they move together.
const COORDINATES = ["lat", "lon"];

// The pipeline reads dates with Python's fromisoformat, and the date picker
// hands over "2025-12-25T08:00" — a plain date is allowed for hand-typing.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

/** The two containers this module writes into, as a file nobody has written holds them. */
const blank = () => ({ photos: {}, places: [] });

const isBlank = (value) =>
  value === null || value === undefined || (typeof value === "string" && !value.trim());

/** How the pipeline writes JSON, so a hand-editor sees no reformatting. */
const serialise = (document) => JSON.stringify(document, null, 2) + "\n";

function parse(text) {
  if (isBlank(text)) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(t("corrections.invalidJson", { file: CORRECTIONS_PATH, reason: error.message }));
  }
}

/**
 * The corrections a file holds: `{ photos, places }`, both present even when
 * the file is missing or only says half of it.
 */
export function readCorrections(text) {
  const document = parse(text);
  return {
    photos: isPlain(document.photos) ? document.photos : {},
    places: Array.isArray(document.places) ? document.places : [],
  };
}

/**
 * The photos to offer the screen.
 *
 * Read from the published manifest rather than through GitHub: it is the same
 * file the gallery renders, and the thumbnails come from the site anyway. A
 * build that has not run yet is not an error to report, only an empty screen.
 */
export const loadRecentPhotos = async () => mostRecentlyAdded(await loadPhotos());

/**
 * The photos added most recently, listed in the manifest's own order.
 *
 * Added, not taken: on this screen "recent" means recently uploaded. An old
 * photo scanned in and uploaded today sorts by 1998 on the timeline, below
 * everything — and it is precisely the photo whose place wants naming, with no
 * other way to name it but hand-editing the file this screen exists to replace.
 *
 * Which ones is all that the upload date decides. They are shown newest-taken
 * first, as the manifest holds them, because that is the order the photos are
 * recognisable in.
 */
function mostRecentlyAdded(photos) {
  // Both dates are ISO and of the same shape, so they order as text. A manifest
  // written before uploadedAt existed still sorts, by when the photo was taken.
  const added = (photo) => photo.uploadedAt ?? photo.takenAt ?? "";

  const chosen = new Set(
    [...photos].sort((one, other) => added(other).localeCompare(added(one))).slice(0, RECENT_PHOTOS)
  );
  return photos.filter((photo) => chosen.has(photo));
}

/**
 * The corrections as they stand on the branch.
 *
 * Through GitHub, not off the site: this file changes as it is saved, and a
 * published copy can be minutes behind, which would show a field as empty that
 * was filled in a moment ago.
 */
export async function loadCorrections(github) {
  const found = await github.readFile(CORRECTIONS_PATH);
  return readCorrections(found?.text);
}

/**
 * The correction that applies to one photo of the manifest, or `{}`. A hash
 * override is more specific than a filename one, so it wins — the same order
 * the pipeline resolves them in.
 */
export function correctionFor(corrections, photo) {
  return corrections.photos[photo.hash] ?? corrections.photos[photo.name] ?? {};
}

/**
 * Which key to save a photo's correction under.
 *
 * The one that already carries a correction, so a hand edit keyed by filename
 * goes on being the correction rather than being quietly shadowed by a second
 * entry under the hash. Failing that, the hash: it survives a rename, and the
 * pipeline prefers it anyway.
 */
export function keyFor(corrections, photo) {
  if (photo.hash in corrections.photos) return photo.hash;
  return photo.name in corrections.photos ? photo.name : photo.hash;
}

/**
 * Whether all the pipeline could do was fall back to the day the photo was
 * uploaded. It records that as it builds the manifest; it is not something to
 * infer from the dates afterwards.
 */
export const dateIsGuessed = (photo) => Boolean(photo.dateFallback);

/**
 * A date as a `datetime-local` field holds it, to the minute. The manifest
 * keeps seconds and the field does not, so trimming here is what lets a date
 * shown in the field be saved back unchanged.
 */
export const forDateInput = (value) => (value ? String(value).slice(0, 16) : "");

/**
 * The file with one photo's correction changed. `fields` may name any of
 * `takenAt`, `lat`, `lon` and `place`; a blank value clears that field, and a
 * photo left with nothing to say drops out of the file entirely.
 */
export function applyCorrection(text, key, fields) {
  const changes = photoChanges(fields);

  return edit(text, (document) => {
    const photos = container(document, "photos");
    const entry = { ...photos[key] };

    for (const [field, value] of changes) {
      if (value === undefined) delete entry[field];
      else entry[field] = value;
    }

    if (Object.keys(entry).length) photos[key] = entry;
    else delete photos[key];
  });
}

/**
 * The file with one more named place in it — every photo within `radiusM`
 * metres of the point is labelled `name`. Naming a place that is already named
 * moves it rather than listing it twice.
 */
export function addPlace(text, place) {
  const name = String(place.name ?? "").trim();
  if (!name) throw new Error(t("corrections.placeNeedsName"));

  const named = {
    name,
    lat: coordinate(place.lat, "lat"),
    lon: coordinate(place.lon, "lon"),
    radiusM: radius(place.radiusM),
  };

  return edit(text, (document) => {
    const places = container(document, "places");
    const existing = places.findIndex((other) => other.name?.trim() === named.name);

    if (existing === -1) places.push(named);
    else places[existing] = { ...places[existing], ...named };
  });
}

/**
 * Commit a photo's correction, and hand back the file as it was committed.
 *
 * The merge is handed to `writeFile` as a function rather than as finished
 * text, so that a write which loses a race and is retried merges again — into
 * whatever is on the branch by then, including a correction that landed in the
 * meantime. Which is also why the file comes back from here: the screen has to
 * redraw from the merge that landed, not from the one it set out to make.
 */
export const saveCorrection = (github, key, fields) =>
  commit(github, `fix: ${key}`, (current) => applyCorrection(current, key, fields));

/** Commit a named place, merging the same way {@link saveCorrection} does. */
export const savePlace = (github, place) =>
  commit(github, `place: ${String(place.name ?? "").trim()}`, (current) => addPlace(current, place));

async function commit(github, message, merge) {
  let committed;
  await github.writeFile(CORRECTIONS_PATH, {
    text: (current) => {
      committed = merge(current);
      return committed;
    },
    message,
  });
  return committed;
}

/* ------------------------------------------------------------------ editing */

const isPlain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Parse, change, and write back — leaving every key the change did not touch. */
function edit(text, change) {
  const parsed = parse(text);
  const document = Object.keys(parsed).length ? parsed : blank();
  change(document);
  return serialise(document);
}

/**
 * The `photos` object or the `places` array, added if the file has never had
 * one. A hand edit that left something else there is refused rather than
 * written over — that file needs a person, not a save.
 */
function container(document, name) {
  if (!(name in document)) document[name] = blank()[name];

  const held = document[name];
  const intact = name === "places" ? Array.isArray(held) : isPlain(held);
  if (!intact) throw new Error(t("corrections.unusable", { file: CORRECTIONS_PATH, container: name }));
  return held;
}

/** Each field to set, or `undefined` for each field to remove. */
function photoChanges(fields) {
  const changes = [];

  if ("takenAt" in fields) {
    changes.push(["takenAt", isBlank(fields.takenAt) ? undefined : date(fields.takenAt)]);
  }
  if (COORDINATES.some((field) => field in fields)) {
    const given = COORDINATES.map((field) => (field in fields ? fields[field] : undefined));
    const cleared = given.some(isBlank);
    COORDINATES.forEach((field, index) => {
      changes.push([field, cleared ? undefined : coordinate(given[index], field)]);
    });
  }
  if ("place" in fields) {
    changes.push(["place", isBlank(fields.place) ? undefined : String(fields.place).trim()]);
  }
  return changes;
}

/* --------------------------------------------------------------- validating */

// The name of the field is looked up as the complaint is made, not as this is
// read: the page settles on a language after the modules have loaded.
const LIMITS = {
  lat: [-90, 90, "corrections.latitude"],
  lon: [-180, 180, "corrections.longitude"],
};

function coordinate(value, axis) {
  const [low, high, key] = LIMITS[axis];
  const field = t(key);
  if (isBlank(value)) throw new Error(t("corrections.needsNumber", { field }));

  const number = Number(value);
  if (Number.isNaN(number)) throw new Error(t("corrections.notANumber", { value, field }));
  if (number < low || number > high) throw new Error(t("corrections.outOfRange", { field, low, high }));
  return number;
}

function date(value) {
  const given = String(value).trim();
  if (!ISO_DATE.test(given) || Number.isNaN(Date.parse(given))) {
    throw new Error(t("corrections.notADate", { value }));
  }
  return given;
}

function radius(value) {
  if (isBlank(value)) return DEFAULT_RADIUS_M;

  const metres = Number(value);
  if (Number.isNaN(metres) || metres <= 0) throw new Error(t("corrections.needsRadius"));
  return metres;
}
