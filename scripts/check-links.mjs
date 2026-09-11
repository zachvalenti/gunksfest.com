#!/usr/bin/env node
/**
 * Opens every outbound link on the site the way a visitor would — logged out,
 * no cookies — and complains if what comes back is not the page we meant to
 * send people to. Run by .github/workflows/link-check.yml on a schedule, or by
 * hand:
 *
 *   node scripts/check-links.mjs                 every http(s) link in our HTML
 *   node scripts/check-links.mjs https://…       just these, nothing else
 *   node scripts/check-links.mjs --strict        exit 1 on a finding (see below)
 *
 * Config comes from the environment (see the workflow):
 *   LINK_FINDINGS     file to write findings to; the workflow turns it into an issue
 *   VOLUNTEER_MARKER  text the real sign-up form contains — see EXPECTATIONS below
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT READS THE PAGE INSTEAD OF THE STATUS CODE
 *
 * The volunteer sign-up form is a Google Apps Script web app. It was redeployed
 * once, under a new URL, and the old link in index.html went on pointing at the
 * dead deployment for as long as it took a human to click it by accident and
 * meet "Sorry, unable to open the file at this time." Every volunteer who
 * clicked in between met it too, and none of them could tell us.
 *
 * A link checker that reads status codes would not have caught it. Google
 * serves that error page with **HTTP 200 OK** — as far as the network is
 * concerned the fetch succeeded perfectly; the page is only broken because of
 * what it says. Same for the sign-in wall you get when a web app is deployed to
 * "Anyone within gunksclimbers.org" instead of "Anyone": a tidy 200, a page no
 * volunteer can use. So the check has to look at the body, and that is what
 * BROKEN_PAGE below is for.
 *
 * The rot also happens with nobody committing anything — a deployment is
 * revoked, a quota is hit, an organiser tightens sharing — which is why this
 * runs on a clock rather than only on a push.
 */

import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The links worth waking somebody up for, and how to tell they are healthy.
 *
 * Everything else on the site gets checked too, but only ever reported — see
 * the note on `critical` in checkLink(). A sponsor whose site is down for an
 * afternoon is their problem; our sign-up form being a dead end is ours, and
 * the two must not share an alarm or the alarm stops meaning anything.
 *
 * `expect` is the strongest check in the file when it is set: a string only the
 * real page contains. A denylist can only catch the error pages we have already
 * seen, and Google rewords those; "the form says what the form says" catches
 * every future variant at once. It is not hard-coded because the form's wording
 * is the GCC's to change without touching this repo — set it as a repository
 * variable (Settings → Secrets and variables → Actions → Variables) named
 * VOLUNTEER_MARKER, to a phrase from the form that isn't going anywhere. Until
 * somebody does, every run prints the page's title and size so there is an
 * obvious thing to copy.
 */
const EXPECTATIONS = [
  {
    host: "script.google.com",
    what: "the volunteer sign-up form",
    expect: process.env.VOLUNTEER_MARKER || "",
    fix: 'Check Apps Script → Deploy → Manage deployments: the deployment is live, and "Who has access" is Anyone. If it was redeployed, the new /exec URL goes in index.html.',
  },
  {
    host: "pretix.eu",
    what: "the ticket shop",
    expect: "",
    fix: "Check the shop is live at pretix.eu → GunksFest 2026 → Settings, and that the event is public.",
  },
];

/**
 * Text that means the fetch succeeded and the page is still broken.
 *
 * Only applied to the critical links above, all of which are Google or pretix —
 * these phrases are their error pages, and a phrase like "you need permission"
 * could appear perfectly innocently in a sponsor's copy.
 */
const BROKEN_PAGE = [
  ["unable to open the file", "Google Drive's “unable to open the file” page"],
  ["you have requested does not exist", "Google's “file does not exist” page"],
  ["script function not found", "an Apps Script routing error"],
  ["service invoked too many times", "an Apps Script quota page"],
  ["you need permission", "a Google permission wall"],
  ["request access", "a Google “request access” wall"],
  ["exceeded maximum execution time", "an Apps Script timeout page"],
  ["this event is currently not available", "pretix's “event not available” page"],
];

/** Hosts you only ever land on when a link has stopped working for the public. */
const SIGN_IN_HOSTS = ["accounts.google.com", "workspace.google.com"];

