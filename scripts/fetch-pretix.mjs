#!/usr/bin/env node
/**
 * Pulls the GunksFest clinic line-up out of pretix and writes data/schedule.json,
 * the snapshot that clinics.html renders. Run by .github/workflows/pretix-sync.yml
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
 *
 * ---------------------------------------------------------------------------
 * GETTING A CLINIC ONTO THE SCHEDULE
 *
 * Clinics are products (items) in one pretix event, so pretix has to be told
 * when each one runs. Anything without a time is not a session, and won't be
 * listed. This script looks in two places, in that order:
 *
 *   1. Program times (preferred) — on the product, under "Program times", add
 *      a start and end, and optionally a location. A product can carry several,
 *      and each becomes its own row on the schedule.
 *
 *   2. Item meta properties (fallback, for pretix versions predating the
 *      program_times API). Define these once under Organizer settings → Item
 *      meta properties, then fill them in per product:
 *
 *        start       2026-10-10 09:00   the clinic's start time
 *        end         2026-10-10 13:00   the end time
 *        location    The Trapps         where it meets
 *        guide       Sarah K.           who is running it
 *        difficulty  Beginner           drives the level filter pills
 *
 *      Times without a zone are read as wall-clock time in the event's own
 *      timezone (see parseMetaDate below).
 *
 * `difficulty` is the one the schedule page reads directly and cannot infer:
 * js/schedule.js will never guess a level from a title or description, so a
 * clinic without this property set simply doesn't appear under any level pill.
 * The four values it understands are Beginner, Intermediate, Advanced, and
 * All Levels — the last meaning the clinic is listed under all three pills
 * rather than under one of its own. Anything else is treated as unset, so a
 * new wording invented in pretix will quietly drop clinics out of the filter
 * rather than mislabel them; add it to levelsOf() in js/schedule.js instead.
 * ---------------------------------------------------------------------------
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

/**
 * One authenticated GET against the pretix REST API.
 *
 * Two habits worth copying whenever you talk to an HTTP API:
 *
 *  - fetch() does NOT throw on 404 or 500. It only rejects when the request
 *    itself fails (DNS, connection dropped). A response is a response, however
 *    unhappy, so you have to check res.ok yourself — forgetting this is the
 *    single most common bug in code that calls an API, because it turns a
 *    clear "401 unauthorised" into a confusing crash somewhere further down
 *    when the parsed body isn't shaped how you expected.
 *  - When it does fail, put everything you'll need into the error message:
 *    method, URL, status, and the start of the body (which is where APIs
 *    usually explain themselves). A CI job that fails at 3am is only as
 *    debuggable as the line it prints. The status is also stashed on the error
 *    object so callers can branch on it — main() uses that to detect a 404 for
 *    program_times and fall back to meta properties.
 */
async function get(url) {
  const res = await fetch(url, {
    // The API token travels in a header, never in the URL: query strings end
    // up in server logs, browser history and Referer headers.
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

/**
 * Follows pretix's `next` links and returns every page's results concatenated.
 *
 * Nearly every REST API paginates: ask for a collection and you get the first
 * 50 items plus a pointer to the rest. Code that ignores this works perfectly
 * in testing and then silently loses data the day the event grows past one
 * page — the request still succeeds, it just answers a narrower question than
 * you asked. Always check how the API you're calling signals "there's more",
 * and follow it. pretix returns a `next` URL and null when it's done, which
 * makes the loop trivial; others use page numbers or opaque cursors.
 */
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

/**
 * Milliseconds `tz` is ahead of UTC at the given instant.
 *
 * Worth reading as a lesson in dates, which are the classic source of bugs
 * that only appear in one month of the year. The rule: an instant in time and
 * a wall-clock reading are different things. "2026-10-10 09:00" is not a
 * moment — it's a moment only once you say where. And the offset isn't a
 * property of the zone, it's a property of the zone *at that date*: New York
 * is UTC-4 in October and UTC-5 in December.
 *
 * So this asks Intl to format a known instant in the target zone, reads the
 * digits back, and measures how far they drift from UTC — which is the offset
 * in force on that date, daylight saving included. Store and pass instants
 * (ISO strings with a Z, as data/schedule.json does), and convert to local
 * wall-clock only at the point of display.
 */
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

/** The weekday an instant falls on, in the event's timezone. "Monday". */
function weekday(iso, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(iso));
}

/**
 * Warns when a product's name disagrees with the time it is scheduled at.
 *
 * Clinic names in pretix carry the day in a trailing "(Monday 9am-1pm)", and
 * the program time is entered separately — so the two can drift apart, and one
 * of them is then wrong on a page people plan a trip around. Nothing here can
 * say which one: the name is written by a human and the time is the bookable
 * slot, and either could be the mistake. So this only points at the pair and
 * leaves the fix in pretix, where both live.
 *
 * A warning, not an error: a wrong day is worth shouting about, but it is not
 * worth refusing to publish the other 40 clinics over.
 */
function warnOnDayMismatch(sessions, tz) {
  for (const s of sessions) {
    const named = String(s.rawName || "").match(/\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b[^)]*\)\s*$/i);
    if (!named) continue;
    const actual = weekday(s.start, tz);
    if (actual.toLowerCase().startsWith(named[1].toLowerCase())) continue;
    console.warn(
      `Day mismatch: "${s.rawName}" is scheduled on ${actual}, ` +
      `${dayKey(s.start, tz)}. Fix the program time or the name in pretix.`
    );
  }
}

