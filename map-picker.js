/**
 * A map you tap to say where something is.
 *
 * Two screens ask that question — naming a place, and fixing where one photo was
 * taken — and both used to ask it as two boxes wanting a latitude and a
 * longitude. This is the same question asked the way a phone can answer it: here
 * is the map, put the pin on the house.
 *
 * The fields stay, and stay the truth: a tap writes into them, and what is saved
 * is what they hold. That is what keeps the map an aid rather than a second way
 * of saying the same thing — and what leaves a coordinate that really is known
 * to a metre typeable, by somebody who has it written down.
 *
 * Where a tap goes and where the map opens are in map-point.js, tested there.
 * This is Leaflet, a browser, and somebody's thumb.
 */

import { t } from "./language.js";
import { OSM_OPTIONS, OSM_TILES } from "./map-tiles.js";

/** How close in to go when the phone says where it is: it knows to a few metres. */
const LOCATED = 17;

/** A radius as a number of metres, or null for a field holding nothing usable. */
function metres(value) {
  const given = Number(value);
  return Number.isFinite(given) && given > 0 ? given : null;
}

const GEOLOCATION = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 };

/**
 * Put a picker in `container`, looking at `view` (from `openingView`).
 *
 * `onPick` is handed every point chosen — by a tap, by dragging the pin, or by
 * the phone saying where it is. `radiusM`, where it is given, draws the circle a
 * named place covers, so it can be seen whether the house is inside it.
 *
 * Answers with the handful of things the page needs to do to it afterwards, or
 * null where there is no Leaflet to draw with — a map is worth having and not
 * worth an error message, and the fields underneath still work.
 */
export function createPicker(container, { view, radiusM = null, onPick }) {
  if (typeof L === "undefined") {
    container.textContent = t("gallery.map.unavailable");
    return null;
  }

  const map = L.map(container, { scrollWheelZoom: false });
  L.tileLayer(OSM_TILES, OSM_OPTIONS).addTo(map);
  if (view.center) map.setView(view.center, view.zoom);
  else map.fitWorld();

  let pin = null;
  let ring = null;
  let radius = metres(radiusM);

  /**
   * Move the pin, keep the circle under it, and — unless this is the map simply
   * opening on what is already known — tell the page it was chosen.
   *
   * That exception is the whole difference between a map that shows where a
   * photo says it was taken and one that answers for it. The fields hold
   * corrections and nothing else, so merely opening the map must not write the
   * photo's own coordinates into them: that would turn a look into a correction
   * pinning those values for good, and leave emptying the fields meaning
   * nothing.
   */
  function choose(point, { tell = true } = {}) {
    const at = [point.lat, point.lon];

    if (pin) pin.setLatLng(at);
    else {
      pin = L.marker(at, { draggable: true, autoPan: true }).addTo(map);
      pin.on("dragend", () => {
        const dragged = pin.getLatLng();
        choose({ lat: dragged.lat, lon: dragged.lng });
      });
    }

    if (radius !== null) {
      if (ring) ring.setLatLng(at);
      else ring = L.circle(at, { radius, className: "picker-ring" }).addTo(map);
    }

    if (tell) onPick(point);
  }

  if (view.marker && view.center) {
    choose({ lat: view.center[0], lon: view.center[1] }, { tell: false });
  }

  map.on("click", (event) => choose({ lat: event.latlng.lat, lon: event.latlng.lng }));

  return {
    /** The circle a named place covers, as the radius field is typed into. */
    setRadius(given) {
      radius = metres(given);
      if (ring && radius === null) {
        ring.remove();
        ring = null;
      } else if (ring) ring.setRadius(radius);
      else if (pin && radius !== null) {
        ring = L.circle(pin.getLatLng(), { radius, className: "picker-ring" }).addTo(map);
      }
    },

    /**
     * Where the phone says it is. Answers with the point, or throws — the page
     * words the refusal, because only the page knows what it was for.
     *
     * Worth the permission prompt: the commonest thing being named is the house
     * the phone is standing in.
     */
    locate() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("no geolocation"));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            const point = { lat: coords.latitude, lon: coords.longitude };
            map.setView([point.lat, point.lon], LOCATED);
            choose(point);
            resolve(point);
          },
          (refused) => reject(refused),
          GEOLOCATION
        );
      });
    },

    /**
     * Take the pin and the circle off again, for when the fields they were
     * mirroring have been emptied — a place just saved, say. Left on, the pin
     * would sit confidently on the last house while the fields under it say
     * nothing, and the next place named would start from someone else's garden.
     */
    clear() {
      pin?.remove();
      ring?.remove();
      pin = null;
      ring = null;
    },

    /** Leaflet measures the container as it is created, so a map that was hidden then needs this. */
    refresh: () => map.invalidateSize(),

    /** A screen being thrown away takes its maps with it, or they leak. */
    destroy: () => map.remove(),
  };
}
