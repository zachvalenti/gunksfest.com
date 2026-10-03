/* GunksFest 2026 — offline copy of the maps page
 *
 * Phone signal at the Trapps and along the Preserve is patchy, and that is
 * exactly where someone opens the Mohonk map. This service worker saves the
 * maps page and everything it needs the first time it is opened, so that on
 * every visit after that it opens from the phone itself, signal or not.
 *
 * Scope: it lives in /maps/, so it only ever controls /maps/ pages — the rest
 * of the site is untouched. (A service worker's reach is the folder its file
 * sits in; this one cannot see the home page or the clinics page, by design.)
 *
 * How each request is answered:
 *   - The page itself: network first, so an online visitor always gets the
 *     latest version — but give up after a few seconds and use the saved copy,
 *     because "one bar of signal" usually means a request that hangs rather
 *     than one that fails, and a page that spins for a minute is no better
 *     than no page.
 *   - Styles, scripts, images, fonts: the saved copy at once, and a fresh copy
 *     fetched in the background for next time ("stale-while-revalidate"). A
 *     change to the CSS or a photo reaches people on their second visit
 *     without anyone having to remember to bump a version.
 *   - Everything else (analytics, the links out): left alone.
 *
 * When to change VERSION: only when the list in PRECACHE changes (a file
 * added, renamed or removed). Edits to files already listed don't need it.
 * Changing it makes every visitor's browser install this file afresh, re-save
 * the list, and delete the previous version's saved files.
 *
 * Every browser that supports service workers supports the modern syntax used
 * here, so unlike js/main.js this file doesn't stick to ES5.
 */

const VERSION = "v1";
const CACHE = `gunksfest-maps-${VERSION}`;

// The page and every same-site file it loads. If you add an image or script
// to maps/index.html, add it here too, or it won't be there offline.
const PRECACHE = [
  "/maps/",
  "/css/style.css",
  "/css/maps.css",
  "/js/main.js",
  "/js/maps.js",
  "/assets/img/maps/fairgrounds-aerial.jpg",
  "/assets/img/maps/mohonk-aerial.jpg",
  "/assets/img/df7b7300-e033-4e14-a859-f91136d7badc.jpg",
  "/assets/favicon.svg",
  "/assets/img/favicon.png",
];

// The Google Fonts stylesheet, exactly as maps/index.html links it. The
// font files it points at are saved alongside it (see saveFonts).
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Playfair+Display:ital,wght@0,900;1,700&display=swap";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// How long the page request may take before the saved copy is used instead.
const PAGE_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: "reload" skips the browser's HTTP cache, so what gets saved is
    // what the server has now, not whatever was lying around from last week.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
    // Fonts are a nice-to-have: if Google is unreachable the page still works
    // offline in the fallback faces, so a failure here must not fail install.
    await saveFonts(cache).catch(() => {});
    // Take over from an older version straight away rather than waiting for
    // every tab on the old one to close.
    await self.skipWaiting();
  })());
});

/* The font files can't simply be listed in PRECACHE: Google picks the URLs,
 * and picks them per browser. So fetch the stylesheet the way this browser
 * would, then save the files it names.
 *
 * The page loads these fonts before this worker is running on the first
 * visit, so this is the only chance to catch them. Only the "latin" blocks
 * are saved: the stylesheet also lists latin-ext, cyrillic and vietnamese
 * subsets, which the page never uses and which would triple the download. */
async function saveFonts(cache) {
  const response = await fetch(FONT_CSS, { mode: "cors" });
  if (!response.ok) return;
  const css = await response.clone().text();
  await cache.put(FONT_CSS, response);
  const urls = [];
  for (const block of css.split("/*").slice(1)) {
    if (!/^\s*latin\s*\*\//.test(block)) continue;
    const match = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
    if (match) urls.push(match[1]);
  }
  await Promise.all(urls.map((url) =>
    fetch(url, { mode: "cors" }).then((r) => r.ok && cache.put(url, r))));
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Delete the saved files from any earlier version of this worker.
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("gunksfest-maps-") && name !== CACHE)
      .map((name) => caches.delete(name)));
    // Start answering for pages that are already open, not just new ones.
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === location.origin) {
    event.respondWith(pageFirst(request));
    return;
  }
  if (url.origin === location.origin || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(savedFirst(request, event));
  }
  // Anything else falls through to the network untouched.
});

/* The page: network first, saved copy as the fallback after a timeout or an
 * error. Every copy that does come back from the network is saved, so the
 * offline page is as fresh as the last visit with signal. */
async function pageFirst(request) {
  const cache = await caches.open(CACHE);
  // Every URL under /maps/ is the same page (/maps/, /maps/index.html,
  // /maps/?utm_…), so they all share the one saved copy.
  const saved = () => cache.match("/maps/");

  const network = fetch(request).then((response) => {
    if (response.ok) cache.put("/maps/", response.clone());
    return response;
  });

  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;

  // The network was slow or failed: use the saved copy if there is one, and
  // otherwise keep waiting for the network — it's the only hope left.
  return (await saved()) || network.catch(() => Response.error());
}

/* Styles, scripts, images, fonts: saved copy now, fresh copy for next time. */
async function savedFirst(request, event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, { ignoreSearch: false });
  const fresh = fetch(request).then((response) => {
    // Only keep real answers. An opaque response (status 0) can't be checked,
    // and saving an error page would serve it offline forever.
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (saved) {
    // Keep the worker alive until the background refresh has finished.
    event.waitUntil(fresh.catch(() => {}));
    return saved;
  }
  return fresh;
}
