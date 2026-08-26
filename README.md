# GunksFest 2026 — Website

Static site for **GunksFest**, the annual climbing festival in the Shawangunks,
presented by the Gunks Climbers Coalition with Mohonk Preserve. Plain HTML, CSS
and JS with **no build step**: what's in this repo is what the browser gets.
Hosted free on GitHub Pages at **gunksfest.com** (gunksfest.org redirects here).

> **Read the source, not this file.** Every technique, trade-off and reason is
> commented in place, next to the code it explains — the stylesheets and scripts
> are written to be read start to finish. This README only covers what you
> can't learn by opening a file.

## Files

```
index.html          Landing page
clinics.html        The clinics page — schedule rendered from data/schedule.json
schedule.html       Redirect stub left behind when clinics.html was renamed
css/style.css       All shared styling. Theme colours/fonts are the :root variables at the top.
css/schedule.css    Schedule-page styles only.
js/main.js          Nav, slideshows, parallax, rope dividers. No frameworks.
js/schedule.js      Renders the schedule and stamps live availability from pretix.
data/schedule.json  The clinic line-up, committed by the pretix sync workflow.
data/schedule.example.json   Sample data — see clinics.html?demo=1
scripts/fetch-pretix.mjs     Pulls the line-up from pretix. Run by the workflow.
scripts/pretix-rename.mjs    One-off: strips "2026_" off product names IN pretix.
scripts/free-seat-capacity.mjs  Free-clinic seats per time block — how many volunteers fit.
assets/img/         Photos, logos, og-image.
CNAME               The custom domain for GitHub Pages. Don't delete.
.nojekyll           Serve files as-is, no Jekyll processing.
```

## Local preview

```
npx http-server -p 8080 -c-1 .
# http://127.0.0.1:8080/clinics.html           real data
# http://127.0.0.1:8080/clinics.html?demo=1    sample data, to check the layout
```

## The pretix pipeline

The schedule hardcodes nothing. A workflow pulls the line-up from the ticket
shop every six hours and commits `data/schedule.json`; the page renders that
file instantly, then fetches pretix's public widget endpoint in the browser to
stamp live availability on top. No API token ever reaches the browser.

- **Setup** (one secret, `PRETIX_TOKEN`) is documented in the header comment of
  `.github/workflows/pretix-sync.yml`.
- **Getting times, locations and difficulty onto a clinic** — which pretix
  fields the script reads, and what each one drives — is documented at the top
  of `scripts/fetch-pretix.mjs`.
- **Renaming products in pretix** (the only thing here that writes to the shop)
  is documented in `.github/workflows/pretix-rename.yml`.
- **How many free-clinic seats there are, and when** — run the *Free clinic seat
  capacity* workflow from the Actions tab. It pulls a fresh snapshot, reports the
  seats per time block on the run summary, and commits nothing.

## The clinics page is public

`clinics.html` is indexed and reachable from the home page four ways: the nav
bar, the burger menu, the footer, and two contextual links in the copy — the
"Clinics & Workshops" card under *What is GunksFest?*, and the clinics line in
the Stay & Play pass list.

It was called `schedule.html` until it was renamed. `schedule.html` is now a
meta-refresh stub pointing here, since that URL was public before the rename;
delete it once nothing links to it. Internal names still say "schedule"
(`css/schedule.css`, `js/schedule.js`, `data/schedule.json`, the
`.schedule-*` classes) because they describe the schedule the page renders,
which is still what they are.

The nav reads **Tickets** where the section is titled **Stay & Play** — the
label is deliberately not the section heading, so the nav names what a visitor
is looking for rather than what the section is called.

If the page ever needs hiding again, put back the `<meta name="robots"
content="noindex, nofollow">` tag and drop the links. Don't reach for a
`robots.txt` `Disallow` instead: a disallowed page is never fetched, so the
crawler never reads the `noindex` — and can still list the bare URL if anyone
links it. `noindex` needs the crawler let in to work.
