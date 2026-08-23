/**
 * The gallery. Reads photos.json (built by the pipeline) and renders it two ways:
 * a month-by-month timeline, and a map of where the photos were taken.
 */

import { loadConfig } from "./config.js";
import { ageLabel, formatDate, monthHeading } from "./dates.js";
import { t, useLanguage } from "./language.js";
import { indexOfPhoto, photoIdFromUrl, urlForPhoto, urlWithoutPhoto } from "./photo-url.js";
import { translatePage } from "./translate-page.js";

const state = {
  photos: [], // newest first — the order the lightbox steps through
  config: {}, // config.json, once it has been read — see config.js for the defaults
  index: 0,
  map: null,
  scrollY: 0, // where the timeline was when the open photo was opened from it
  dismissing: false, // a close is in flight, waiting on popstate
};

const el = {
  title: document.getElementById("site-title"),
  timeline: document.getElementById("timeline"),
  mapPanel: document.getElementById("map-panel"),
  map: document.getElementById("map"),
  mapNote: document.getElementById("map-note"),
  status: document.getElementById("status"),
  tabs: { timeline: document.getElementById("tab-timeline"), map: document.getElementById("tab-map") },
  lightbox: document.getElementById("lightbox"),
  lightboxImage: document.getElementById("lightbox-image"),
  lightboxCaption: document.getElementById("lightbox-caption"),
};

/* ---------------------------------------------------------------- loading */

