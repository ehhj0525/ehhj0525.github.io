/**
 * The gallery. Reads photos.json (built by the pipeline) and renders it two ways:
 * a month-by-month timeline, and a map of where the photos were taken.
 */

const state = {
  photos: [], // newest first — the order the lightbox steps through
  config: { title: "Grace", birthDate: null },
  index: 0,
  map: null,
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

async function loadJson(path, fallback) {
  try {
    // GitHub Pages caches aggressively; a fresh upload should show up immediately.
    const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status);
    return await response.json();
  } catch {
    return fallback;
  }
}

async function start() {
  const [config, manifest] = await Promise.all([
    loadJson("config.json", {}),
    loadJson("photos.json", { photos: [] }),
  ]);

  state.config = { ...state.config, ...config };
  state.photos = manifest.photos ?? [];
  document.title = state.config.title;
  el.title.textContent = state.config.title;

  renderTimeline();
  wireTabs();
  wireLightbox();
}

/* --------------------------------------------------------------- timeline */

function renderTimeline() {
  if (state.photos.length === 0) {
    el.status.textContent = "No photos yet. Add some from the upload page and they will appear here.";
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
  const [year, monthNumber] = month.split("-").map(Number);
  heading.textContent = new Date(year, monthNumber - 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
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

function tile(photo) {
  const button = document.createElement("button");
  button.className = "tile";
  button.type = "button";

  const image = document.createElement("img");
  image.src = photo.thumb;
  image.alt = photo.place ? `Photo taken in ${photo.place}` : "Photo";
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

  button.addEventListener("click", () => openLightbox(state.photos.indexOf(photo)));
  return button;
}

/**
 * "3 months", "1 year 2 months" — how old he was when the photo was taken.
 * Returns null for photos from before he was born, and when no birth date is set.
 */
function ageLabel(birthDate, when) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const date = new Date(when);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(date.getTime())) return null;

  let months = (date.getFullYear() - birth.getFullYear()) * 12 + (date.getMonth() - birth.getMonth());
  if (date.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return null;
  if (months === 0) return "newborn";
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;

  const years = Math.floor(months / 12);
  const remainder = months % 12;
  const yearPart = `${years} year${years === 1 ? "" : "s"}`;
  return remainder === 0 ? yearPart : `${yearPart} ${remainder} month${remainder === 1 ? "" : "s"}`;
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
    el.map.textContent = "The map could not be loaded.";
    return;
  }

  const located = state.photos.filter((photo) => photo.lat != null && photo.lon != null);
  if (located.length === 0) {
    el.map.textContent = "None of the photos have location information yet.";
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
    el.mapNote.textContent = `${missing} photo${missing === 1 ? "" : "s"} without location ${
      missing === 1 ? "is" : "are"
    } on the timeline only.`;
    el.mapNote.hidden = false;
  }
}

function popup(photo) {
  const container = document.createElement("div");
  const image = document.createElement("img");
  image.src = photo.thumb;
  image.alt = "";
  image.addEventListener("click", () => openLightbox(state.photos.indexOf(photo)));

  const caption = document.createElement("div");
  caption.className = "popup-caption";
  caption.textContent = [photo.place, formatDate(photo.takenAt)].filter(Boolean).join(" · ");

  container.append(image, caption);
  return container;
}

/* --------------------------------------------------------------- lightbox */

function openLightbox(index) {
  if (index < 0) return;
  state.index = index;
  showPhoto();
  el.lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  el.lightbox.hidden = true;
  el.lightboxImage.removeAttribute("src");
  document.body.style.overflow = "";
}

function step(delta) {
  const count = state.photos.length;
  state.index = (state.index + delta + count) % count;
  showPhoto();
}

function showPhoto() {
  const photo = state.photos[state.index];
  el.lightboxImage.src = photo.web;
  el.lightboxImage.alt = photo.place ? `Photo taken in ${photo.place}` : "Photo";

  const date = formatDate(photo.takenAt);
  el.lightboxCaption.textContent = [photo.place, date].filter(Boolean).join(" · ");
  if (photo.dateFallback) {
    const note = document.createElement("span");
    note.className = "approximate";
    note.textContent = " (date approximate)";
    el.lightboxCaption.append(note);
  }

  for (const offset of [1, -1]) {
    // Warm the neighbours so stepping through feels instant.
    new Image().src = state.photos[(state.index + offset + state.photos.length) % state.photos.length].web;
  }
}

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function wireLightbox() {
  el.lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
  el.lightbox.querySelector(".prev").addEventListener("click", () => step(-1));
  el.lightbox.querySelector(".next").addEventListener("click", () => step(1));
  el.lightbox.addEventListener("click", (event) => {
    if (event.target === el.lightbox) closeLightbox();
  });

  document.addEventListener("keydown", (event) => {
    if (el.lightbox.hidden) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
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
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
      swipeStart = null;
    },
    { passive: true }
  );
}

start();
