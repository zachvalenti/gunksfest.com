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
js/pretix.js        Shared with both pages: availability, description sanitising, money.
js/schedule.js      Renders the schedule and stamps live availability from pretix.
js/tickets.js       Renders the ticket line-up in Stay & Play on the landing page.
data/schedule.json  The clinic line-up, committed by the pretix sync workflow.
data/schedule.example.json   Sample data — see clinics.html?demo=1
scripts/fetch-pretix.mjs     Pulls the line-up from pretix. Run by the workflow.
scripts/pretix-rename.mjs    One-off: strips "2026_" off product names IN pretix.
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

## Linking out vs embedding the widget

**The site links out to the pretix shop. It does not embed pretix's checkout
widget.** That was a decision, not an omission, so here is the reasoning — and
what would have to be true to change it.

Clinics are pretix **add-on products**: you pick a pass, and pretix's own
checkout then offers the clinics that attach to it. That is where the
interesting half of the purchase happens, and the widget doesn't do it — an
embedded widget lists products and then hands the buyer to pretix to finish.
So the widget wouldn't keep anyone on gunksfest.com through the part that
matters; it would only move the first click.

Against that near-zero gain:

- **A cross-site cart is fragile.** The widget keeps cart state for pretix.eu
  from a page on gunksfest.com. Safari's tracking prevention and Firefox's
  total cookie protection are in the business of stopping exactly that, and
  the failure mode is a buyer whose cart empties between steps — the single
  worst bug a ticket page can have, and one that never reproduces on the
  developer's machine.
- **It's a third-party script in the critical path.** `widget/v1.en.js` is
  someone else's JavaScript deciding whether anyone can buy a ticket today.
  Linking out means pretix being slow costs a visitor a slow shop, not a
  broken page.
- **The one real benefit is already here.** What an embed buys you is live
  prices and live sold-out state on our page. `js/pretix.js` gets both from
  pretix's public widget *endpoint* — the JSON the widget itself reads — and
  stamps them onto markup we control. Same information, no embedded checkout.

Reconsider if clinics ever stop being add-ons and become standalone products,
or if pretix ships a checkout that genuinely completes in-page. If you do embed
it, the domain has to be added to the event's widget settings in pretix first,
and Safari with "Prevent cross-site tracking" on is the test that matters —
not Chrome.

## The volunteer registration page

Volunteering is a Google Apps Script web app, linked from the `#volunteer`
section on the landing page, from both navs and the footer on both pages, and
from the note under the All-Access Pass (volunteers get a discount, so the ask
is worth making *before* someone buys).

It is linked, not iframed. It writes to the GCC's own spreadsheet and has to
keep working with nobody around to redeploy a static site; an `<iframe>` would
inherit this page's width and none of its styling, break the back button, and
hand a visitor a form they can't tell is ours anyway. The URL lives in
`index.html` and nowhere else — search for `script.google.com` to find it.

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

Two pages read that snapshot. `clinics.html` renders the timed sessions;
`index.html` renders everything in `unscheduled` that isn't an add-on — the
weekend passes, the day passes and the film tickets — as the ticket list under
Stay & Play. Add a ticket type in pretix and it appears on the landing page at
the next sync, in the order pretix lists it, with no edit here.

The one hand-written exception is the All-Access Pass card, which is prose
about one specific product and carries that product's pretix id in
`data-item-id`. `js/tickets.js` uses the id to stamp the card's live badge, to
keep the pass from appearing twice, and to warn in the console if pretix no
longer has it — which is the signal that the card's copy and the shop have
drifted apart.

`shop.live` in the snapshot is pretix's own "is this shop open" flag. If it is
false, `js/tickets.js` puts the page back into "tickets aren't on sale yet"
and points the buttons at the updates list. It can be up to six hours stale,
which matters in one direction only: a shop taken offline stays advertised
here until the next sync.

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
