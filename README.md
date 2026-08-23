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
schedule.html       Clinic schedule, rendered from data/schedule.json
css/style.css       All shared styling. Theme colours/fonts are the :root variables at the top.
css/schedule.css    Schedule-page styles only.
js/main.js          Nav, slideshows, parallax, rope dividers. No frameworks.
js/schedule.js      Renders the schedule and stamps live availability from pretix.
data/schedule.json  The clinic line-up, committed by the pretix sync workflow.
data/schedule.example.json   Sample data — see schedule.html?demo=1
scripts/fetch-pretix.mjs     Pulls the line-up from pretix. Run by the workflow.
scripts/pretix-rename.mjs    One-off: strips "2026_" off product names IN pretix.
assets/img/         Photos, logos, og-image.
CNAME               The custom domain for GitHub Pages. Don't delete.
.nojekyll           Serve files as-is, no Jekyll processing.
```

## Local preview

```
npx http-server -p 8080 -c-1 .
# http://127.0.0.1:8080/schedule.html          real data
# http://127.0.0.1:8080/schedule.html?demo=1   sample data, to check the layout
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

## The schedule page is public

It is indexed and linked from the home page in two places: the "Clinics &
Workshops" card under *What is GunksFest?*, and the clinics line in the Stay &
Play pass list. The `noindex` tag it carried while unlisted is gone.

Note the home page's nav bar does **not** carry a Schedule link, while the
schedule page's own nav does — so the nav gains an item when you move between
them. Adding `<a href="schedule.html">Schedule</a>` to the header nav, burger
menu and footer in `index.html` is the fix if that inconsistency is unwanted.

If it ever needs hiding again, put back the `<meta name="robots"
content="noindex, nofollow">` tag and drop the two links. Don't reach for a
`robots.txt` `Disallow` instead: a disallowed page is never fetched, so the
crawler never reads the `noindex` — and can still list the bare URL if anyone
links it. `noindex` needs the crawler let in to work.
