# GunksFest 2026 — Website

A simple, static website for **GunksFest**, the annual climbing festival in the
Shawangunks presented by the Gunks Climbers Coalition in partnership with Mohonk
Preserve. Built as plain HTML/CSS/JS with **no build step** so it can be hosted free
on **GitHub Pages** and edited by hand.

Live domain: **gunksfest.com** (gunksfest.org redirects here).

## Files

```
index.html          The landing page (the whole site, for now)
css/style.css       All styling. Theme colors/fonts live in the :root variables at the top.
js/main.js          Mobile nav toggle + footer year. No frameworks.
assets/img/         Images go here (hero photo, logos, og-image). Currently placeholders.
assets/favicon.ico  Site icon (add one).
pages/              Reserved for future pages (schedule.html, tickets.html, faq.html).
CNAME               Tells GitHub Pages the custom domain is gunksfest.com. Don't delete.
.nojekyll           Tells GitHub Pages to serve files as-is (no Jekyll processing).
```

## Editing the content

Almost everything is text in `index.html`.

**Images the site expects** — drop these three files into `assets/img/` with these
exact names (the HTML/CSS already point at them):

| File | What it is |
|------|------------|
| `assets/img/hero.jpg` | The Gunks cliff hero photo (large, landscape). |
| `assets/img/gcc-logo.jpg` | Gunks Climbers Coalition logo. |
| `assets/img/mohonk-logo.png` | Mohonk Preserve logo (transparent PNG ideal). |
| `assets/img/mohonk-visitor-center.jpg` | Background for the "Presented in Partnership" block. Currently a Mohonk Preserve Skytop Tower photo — swap freely for another wide/landscape Mohonk shot. |
| `assets/img/ulster-fairground.jpg` | Background for the "A New Home for 2026" block. **Currently a placeholder** — replace with an Ulster County Fairground photo (wide/landscape). |
| `assets/img/gallery/slide-01…12.jpg` | The crossfading photos behind "What is GunksFest?" (extracted from the sponsor deck). |

Still to fill in when confirmed (search `index.html` for `TODO`):

- **Social links** — Instagram/Facebook `href="#"` placeholders in the Updates section and footer.
- **Dates** — "August 2026 · Dates to be announced" in the hero.
- **Share image** — add `assets/img/og-image.jpg` (1200×630) for nice link previews.

Already wired up: contact email (`events@gunksclimbers.org`) in the Get Updates button and footer.

### Retheming colors

Open `css/style.css` and edit the variables under `:root` at the very top
(`--color-forest`, `--color-accent`, etc.). Changing them updates the whole site.

## Previewing locally

Just open `index.html` in a browser — it works with no server. To test the way it'll be
served (recommended), run a local server from this folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying to GitHub Pages

1. Create a GitHub repository and push these files to the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The included `CNAME` file sets the custom domain to `gunksfest.com`. GitHub Pages will pick it up.
4. **Point DNS at GitHub** (do this at your domain registrar — outside this repo):
   - Apex `gunksfest.com` — add GitHub Pages `A` records:
     - `185.199.108.153`
     - `185.199.109.153`
     - `185.199.110.153`
     - `185.199.111.153`
     - (optionally the matching `AAAA`/IPv6 records, listed in GitHub's docs)
   - `www.gunksfest.com` — add a `CNAME` record pointing to `YOUR-USERNAME.github.io`.
   - `gunksfest.org` — set up a registrar-level forward/redirect to `https://gunksfest.com`.
5. Back in **Settings → Pages**, once DNS resolves, check **Enforce HTTPS**.

DNS changes can take anywhere from minutes to a day to propagate.

## Growing into a multi-page site

When you're ready for dedicated pages, add files under `pages/` (e.g. `pages/schedule.html`),
copy the header/footer markup from `index.html`, and change the nav `href`s from anchors
(`#about`) to page links (`pages/schedule.html`). The CSS and JS already support it.
