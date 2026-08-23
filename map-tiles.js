/**
 * The map both pages draw on: OpenStreetMap's own tiles, which need no key and
 * cost nothing.
 *
 * Said once, because it is said in two places now — the gallery's map of where
 * the photos were taken, and the picker on the upload page for saying where one
 * was — and the attribution is a condition of using them, not a decoration.
 */

export const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export const OSM_OPTIONS = {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};
