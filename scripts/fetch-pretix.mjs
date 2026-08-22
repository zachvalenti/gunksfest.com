#!/usr/bin/env node
/**
 * Pulls the GunksFest clinic line-up out of pretix and writes data/schedule.json,
 * the snapshot that schedule.html renders. Run by .github/workflows/pretix-sync.yml
 * on a schedule, or by hand:
 *
 *   PRETIX_TOKEN=xxxx node scripts/fetch-pretix.mjs
 *
 * Config comes from the environment (see .github/workflows/pretix-sync.yml):
 *   PRETIX_TOKEN      required — an API token from Organizer → Team → API tokens
 *   PRETIX_URL        default https://pretix.eu
 *   PRETIX_ORGANIZER  organizer slug
 *   PRETIX_EVENT      event slug
 *   PRETIX_OUT        default data/schedule.json
 *
 * Nothing here is secret at rest: the token only ever lives in the environment,
 * and the file we emit is the same information the public ticket shop shows.
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = (process.env.PRETIX_URL || "https://pretix.eu").replace(/\/+$/, "");
const ORG = process.env.PRETIX_ORGANIZER || "gunksclimbers";
const EVENT = process.env.PRETIX_EVENT || "gunksfest2026";
const TOKEN = process.env.PRETIX_TOKEN;
const OUT = process.env.PRETIX_OUT || "data/schedule.json";

if (!TOKEN) {
  console.error("PRETIX_TOKEN is not set. Get one from pretix: Organizer → Teams → API tokens.");
  process.exit(1);
}

const api = `${BASE}/api/v1/organizers/${ORG}/events/${EVENT}`;

async function get(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Token ${TOKEN}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`GET ${url} → ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Follows pretix's `next` links and returns every page's results concatenated. */
async function getAll(url) {
  const out = [];
  let next = url;
  while (next) {
    const page = await get(next);
    out.push(...(page.results || []));
    next = page.next;
  }
  return out;
}

/** pretix i18n fields are `{"en": "..."}` objects — or plain strings on some fields. */
function i18n(value, lang = "en") {
  if (value == null) return null;
  if (typeof value === "string") return value || null;
  if (typeof value !== "object") return String(value);
  return value[lang] || value["en"] || Object.values(value)[0] || null;
}

function money(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/**
 * Cheapest way to buy this item, and whether that's a "from" price.
 * Variations without their own price inherit the item's default_price.
 */
function priceOf(item) {
  const variations = item.variations || [];
  if (!variations.length) {
    return { price: money(item.default_price), priceFrom: false };
  }
  const prices = variations
    .filter((v) => v.active !== false)
    .map((v) => money(v.default_price ?? item.default_price))
    .filter((p) => p != null)
    .map(Number);
  if (!prices.length) return { price: money(item.default_price), priceFrom: true };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { price: min.toFixed(2), priceFrom: min !== max };
}

/**
 * Parses a date out of item meta_data, the fallback for pretix installs that
 * predate the program_times resource. Accepts "2026-10-10T09:00", "2026-10-10 09:00"
 * and bare "2026-10-10". Naive values are read as local time in `tz`.
 */
function parseMetaDate(raw, tz) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mm = "00"] = m;
  // Resolve the wall-clock time in `tz` to a real instant: guess UTC, measure
  // how far off that guess lands in the target zone, then correct by the gap.
  const guess = Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:00Z`);
  if (Number.isNaN(guess)) return null;
  const offset = tzOffsetMs(guess, tz);
  return new Date(guess - offset).toISOString();
}

/** Milliseconds `tz` is ahead of UTC at the given instant. */
function tzOffsetMs(instant, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - instant;
}

/** The calendar date an instant falls on, in the event's timezone. */
function dayKey(iso, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(iso, tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "long", month: "long", day: "numeric",
  }).format(new Date(iso));
}

/**
 * pretix stores item descriptions as Markdown and only renders them in its own
 * storefront — the REST API hands back the raw source. Convert a safe subset
 * here so the page doesn't show literal asterisks and hashes. Everything is
 * HTML-escaped first, so nothing an author types can inject markup; the browser
 * re-checks the result against an allowlist before it renders.
 */
function mdToHtml(src) {
  if (!src) return null;
  // Shop boilerplate that belongs in the cart, not on a schedule. It sits on its
  // own line in every description that has it, so drop the whole line.
  src = String(src).replace(/^.*General Admission Event Ticket.*$/gim, "");
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>');

  const blocks = src.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;

    const heading = lines[0].match(/^(#{1,6})\s+(.*)$/);
    if (heading && lines.length === 1) {
      // The page already owns h1–h3, so every Markdown heading lands at h4.
      out.push(`<h4>${inline(heading[2])}</h4>`);
      continue;
    }
    // A marker must be followed by a space, so an emphasised line like
    // "*Guide: ...*" is not mistaken for a bullet.
    if (lines.every((l) => /^\s*[-*+]\s+/.test(l))) {
      out.push("<ul>" + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*+]\s+/, ""))}</li>`).join("") + "</ul>");
      continue;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      out.push("<ol>" + lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("") + "</ol>");
      continue;
    }
    // A heading sharing a block with body text (no blank line after it, which is
    // common in these descriptions) keeps its emphasis as a bold run.
    out.push(
      `<p>${lines
        .map((l) => {
          const h = l.match(/^\s*#{1,6}\s+(.*)$/);
          return h ? `<strong>${inline(h[1])}</strong>` : inline(l);
        })
        .join("<br />")}</p>`
    );
  }
  return out.join("") || null;
}

