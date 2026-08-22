#!/usr/bin/env node
/**
 * Strips the "2026_" bookkeeping prefix off product names in pretix.
 *
 * This is the one script here that WRITES to the shop, so it does nothing until
 * you ask twice: a bare run only prints the plan, and `--apply` is what sends the
 * PATCHes. Run it from .github/workflows/pretix-rename.yml (Actions → Rename
 * pretix products → Run workflow), or by hand:
 *
 *   PRETIX_ADMIN=xxxx node scripts/pretix-rename.mjs            # plan only
 *   PRETIX_ADMIN=xxxx node scripts/pretix-rename.mjs --apply    # do it
 *
 * Config comes from the environment:
 *   PRETIX_ADMIN      required — a token whose team has "Can change event settings".
 *                     The read-only PRETIX_TOKEN the sync uses is NOT enough.
 *   PRETIX_URL        default https://pretix.eu
 *   PRETIX_ORGANIZER  organizer slug
 *   PRETIX_EVENT      event slug
 *
 * The website doesn't need this: js/schedule.js already hides the prefix, and
 * fetch-pretix.mjs keeps the untouched name as `rawName`. It's for everyone who
 * reads the names inside pretix — the shop backend, order confirmations, exports.
 */
import { appendFile } from "node:fs/promises";

const BASE = (process.env.PRETIX_URL || "https://pretix.eu").replace(/\/+$/, "");
const ORG = process.env.PRETIX_ORGANIZER || "gunksclimbers";
const EVENT = process.env.PRETIX_EVENT || "gunksfest2026";
const TOKEN = process.env.PRETIX_ADMIN;
const APPLY = process.argv.includes("--apply");

if (!TOKEN) {
  console.error(
    "PRETIX_ADMIN is not set. It needs a token from a pretix team with " +
    '"Can change event settings" — the read-only sync token cannot rename products.'
  );
  process.exit(1);
}

const api = `${BASE}/api/v1/organizers/${ORG}/events/${EVENT}`;

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Token ${TOKEN}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${url} → ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function getAll(url) {
  const out = [];
  let next = url;
  while (next) {
    const page = await request("GET", next);
    out.push(...(page.results || []));
    next = page.next;
  }
  return out;
}

/**
 * The prefix, and only the prefix: a four-digit year followed by an underscore.
 * The trailing "(Saturday 9am-1pm)" is left alone — it's wrong for the website,
 * where the time is already printed beside the title, but inside pretix it's how
 * staff tell two identically-named tours apart. schedule.js hides it either way.
 */
const PREFIX = /^\s*(?:19|20)\d{2}_\s*/;

function clean(value) {
  return String(value).replace(PREFIX, "").trim();
}

/**
 * pretix name fields are `{"en": "..."}` objects, one entry per configured
 * language — but older items can carry a bare string. Rebuild whichever shape
 * came in, touching only the locales that actually have the prefix.
 */
function cleanName(name) {
  if (typeof name === "string") {
    const next = clean(name);
    return next && next !== name ? next : null;
  }
  if (!name || typeof name !== "object") return null;

  const next = {};
  let changed = false;
  for (const [locale, value] of Object.entries(name)) {
    if (typeof value !== "string" || !value) {
      next[locale] = value;
      continue;
    }
    const stripped = clean(value);
    // An empty result means the name was nothing but the prefix. Leave it: a
    // blank product name would be worse than the bookkeeping it removes.
    if (stripped && stripped !== value) changed = true;
    next[locale] = stripped || value;
  }
  return changed ? next : null;
}

function shown(name) {
  return typeof name === "string" ? name : Object.values(name || {}).find(Boolean) || "";
}

async function summarize(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

async function main() {
  const items = await getAll(`${api}/items/`);
  const planned = [];
  for (const item of items) {
    const name = cleanName(item.name);
    if (name) planned.push({ id: item.id, from: shown(item.name), to: shown(name), name });
  }

  console.log(
    `${items.length} products in ${ORG}/${EVENT}; ` +
    `${planned.length} ${planned.length === 1 ? "carries" : "carry"} the prefix.`
  );
  if (!planned.length) {
    await summarize(["### pretix rename", "", "Nothing to do — no product name starts with a year prefix."]);
    return;
  }

  for (const p of planned) console.log(`  ${p.id}  ${p.from}\n        → ${p.to}`);

  const summary = ["### pretix rename", "", `${planned.length} product name(s) ${APPLY ? "renamed" : "would be renamed"}:`, "",
    "| id | from | to |", "| --- | --- | --- |",
    ...planned.map((p) => `| ${p.id} | ${p.from.replace(/\|/g, "\\|")} | ${p.to.replace(/\|/g, "\\|")} |`)];

  if (!APPLY) {
    console.log("\nDry run — nothing was changed. Re-run with --apply to write these to pretix.");
    summary.push("", "_Dry run — nothing was changed._");
    await summarize(summary);
    return;
  }

  // One item at a time: 45 sequential PATCHes is a couple of seconds, and if one
  // fails we know exactly which product it was and the rest still go through.
  let done = 0;
  const failed = [];
  for (const p of planned) {
    try {
      await request("PATCH", `${api}/items/${p.id}/`, { name: p.name });
      done++;
    } catch (err) {
      failed.push(p.id);
      console.error(`  ! ${p.id} ${p.from}: ${err.message}`);
    }
  }

  console.log(`\nRenamed ${done} of ${planned.length}.`);
  summary.push("", `Renamed **${done} of ${planned.length}**.`);
  if (failed.length) summary.push("", `Failed: ${failed.join(", ")}.`);
  summary.push("", "`data/schedule.json` still holds the old `rawName` until the next sync runs.");
  await summarize(summary);

  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
