# GunksFest 2026 — Website

A simple, static website for **GunksFest**, the annual climbing festival in the
Shawangunks presented by the Gunks Climbers Coalition in partnership with Mohonk
Preserve. Built as plain HTML/CSS/JS with **no build step** so it can be hosted free
on **GitHub Pages** and edited by hand.

Live domain: **gunksfest.com** (gunksfest.org redirects here).

## Files

```
index.html          The landing page
schedule.html       Clinic schedule, rendered from data/schedule.json
css/style.css       All styling. Theme colors/fonts live in the :root variables at the top.
css/schedule.css    Schedule-page styles only. Reuses the palette from style.css.
js/main.js          Mobile nav toggle + footer year. No frameworks.
js/schedule.js      Renders the schedule and stamps live availability from pretix.
data/schedule.json  The clinic line-up, committed by the pretix sync workflow.
data/schedule.example.json  Sample data for previewing the layout (schedule.html?demo=1).
scripts/fetch-pretix.mjs    Pulls the line-up out of the pretix API. Run by the workflow.
assets/img/         Images go here (hero photo, logos, og-image). Currently placeholders.
assets/favicon.ico  Site icon (add one).
pages/              Reserved for future pages (tickets.html, faq.html).
CNAME               Tells GitHub Pages the custom domain is gunksfest.com. Don't delete.
.nojekyll           Tells GitHub Pages to serve files as-is (no Jekyll processing).
```

## The schedule page

> **Currently unlisted.** Nothing on the site links to `schedule.html`, and the page
> carries `<meta name="robots" content="noindex, nofollow">`. It is live and reachable
> by direct URL, but it stays out of search results until you take the steps under
> [Going live](#going-live) below.

`schedule.html` never hardcodes a clinic. It draws everything from pretix, in two steps:

1. **Build time.** `.github/workflows/pretix-sync.yml` runs `scripts/fetch-pretix.mjs`
   every six hours (and on demand from the Actions tab). The script reads the pretix
   REST API with an API token and commits `data/schedule.json`. Because the schedule
   is a committed file, the page renders instantly and keeps working if pretix is down.
2. **Page load.** `js/schedule.js` renders that file, then quietly fetches pretix's
   public widget endpoint to stamp live **Open / N spots left / Sold out** badges on
   top. That endpoint needs no token and allows cross-origin reads, so it is safe to
   call straight from the browser. If it fails, the page keeps the committed prices
   and links.

No API token ever reaches the browser, and nothing in `data/schedule.json` is more
private than what the public ticket shop already shows.

### One-time setup

In pretix: **Organizer → Teams →** a team with read access to the event **→ API tokens
→** create one.

In GitHub: **Settings → Secrets and variables → Actions →** add one secret,
`PRETIX_TOKEN`. That is the only required setting — the shop at
<https://pretix.eu/gunksclimbers/gunksfest2026/> is already the default.

Three optional variables override it, for a rename, next year's event, or a
self-hosted pretix: `PRETIX_ORGANIZER` (default `gunksclimbers`), `PRETIX_EVENT`
(default `gunksfest2026`), `PRETIX_URL` (default `https://pretix.eu`).

Then run **Actions → Sync pretix schedule → Run workflow** once to fill in the first
snapshot. Until that happens the page shows a "line-up isn't published yet" notice.

### Getting times onto a clinic

Clinics are products (items) in a single pretix event, so pretix needs to be told when
each one runs. The script looks in two places, in order:

1. **Program times** (preferred) — on the product, under *Program times*, add a start
   and end (and optionally a location). A product can have several, and each becomes
   its own row on the schedule.
2. **Item meta properties** (fallback, for older pretix versions) — define these once
   under *Organizer settings → Item meta properties*, then fill them in per product:

   | Property     | Example              | Shows up as              |
   | ------------ | -------------------- | ------------------------ |
   | `start`      | `2026-10-10 09:00`   | the clinic's start time  |
   | `end`        | `2026-10-10 13:00`   | the end time             |
   | `location`   | `The Trapps`         | a chip on the card       |
   | `guide`      | `Sarah K.`           | a chip on the card       |
   | `difficulty` | `Beginner`           | a chip on the card       |

   Naive times are read in the event's own timezone.

Products with neither land in a **Passes & Add-ons** block at the bottom — which is
exactly where the Stay & Play pass belongs. Categories become the filter chips.

Add-ons are handled by whether they carry a time. A clinic sold as an add-on to a
festival pass still appears on the schedule (its button reads *View in shop*, since
an add-on can't be checked out on its own). An add-on with no time is merch or an
extra, and is left off the page entirely.

### Going live

When the line-up is published and the page looks right, three things flip it public:

1. Delete the `<meta name="robots" content="noindex, nofollow">` tag from
   `schedule.html` (there's a comment above it saying so).
2. Add the nav links back to `index.html` — the header nav, the burger menu, and the
   footer each want an `<a href="schedule.html">Schedule</a>` after the Venue entry.
3. Optionally point the "coming soon" copy in the `#updates` section at the page.

**Why no `robots.txt` entry?** Because `Disallow` and `noindex` pull against each
other. A disallowed page is never fetched, so a crawler never reads its `noindex` —
and if anyone links the URL, Google can list it as a bare result anyway. `noindex`
alone is the reliable way to keep a reachable page out of the index, and it needs the
crawler to be *allowed* in to work. Don't add both.

### Local preview

```
npx http-server -p 8080 -c-1 .
# http://127.0.0.1:8080/schedule.html          the real (or placeholder) data
# http://127.0.0.1:8080/schedule.html?demo=1   sample clinics, to check the layout
```
