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
