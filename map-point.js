/**
 * Points on a map, as the corrections file and a Leaflet map each want them.
 *
 * Naming a place — "할머니집" — is the one thing on the upload page that asked
 * for something nobody knows: a latitude and a longitude, typed into two boxes,
 * with a mistyped digit putting a photo in the Yellow Sea and saying nothing
 * about it. The fix is a map to tap, and this is the arithmetic either side of
 * the tap: what it becomes in the file, and where the map should be looking when
 * it opens.
 *
 * Where it opens is the part that decides whether this is any better than
 * typing. A map that opens on the whole world is four pinches from anywhere,
 * so it opens on the best guess the site can make from what it already knows —
 * the photo's own location, or the last place the family was photographed.
 *
 * It lives apart from map-picker.js, which is Leaflet and a browser, so all of
 * that can be tested without either.
 */

/**
 * Decimal places kept. The fifth is about a metre — finer than a fingertip on a
 * phone, and short enough that the file stays readable to the person who also
 * edits it by hand.
 */
export const PRECISION = 5;

/** How close in to open on a point somebody has actually chosen. */
const CLOSE = 16;

/** And on a guess: the right part of the world, without pretending to more. */
const NEARBY = 13;

/**
 * One coordinate as a number, or null for anything that is not one — a blank
 * field, or a word. Rounded, so that a tap's seventeen digits do not end up in a
 * file that people read.
 */
export function roundCoordinate(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;

  const number = Number(value);
  if (Number.isNaN(number)) return null;
  // Through Number again: toFixed pads, and 37.45 should stay 37.45.
  return Number(number.toFixed(PRECISION));
}

/**
 * The point a pair of fields holds, or null when they do not hold one.
 *
 * Both or neither: the pipeline ignores a latitude with no longitude, so half a
 * point is not a point, and a map must not put a pin on one.
 */
export function pointFrom(latText, lonText) {
  const lat = roundCoordinate(latText);
  const lon = roundCoordinate(lonText);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** A point as the two fields hold it, for writing a tap back into them. */
export const pointText = ({ lat, lon }) => ({
  lat: String(roundCoordinate(lat)),
  lon: String(roundCoordinate(lon)),
});

/**
 * Where to open the map, given everything that might hint at it: the `point` the
 * fields already hold, the `photo` being fixed, and `nearby` — anything else with
 * a location, best hint first.
 *
 * `marker` is the difference between a decision and a guess. A point that was
 * chosen — by a tap, or by the photo's own metadata — gets a pin, because that
 * is where the place is. A guess gets none: a pin on a guess would read as an
 * answer, and saving it would move a photo to whatever the map happened to open
 * on.
 *
 * The order of `nearby` is the caller's judgement of what is the better guess,
 * and the first entry that knows where it is wins. Anything at all can be in it,
 * so long as it has a lat and a lon: a photo, a place already named, a
 * correction saved a moment ago.
 */
export function openingView({ point, photo, nearby = [] } = {}) {
  const chosen = point ?? locationOf(photo);
  if (chosen) return { center: [chosen.lat, chosen.lon], zoom: CLOSE, marker: true };

  const guess = nearby.map(locationOf).find(Boolean);
  if (guess) return { center: [guess.lat, guess.lon], zoom: NEARBY, marker: false };

  return { center: null, zoom: null, marker: false };
}

/** Where something says it is, or null — anything at all may be missing one. */
function locationOf(thing) {
  return thing ? pointFrom(thing.lat, thing.lon) : null;
}
