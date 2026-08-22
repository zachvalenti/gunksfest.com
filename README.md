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
   | `difficulty` | `Beginner`           | the level filter pills   |

   Naive times are read in the event's own timezone.

### What the sync cleans up

Two things the REST API hands over raw, normalised in `scripts/fetch-pretix.mjs`:

- **Descriptions are Markdown.** pretix renders them in its own storefront but the
  API returns the source, so `mdToHtml()` converts a safe subset (paragraphs, bold,
  italic, lists, links, headings). Everything is HTML-escaped first, and the browser
  re-checks the result against a tag allowlist before rendering.
- **Titles carry bookkeeping.** A `2026_` prefix and a trailing `(Saturday 9am-1pm)`
  that just repeats the time shown beside it both get stripped for display. The
  original is kept on each record as `rawName`, so nothing is lost.

Descriptions run long — a few hundred words each — so the page collapses them to a
few lines with a **More** toggle. Without it, 45 clinics is twenty screens of scroll.

Products with neither land in a block at the bottom, named after their pretix
category when they share one (yours reads **Tickets**) — which is exactly where the
weekend passes and film tickets belong.

### The Filters row

Under the day pills sits a row of filter pills: **Free / Paid**, then **Beginner /
Intermediate / Advanced**. Picks inside one group are an *or* (Free + Paid is
everything), across the two groups an *and*, and both are an *and* with whichever
day is selected. A **Clear** link appears as soon as anything is on.

Free/Paid comes from the price: a $0 clinic is Free — it costs nothing on top of a
pass — and anything with a fee is Paid. The three level pills come from the
`difficulty` item meta property in pretix, and **only** from there. Nothing is
guessed from the title or the description: a clinic whose blurb happens to say
"great for beginners *and* intermediates" would be mislabelled either way, and the
cost of that mistake is somebody standing at the wrong trailhead. Until difficulties
are filled in, the level pills simply don't appear — a pill is only rendered when at
least two options in its group have something behind them, so the row never shows a
control that filters nothing. `schedule.html?demo=1` shows the full five-pill row
against the sample data.

Add-ons are handled by whether they carry a time. A clinic sold as an add-on to a
festival pass still appears on the schedule (its button reads *View in shop*, since
an add-on can't be checked out on its own). An add-on with no time is merch or an
extra, and is left off the page entirely.

### Why the schedule page is dark

The rope dividers hide a seam by laying a feathered band of `rgba(20,37,31,·)`
across it. That only disappears if both sides of the join are already dark, which
is true everywhere on the home page. The schedule list is therefore dark too, and
its background is anchored top and bottom on `#14251f` — the exact colour the band
is made of — so the band cannot be seen against it. Change that anchor colour and
the seams come back.

### Photos on the schedule page

Two background slots are wired up in `css/schedule.css` and expect these files:

| Path | Where it shows |
| --- | --- |
| `assets/img/2025-08-gunksfest-chris-vultaggio-2097.JPG` | behind the "Clinics & Schedule" hero |
| `assets/img/2025-08-gunksfest-sarah-karbachinskiy-5350.jpg` | behind "Questions about a clinic?" |

Both are resized to 2400px wide and re-encoded (mozjpeg, q78) — wide enough for a
full-bleed background at 2x DPR. Camera originals are far too heavy to ship: the
hero came in at 8640x5760 and 18MB, which is 38x the size that renders identically
here. Re-run that step on any replacement photo.

Each is the first layer of a two-layer background, with the brand green gradient
underneath. A missing file paints nothing and the gradient carries the section, so
the page never shows a broken image — but it also never warns you, and the paths are
case-sensitive on GitHub Pages (note the uppercase `.JPG` on the first one).

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