/** Every photo the last build knew about, or none at all if it cannot be read. */
async function loadManifest() {
  try {
    // GitHub Pages caches aggressively; a fresh upload should show up immediately.
    const response = await fetch(`photos.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    return await response.json();
  } catch {
    return { photos: [] };
  }
}

async function start() {
  const [config, manifest] = await Promise.all([loadConfig(), loadManifest()]);

  state.config = config;
  state.photos = manifest.photos ?? [];
  document.title = state.config.title;
  el.title.textContent = state.config.title;

  // Before anything is drawn: everything below reads the language as it writes.
  useLanguage(state.config.language);
  translatePage();

  renderTimeline();
  wireTabs();
  wireLightbox();
  openFromUrl();
}

/* --------------------------------------------------------------- timeline */

function renderTimeline() {
  if (state.photos.length === 0) {
    el.status.textContent = t("gallery.empty");
    return;
  }
  el.status.remove();

  const fragment = document.createDocumentFragment();
  for (const [month, photos] of groupByMonth(state.photos)) {
    fragment.append(monthSection(month, photos));
  }
  el.timeline.append(fragment);
}

function groupByMonth(photos) {
  const months = new Map();
  for (const photo of photos) {
    const key = photo.takenAt.slice(0, 7); // "2026-08"
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(photo);
  }
  return months; // insertion order — photos.json is already newest first
}

function monthSection(month, photos) {
  const section = document.createElement("section");
  section.className = "month";

  const header = document.createElement("div");
  header.className = "month-header";

  const heading = document.createElement("h2");
  heading.textContent = monthHeading(month);
  header.append(heading);

  const age = ageLabel(state.config.birthDate, `${month}-15`);
  if (age) {
    const badge = document.createElement("span");
    badge.className = "age-badge";
    badge.textContent = age;
    header.append(badge);
  }

  const grid = document.createElement("div");
  grid.className = "grid";
  for (const photo of photos) grid.append(tile(photo));

  section.append(header, grid);
  return section;
}

/** What a screen reader is given instead of the photo, said once for both views. */
const altFor = (photo) => (photo.place ? t("gallery.photoIn", { place: photo.place }) : t("gallery.photo"));

function tile(photo) {
  const button = document.createElement("button");
  button.className = "tile";
  button.type = "button";

  const image = document.createElement("img");
  image.src = photo.thumb;
  image.alt = altFor(photo);
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("load", () => image.classList.add("loaded"));
  if (image.complete) image.classList.add("loaded");
  button.append(image);

  if (photo.place) {
    const place = document.createElement("span");
    place.className = "place";
    place.textContent = photo.place;
    button.append(place);
  }

  button.addEventListener("click", () => openPhoto(state.photos.indexOf(photo)));
  return button;
}

/* -------------------------------------------------------------------- map */

function wireTabs() {
  el.tabs.timeline.addEventListener("click", () => showView("timeline"));
  el.tabs.map.addEventListener("click", () => showView("map"));
}

function showView(view) {
  const onMap = view === "map";
  el.tabs.map.setAttribute("aria-selected", String(onMap));
  el.tabs.timeline.setAttribute("aria-selected", String(!onMap));
  el.mapPanel.hidden = !onMap;
  el.timeline.hidden = onMap;
  if (onMap) renderMap();
}

function renderMap() {
  if (state.map) {
    state.map.invalidateSize(); // the container was hidden when Leaflet measured it
    return;
  }
  if (typeof L === "undefined") {
    el.map.textContent = t("gallery.map.unavailable");
    return;
  }

  const located = state.photos.filter((photo) => photo.lat != null && photo.lon != null);
  if (located.length === 0) {
    el.map.textContent = t("gallery.map.none");
    return;
  }

  state.map = L.map(el.map, { scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  const layer = typeof L.markerClusterGroup === "function" ? L.markerClusterGroup() : L.layerGroup();
  for (const photo of located) {
    layer.addLayer(L.marker([photo.lat, photo.lon]).bindPopup(() => popup(photo)));
  }
  state.map.addLayer(layer);
  state.map.fitBounds(L.latLngBounds(located.map((photo) => [photo.lat, photo.lon])).pad(0.2));

  const missing = state.photos.length - located.length;
  if (missing > 0) {
    el.mapNote.textContent = t("gallery.map.missing", { count: missing });
    el.mapNote.hidden = false;
  }
}

function popup(photo) {
  const container = document.createElement("div");
  const image = document.createElement("img");
  image.src = photo.thumb;
  image.alt = "";
  image.addEventListener("click", () => openPhoto(state.photos.indexOf(photo)));

  const caption = document.createElement("div");
  caption.className = "popup-caption";
  caption.textContent = [photo.place, formatDate(photo.takenAt)].filter(Boolean).join(" · ");

  container.append(image, caption);
  return container;
}

/* --------------------------------------------------------------- lightbox */

/*
 * An open photo is a place of its own: it names itself in the address bar and
 * owns exactly one history entry, so the phone's back gesture closes it instead
 * of leaving the site, and the link can be passed around. Stepping between
 * photos rewrites that one entry rather than stacking up more — otherwise
 * escaping the lightbox would cost one back press per photo looked at.
 *
 * The URL is the truth about which photo is open. Everything that opens or
 * closes one goes through history, and the popstate handler below is what
 * actually shows and hides the lightbox.
 */

function openPhoto(index) {
  const photo = state.photos[index];
  if (!photo) return;

  state.scrollY = window.scrollY;
  // Where the timeline is now, written onto the entry we are about to leave, so
  // that coming back to it lands where the visitor left off.
  history.replaceState({ ...history.state, scrollY: state.scrollY }, "");
  history.pushState({ photo: photo.hash }, "", urlForPhoto(photo.hash, location.href));
  showPhoto(index);
}

function stepPhoto(delta) {
  const count = state.photos.length;
  const index = (state.index + delta + count) % count;
  const { hash } = state.photos[index];

  history.replaceState({ photo: hash }, "", urlForPhoto(hash, location.href));
  showPhoto(index);
}

/** The ✕, Escape and a tap on the backdrop all go back, so history stays clean. */
function dismissPhoto() {
  // popstate arrives a beat later, so a double-tap on ✕ would otherwise go back
  // twice and leave the site.
  if (el.lightbox.hidden || state.dismissing) return;
  state.dismissing = true;
  history.back(); // which lands in onPopState, and that does the closing
}

/**
 * A link straight to a photo. The entry the link arrived on becomes the
 * timeline, and the photo is opened on top of it in the ordinary way — so back
 * closes the photo rather than sending the visitor back to the chat app.
 */
function openFromUrl() {
  const id = photoIdFromUrl(location.href);
  if (!id) return;

  // With no manifest there is no telling a deleted photo from one we simply
  // failed to fetch, and rewriting the address bar would throw away the only
  // copy of the link the visitor was sent. Leave it be; a reload can retry.
  if (state.photos.length === 0) return;

  const index = indexOfPhoto(state.photos, id);
  history.replaceState(null, "", urlWithoutPhoto(location.href));
  // A link to a photo that is no longer here just shows the timeline, quietly.
  if (index >= 0) openPhoto(index);
}

function onPopState() {
  state.dismissing = false;
  const index = indexOfPhoto(state.photos, photoIdFromUrl(location.href));
  if (index < 0) hidePhoto();
  else showPhoto(index);
}

function hidePhoto() {
  if (el.lightbox.hidden) return;
  el.lightbox.hidden = true;
  el.lightboxImage.removeAttribute("src");
  document.body.style.overflow = "";
  // Locking the body's scroll can lose the timeline's place; put it back. The
  // entry knows it when we arrive by going back; the field covers arriving any
  // other way, such as forward out of a photo.
  window.scrollTo(0, history.state?.scrollY ?? state.scrollY);
}

function showPhoto(index) {
  state.index = index;
  const photo = state.photos[index];
  el.lightboxImage.src = photo.web;
  el.lightboxImage.alt = altFor(photo);

  const date = formatDate(photo.takenAt);
  el.lightboxCaption.textContent = [photo.place, date].filter(Boolean).join(" · ");
  if (photo.dateFallback) {
    const note = document.createElement("span");
    note.className = "approximate";
    note.textContent = t("gallery.approximate");
    el.lightboxCaption.append(note);
  }

  for (const offset of [1, -1]) {
    // Warm the neighbours so stepping through feels instant.
    new Image().src = state.photos[(state.index + offset + state.photos.length) % state.photos.length].web;
  }

  if (el.lightbox.hidden) {
    el.lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }
}

function wireLightbox() {
  window.addEventListener("popstate", onPopState);

  el.lightbox.querySelector(".lightbox-close").addEventListener("click", dismissPhoto);
  el.lightbox.querySelector(".prev").addEventListener("click", () => stepPhoto(-1));
  el.lightbox.querySelector(".next").addEventListener("click", () => stepPhoto(1));
  el.lightbox.addEventListener("click", (event) => {
    if (event.target === el.lightbox) dismissPhoto();
  });

  document.addEventListener("keydown", (event) => {
    if (el.lightbox.hidden) return;
    if (event.key === "Escape") dismissPhoto();
    if (event.key === "ArrowLeft") stepPhoto(-1);
    if (event.key === "ArrowRight") stepPhoto(1);
  });

  let swipeStart = null;
  el.lightbox.addEventListener(
    "touchstart",
    (event) => {
      swipeStart = event.changedTouches[0];
    },
    { passive: true }
  );
  el.lightbox.addEventListener(
    "touchend",
    (event) => {
      if (!swipeStart) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - swipeStart.clientX;
      const dy = touch.clientY - swipeStart.clientY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) stepPhoto(dx < 0 ? 1 : -1);
      swipeStart = null;
    },
    { passive: true }
  );
}

start();