/**
 * Google serves different pages to things that look like scripts than to things
 * that look like Chrome, and we care what a *visitor* gets — so ask as one.
 */
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every .html file in the repo, so a page added later is checked without anyone remembering to. */
async function htmlFiles() {
  const entries = await readdir(ROOT, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((p) => !p.includes("node_modules") && !p.includes(`${ROOT}/.git`))
    .sort();
}

/**
 * Pulls http(s) hrefs out of HTML with a regex rather than a parser, because a
 * parser is a dependency and this repo has none. The cost of the regex being
 * approximate is that it might miss an oddly-quoted link; the cost of a
 * dependency is npm install in a workflow that otherwise needs nothing.
 */
function linksIn(html) {
  const found = new Set();
  for (const [, url] of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    if (/^https?:\/\//i.test(url)) found.add(url.replace(/&amp;/g, "&"));
  }
  return found;
}

/** One line describing what actually came back, for the log and the job summary. */
function fingerprint({ status, finalUrl, title, bytes }) {
  return `HTTP ${status}, ${bytes} bytes, title ${JSON.stringify(title || "(none)")}, landed on ${finalUrl}`;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text();
  return {
    status: res.status,
    finalUrl: res.url || url,
    body,
    bytes: body.length,
    title: (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim(),
  };
}

/**
 * Checks one link, retrying before it believes bad news.
 *
 * The retries are spaced rather than immediate, and that spacing is the whole
 * point: this runs from a datacentre IP, and Google and pretix both throttle
 * those. An immediate retry hits the same rate limit; a minute apart does not.
 * Anything that fails all three attempts a minute apart is not a blip.
 */
async function checkLink(url, { critical, what, expect, fix }) {
  const delays = critical ? [0, 5_000, 25_000] : [0, 5_000];
  let last = "";

  for (const [attempt, delay] of delays.entries()) {
    if (delay) await sleep(delay);

    let page;
    try {
      page = await fetchPage(url);
    } catch (err) {
      last = `could not be reached (${err.name === "TimeoutError" ? "timed out after 20s" : err.message})`;
      continue;
    }

    const print = fingerprint(page);
    console.log(`  ${url}\n    ${print}`);

    if (page.status >= 400) {
      last = `returned HTTP ${page.status}`;
      continue;
    }

    // Everything past here is a page that loaded fine and may still be useless,
    // so only the links we have expectations for get judged on content.
    if (!critical) return null;

    const haystack = page.body.toLowerCase();
    const bad = BROKEN_PAGE.find(([text]) => haystack.includes(text));
    if (bad) {
      // Not retried: an error page is a considered answer, not a blip, and
      // asking again a minute later just gets the same considered answer.
      return `${what} served ${bad[1]} instead of loading (${print}). ${fix}`;
    }

    const signIn = SIGN_IN_HOSTS.some((h) => new URL(page.finalUrl).hostname.endsWith(h));
    if (signIn) {
      return `${what} redirected to a Google sign-in page (${print}) — so a logged-out volunteer cannot use it. ${fix}`;
    }

    if (expect && !page.body.includes(expect)) {
      return `${what} loaded but does not contain ${JSON.stringify(expect)}, the text we expect on it (${print}). ${fix}`;
    }

    if (!expect) {
      console.log(
        `    note: no marker set for this link — content is only checked against known error pages.`
      );
    }
    return null;
  }

  return `${what} ${last} on all ${delays.length} attempts. ${fix}`;
}

/**
 * Puts the findings somewhere a person will actually meet them — the same three
 * places, for the same reason, as scripts/fetch-pretix.mjs. The file is the only
 * one that reaches somebody who isn't already looking, and it is written even
 * when everything is fine: an empty file is how the workflow tells "all clear"
 * apart from "the run died before it got here", and only the first should close
 * the issue.
 */
async function report(findings) {
  for (const line of findings) {
    console.warn(line);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::${line.replace(/\r?\n/g, "%0A")}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = findings.length
      ? `### A link on the site is broken\n\n${findings.map((l) => `- ${l}`).join("\n")}\n`
      : "### Every link on the site answers\n\nThe sign-up form and the ticket shop both loaded, and neither is an error page.\n";
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (process.env.LINK_FINDINGS) {
    await writeFile(process.env.LINK_FINDINGS, findings.map((l) => `${l}\n`).join(""));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const given = args.filter((a) => !a.startsWith("--"));

  // url -> the pages that link to it, so a finding says where to go and fix it.
  const sources = new Map();
  if (given.length) {
    for (const url of given) sources.set(url, ["(command line)"]);
  } else {
    for (const file of await htmlFiles()) {
      const where = relative(ROOT, file);
      for (const url of linksIn(await readFile(file, "utf8"))) {
        sources.set(url, [...(sources.get(url) ?? []), where]);
      }
    }
  }

  console.log(`Checking ${sources.size} outbound link(s).`);
  const findings = [];

  for (const [url, where] of [...sources].sort()) {
    const host = new URL(url).hostname;
    const rule = EXPECTATIONS.find((e) => host === e.host || host.endsWith(`.${e.host}`));
    const problem = await checkLink(url, {
      critical: Boolean(rule),
      what: rule?.what ?? `the link to ${host}`,
      expect: rule?.expect ?? "",
      fix: rule?.fix ?? "",
    });

    if (!problem) continue;
    const line = `${problem} Linked from ${where.join(", ")}: ${url}`;
    // Only the links in EXPECTATIONS raise an issue. The rest are worth saying
    // out loud on the run's own page and worth nobody's inbox.
    if (rule) findings.push(line.replace(/\s+/g, " ").trim());
    else console.warn(`(not raised) ${line}`);
  }

  await report(findings);

  console.log(findings.length ? `\n${findings.length} finding(s).` : "\nAll clear.");
  // Findings do not fail the job by default: the workflow turns them into one
  // issue, and a failing job would email the same news a second time in a worse
  // wording. --strict is there for a human running it, or a future pre-merge gate.
  if (strict && findings.length) process.exitCode = 1;
}

await main();