/**
 * Product names carry backend bookkeeping: a "2026_" year prefix, and a trailing
 * "(Saturday 9am-1pm)" that just restates the time already shown beside it. Strip
 * both for display. The untouched value stays on the record as `rawName`.
 */
function displayName(name) {
  if (!name) return name;
  return String(name)
    .replace(/^\s*\d{4}[_\s-]+/, "")
    .replace(/\s*\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b[^)]*\)\s*$/i, "")
    .trim();
}

async function main() {
  const event = await get(`${api}/`);
  const tz = event.timezone || "America/New_York";
  const lang = (event.locales && event.locales[0]) || "en";

  const categories = (await getAll(`${api}/categories/`))
    .map((c) => ({
      id: c.id,
      name: i18n(c.name, lang),
      description: i18n(c.description, lang),
      position: c.position ?? 0,
      isAddon: !!c.is_addon,
    }))
    .sort((a, b) => a.position - b.position);
  const catById = new Map(categories.map((c) => [c.id, c]));

  const items = (await getAll(`${api}/items/`))
    .filter((i) => i.active)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // program_times is a newer pretix resource. Older installs 404 it, in which
  // case every item falls through to its meta_data.
  let programTimesSupported = true;
  const sessions = [];
  const unscheduled = [];

  for (const item of items) {
    const cat = item.category != null ? catById.get(item.category) : null;
    const isAddon = !!(cat && cat.isAddon);

    const { price, priceFrom } = priceOf(item);
    const meta = item.meta_data || {};
    const base = {
      id: item.id,
      name: displayName(i18n(item.name, lang)),
      rawName: i18n(item.name, lang),
      description: mdToHtml(i18n(item.description, lang)),
      category: cat ? cat.name : null,
      categoryId: cat ? cat.id : null,
      price,
      priceFrom,
      freePrice: !!item.free_price,
      hasVariations: !!item.has_variations,
      allowWaitinglist: item.allow_waitinglist !== false,
      picture: item.picture || null,
      isAddon,
      meta,
      // Add-ons can't be bought on their own, so deep-linking the product does
      // nothing useful — send those to the shop front page instead.
      url: isAddon ? `${BASE}/${ORG}/${EVENT}/` : `${BASE}/${ORG}/${EVENT}/?item=${item.id}`,
    };

    let slots = [];
    if (programTimesSupported) {
      try {
        slots = await getAll(`${api}/items/${item.id}/program_times/`);
      } catch (err) {
        if (err.status === 404) {
          programTimesSupported = false;
          console.warn("program_times not available on this pretix version — using item meta_data instead.");
        } else {
          throw err;
        }
      }
    }

    if (slots.length) {
      for (const slot of slots) {
        if (!slot.start) continue;
        sessions.push({
          ...base,
          slotId: `${item.id}-${slot.id}`,
          start: new Date(slot.start).toISOString(),
          end: slot.end ? new Date(slot.end).toISOString() : null,
          location: i18n(slot.location, lang) || i18n(event.location, lang),
        });
      }
      continue;
    }

    // Fallback: times set as item meta properties.
    const start = parseMetaDate(meta.start || meta.date || meta.day, tz);
    if (start) {
      sessions.push({
        ...base,
        slotId: `${item.id}-meta`,
        start,
        end: parseMetaDate(meta.end, tz),
        location: meta.location || i18n(event.location, lang),
      });
    } else if (!isAddon) {
      unscheduled.push({ ...base, slotId: `${item.id}-none`, start: null, end: null, location: meta.location || null });
    }
    // An add-on with no time on it is merch or an extra (chalk, a t-shirt), not
    // something that belongs on a schedule — drop it. An add-on WITH a time is a
    // clinic sold alongside a festival pass, and was kept above.
  }

  sessions.sort((a, b) => a.start.localeCompare(b.start) || (a.name || "").localeCompare(b.name || ""));

  const days = [];
  for (const s of sessions) {
    const key = dayKey(s.start, tz);
    let day = days.find((d) => d.date === key);
    if (!day) {
      day = { date: key, label: dayLabel(s.start, tz), sessions: [] };
      days.push(day);
    }
    day.sessions.push(s);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const data = {
    generated: new Date().toISOString(),
    shop: {
      base: BASE,
      organizer: ORG,
      event: EVENT,
      url: `${BASE}/${ORG}/${EVENT}/`,
      widget: `${BASE}/${ORG}/${EVENT}/widget/product_list`,
      name: i18n(event.name, lang),
      currency: event.currency || "USD",
      timezone: tz,
      live: !!event.live,
      dateFrom: event.date_from || null,
      dateTo: event.date_to || null,
    },
    // Add-on categories are kept: a clinic sold alongside a festival pass lives
    // in one, and its name is still what the filter chip should read.
    categories,
    days,
    unscheduled,
  };

  // Ignore the timestamp when deciding whether anything really changed, so the
  // scheduled workflow doesn't commit a no-op every run.
  const json = JSON.stringify(data, null, 2) + "\n";
  const previous = await readFile(OUT, "utf8").catch(() => null);
  if (previous && stripGenerated(previous) === stripGenerated(json)) {
    console.log(`No changes — ${OUT} left alone.`);
    return;
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json);
  console.log(`Wrote ${OUT}: ${days.length} day(s), ${sessions.length} session(s), ${unscheduled.length} unscheduled.`);
}

function stripGenerated(json) {
  return json.replace(/"generated": "[^"]*",?\n/, "");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