/**
 * Warns about an add-on with no time on it that sits in a category whose other
 * products are all on the schedule.
 *
 * A clinic reaches the page by having a program time in pretix, and an add-on
 * without one is dropped below — correctly, because that is also exactly what
 * merch looks like: a t-shirt is an add-on with no time and no business on a
 * schedule. The cost of that rule is silence in the one case that matters. A
 * clinic somebody added to the shop and never gave a time to is dropped by the
 * same line, never reaches data/schedule.json, and therefore cannot be noticed
 * as missing by anyone comparing the page against the snapshot — the page and
 * the file agree, and both are short a clinic. The only trace is in pretix.
 *
 * Which of the two a dropped add-on is, is not something its name can settle,
 * but its category can. The categories here are "Saturday Clinics", "Monday
 * Clinics", "Merch": a category that has already put clinics on the schedule is
 * not where anyone files a t-shirt. So this warns about a timeless add-on whose
 * category produced sessions and stays quiet about one whose category produced
 * none — which keeps an ordinary merch run silent without hardcoding the word
 * "merch", and starts warning by itself the day a new clinic category appears.
 *
 * A warning, not an error, for the same reason as warnOnDayMismatch above: the
 * fix is a program time typed into pretix, and the clinics that do have one
 * should publish in the meantime.
 */
function warnOnTimelessClinic(dropped, sessions) {
  const scheduled = new Set(sessions.map((s) => s.categoryId));
  for (const item of dropped) {
    if (!scheduled.has(item.categoryId)) continue;
    console.warn(
      `No program time: "${item.rawName}" sits in ${item.category}, whose other ` +
      `products are on the schedule, so it is missing from the page entirely. ` +
      `Give it a program time in pretix, or move it to a category that isn't a clinic list.`
    );
  }
}

/**
 * pretix stores item descriptions as Markdown and only renders them in its own
 * storefront — the REST API hands back the raw source. Convert a safe subset
 * here so the page doesn't show literal asterisks and hashes. Everything is
 * HTML-escaped first, so nothing an author types can inject markup; the browser
 * re-checks the result against an allowlist before it renders.
 */
/**
 * Per-line copy tidying, applied to the Markdown before it becomes HTML.
 *
 * Two things only, both about consistency across 36 clinic cards:
 *   - Credit lines. Most read "Guide: Name" or "With: Name", and one already
 *     reads "Instructor: Name". Two strays are written as prose — "With Dr.
 *     Richard Goldstone." and "-- With Jane ... --" — and get folded into the
 *     "Instructor:" form. Lines already using a colon are left alone.
 *   - Prerequisites / Required gear lines drop their trailing full stop, so the
 *     column reads evenly whether or not the author typed one.
 */
function tidyLine(line) {
  // Length guard: a credit is a short standalone line. Without it this also
  // swallows prose openings like "With years of big mountain experience, ...".
  const credit = line.length <= 70 && line.match(/^\s*-*\s*With\s+(?!:)(.+?)\s*-*\s*$/i);
  if (credit) {
    const who = credit[1].replace(/\s*[.!]+$/, "").replace(/^(?:Dr|Mr|Ms|Mrs|Prof)\.?\s+/i, "");
    return `Instructor: ${who}`;
  }
  const spec = line.match(/^(\s*#*\s*(?:Prerequisites?|Required\s+Gear)\b.*?)\s*[.!;,]+\s*$/i);
  // "etc." keeps its full stop — there the dot belongs to the abbreviation, not
  // to the sentence, and "slings, etc" reads as a typo. Same for other common
  // abbreviations that can legitimately end a gear list.
  if (spec && !/\b(?:etc|ie|eg|approx|incl|min|max|lbs|ft|in|vs)$/i.test(spec[1])) return spec[1];
  return line;
}

function mdToHtml(src) {
  if (!src) return null;
  // Shop boilerplate that belongs in the cart, not on a schedule. It sits on its
  // own line in every description that has it, so drop the whole line.
  src = String(src).replace(/^.*General Admission Event Ticket.*$/gim, "");
  src = src.split("\n").map(tidyLine).join("\n");
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
    // Blank lines go, and so do lines that are nothing but punctuation. Authors
    // in the pretix editor leave a stray "." or a "---" behind at the end of a
    // description often enough to be worth handling: the line carries no words,
    // so it can only render as a lone full stop hanging under the last
    // paragraph. A block left with no lines at all is dropped entirely.
    const lines = block.split("\n").filter((l) => l.trim() && !/^[.\u2026,;:!?*_\-]+$/.test(l.trim()));
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
  const timeless = [];

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
    } else {
      // An add-on with no time on it is usually merch or an extra (chalk, a
      // t-shirt), not something that belongs on a schedule — drop it. An add-on
      // WITH a time is a clinic sold alongside a festival pass, and was kept
      // above. Held onto only long enough for warnOnTimelessClinic() to tell
      // the merch from the clinic nobody gave a time to; nothing here is
      // written to the snapshot.
      timeless.push(base);
    }
  }

  sessions.sort((a, b) => a.start.localeCompare(b.start) || (a.name || "").localeCompare(b.name || ""));
  warnOnDayMismatch(sessions, tz);
  warnOnTimelessClinic(timeless, sessions);

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
  // scheduled workflow doesn't commit a no-op every run. Any job that writes
  // to a repo on a schedule needs a check like this, or the history fills with
  // identical commits and a real change becomes impossible to spot.
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
