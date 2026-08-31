/* GunksFest — the ticket options on the landing page.
 *
 * Same two-source design as the clinics page (see js/schedule.js): the list is
 * rendered from data/schedule.json, the snapshot the pretix sync workflow
 * commits every six hours, and then pretix's public widget endpoint is asked in
 * the background what is still on sale so "Sold out" and "3 spots left" can be
 * stamped on top. Nothing here waits on pretix to show a visitor a price.
 *
 * What this file deliberately does NOT do is embed pretix's checkout widget.
 * The reasons are in README.md under "Linking out vs embedding the widget" —
 * the short version is that clinics are pretix *add-on* products, so the
 * interesting half of the purchase happens in pretix's own checkout either way,
 * and an embedded widget only adds a cross-site cart that Safari breaks.
 *
 * Progressive enhancement, and worth being precise about what that means here:
 * the markup that ships already names the headline pass, its price, what it
 * includes, and links to the shop. With scripting off, that is a complete and
 * true page — a visitor can still buy a ticket. This file adds the rest of the
 * line-up and the live badges. If it never runs, nothing is broken; if pretix
 * is down, the prices are still right.
 */
(function () {
  "use strict";

  var listEl = document.getElementById("tickets-list");
  if (!listEl) return;

  /* Which bucket a ticket belongs in. pretix puts every one of these in a
     single "Tickets" category, so the grouping has to come from somewhere else:
     first an item meta property called `group`, and failing that the product
     name. Reading the name is a compromise and worth naming as one — rename a
     product in pretix and it silently lands in the wrong bucket. What keeps
     that from being a real bug is the last rule in groupTickets(): anything
     matching nothing still gets rendered, under its own heading. A
     misclassified ticket is a cosmetic problem; a disappeared one is a lost
     sale, and the code is arranged so the second can't happen.

     To make it exact, add an item meta property `group` in pretix (Organizer →
     Item meta properties, then set it per product) with one of these keys. The
     name test is then never consulted. */
  var GROUPS = [
    { key: "weekend", title: "Full Weekend", days: "Fri\u2013Mon", test: /weekend/i },
    { key: "day",     title: "Single Day",   days: "One day",       test: /(saturday|sunday|single.?day)\s+pass/i },
    { key: "film",    title: "Films Only",   days: "Evenings",      test: /films?\s*only/i }
  ];
  var OTHER_TITLE = "More tickets";

  var fallbackEl = document.getElementById("tickets-fallback");
  var noteEl = document.getElementById("tickets-note");
  /* Only shown when a column actually says "Some" — a footnote explaining a
     word that isn't on the page reads like a warning about nothing. */
  var someEl = document.getElementById("tickets-some");
  var card = document.querySelector(".pass-card");

  fetch("data/schedule.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      var shop = data.shop || {};
      /* The headline pass is no longer filtered out. It was, when this
         rendered a row per product and printing it twice would have been a
         duplicate; the table summarises whole groups now, and the headline is
         a Full Weekend pass, so leaving it out would make that column describe
         a range of tickets that quietly excluded the one on the card beside
         it. It contributes to its column and is never listed on its own. */
      var tickets = (data.unscheduled || []).filter(function (item) {
        // Add-ons — clinics, merch — are chosen inside checkout, on top of a
        // pass. Only the things you can buy on their own belong in this table.
        return !item.isAddon;
      });
      if (!tickets.length) return;

      /* live is pretix's own "is this shop open to the public" flag, carried
         through by the sync. It can be up to six hours stale, which is the one
         place that matters: if the shop is taken back offline the page keeps
         offering tickets until the next sync. It is the right trade for the
         opposite case — a snapshot that says live long before anyone visits. */
      if (shop.live === false) {
        showComingSoon();
        return;
      }

      render(tickets, shop);
      GunksPretix.loadAvailability(shop, function (byId) { stamp(byId); });
    })
    .catch(function (err) {
      if (window.console) console.warn("tickets: " + err.message + fileProtocolHint());

      /* A visitor gets no apology — the pass above still has its real price and
         a working buy link, which is the whole point of putting them in the
         markup. But file:// can only ever be someone previewing from disk, so
         that one case gets the answer on the page rather than buried in a
         console nobody has open. A diagnostic you have to go looking for is a
         diagnostic that doesn't get read. */
      if (window.location.protocol === "file:" && fallbackEl) {
        fallbackEl.innerHTML =
          "<strong>This page is open from disk.</strong> Browsers block a file:// " +
          "page from fetching its own data, so the ticket list can't load. " +
          "Serve the folder instead: <code>npx http-server -p 8080 -c-1 .</code>";
        fallbackEl.className = "tickets-fallback is-devnote";
      }
    });

  /* Opening index.html straight off disk gives the page a file:// origin, and
     a fetch from there is blocked outright — the browser treats the local
     filesystem as an opaque origin with no CORS. Nothing about the site is
     wrong; the ticket list simply never gets its data, so the page falls back
     to the pass and the shop link. It looks exactly like a bug, which is why
     it is worth naming: any page that fetches its own data needs a real server
     in front of it, even for a five-second look. */
  function fileProtocolHint() {
    if (window.location.protocol !== "file:") return "";
    return " — this page is open from disk (file://), where the browser blocks " +
           "the fetch of data/schedule.json. Serve the folder instead: " +
           "npx http-server -p 8080 -c-1 .";
  }

  /* ---------- rendering ---------- */

  /* Groups run in GROUPS order; within a group, pretix's own order is kept.
     Whoever arranges the products in the backend is deciding what a visitor
     should see first, and re-sorting inside a group would quietly overrule
     them. */
  function groupTickets(tickets) {
    var buckets = {};
    var other = [];
    tickets.forEach(function (item) {
      var declared = item.meta && item.meta.group;
      var match = null;
      if (declared) {
        match = GROUPS.filter(function (g) { return g.key === String(declared).toLowerCase(); })[0];
      }
      if (!match) {
        match = GROUPS.filter(function (g) { return g.test.test(item.name || ""); })[0];
      }
      if (!match) { other.push(item); return; }   // never dropped, just unsorted
      (buckets[match.key] = buckets[match.key] || []).push(item);
    });

    var out = GROUPS
      .filter(function (g) { return buckets[g.key] && buckets[g.key].length; })
      .map(function (g) { return { title: g.title, days: g.days, items: buckets[g.key] }; });
    if (other.length) out.push({ title: out.length ? OTHER_TITLE : "", items: other });
    return out;
  }

  /* ---------- what each group includes ---------- */

  /* These marks are read out of the product's own name and description, which
     is worth being blunt about: pretix publishes no structured "includes
     camping" field, so the ticks below are inferred from marketing prose
     written by whoever last edited the shop. Rename a product or reword a
     description and a mark can change. Three things keep that from being a
     lie on a page about money:

     1. A negative is tested BEFORE a positive, always. "Full Weekend Pass with
        NO Camping" contains the word "Camping", and a yes-first test would
        promise the opposite of what the ticket says.
     1b. A negative has to sit NEXT TO the word it negates — hence the {0,20}
        style bounds rather than a loose wildcard. The Saturday Pass reads
        "does not include camping or Mohonk Preserve Access, which you will
        need to purchase the day of your clinic": an unbounded gap let "not
        include" reach all the way to "clinic" and struck out the clinics the
        ticket does include. The bound is what stops one sentence's negative
        leaking onto a different feature.
     2. Silence is never a yes. A feature nobody mentions comes out "unknown"
        and is then shown as not included — the safe direction to be wrong in.
        Claiming less than a ticket offers sends someone to ask; claiming more
        sends them to the gate with the wrong ticket.
     3. Anything unresolved is named in the console, so a wording change that
        stops matching is visible to whoever runs the page rather than silent.

     The durable fix is item meta properties in pretix — the same mechanism
     GROUPS already prefers over its name test. Set `camping`, `preserve`,
     `films` or `clinics` on a product (Organizer → Item meta properties) to
     "yes" or "no" and that value is taken as final, no prose consulted. */
  var FEATURES = [
    { key: "films", label: "Evening films & vendors",
      no:  /no films?\b|not include\w*[^.]{0,20}films?\b/i,
      yes: /film (festival )?pass|films?\s*(only|starting)|evening film/i },
    { key: "clinics", label: "Daytime clinics",
      no:  /no clinics?\b|not include\w*[^.]{0,20}clinics?\b/i,
      yes: /clinics?\s*(are\s*)?available/i },
    { key: "camping", label: "Camping",
      no:  /no camping\b|not include\w*[^.]{0,30}\bcamping\b/i,
      yes: /car\/tent camping|includes[^.]*\bcamping|with camping/i },
    { key: "preserve", label: "Mohonk Preserve access",
      no:  /no camping or preserve access|not include\w*[^.]{0,40}preserve|no preserve\b/i,
      yes: /\d-day (access to the )?mohonk preserve|mohonk preserve[, ]*\d-day|\d-day mohonk preserve/i }
  ];

  var unresolved = [];

  /* Name and description together, tags stripped. The description is where
     most of these facts actually live — the names only carry camping and
     preserve — so searching one without the other would lose clinics and
     films entirely. */
  function haystack(item) {
    return (String(item.name || "") + " " + String(item.description || ""))
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
  }

  function featureState(item, feature) {
    var declared = item.meta && item.meta[feature.key];
    if (declared) return /^(yes|true|1)$/i.test(String(declared)) ? "yes" : "no";

    var text = haystack(item);
    if (feature.no.test(text)) return "no";       // negatives first — see above
    if (feature.yes.test(text)) return "yes";

    unresolved.push(feature.key + " on “" + (item.name || item.id) + "”");
    return "unknown";
  }

  /* A column is a whole group, and a group's tickets need not agree: two of
     the four weekend passes include camping and two do not. That is a real
     answer, not a missing one, so it gets its own state rather than being
     rounded to a tick or a cross — either of which would be false for half
     the tickets in the column. */
  function groupState(items, feature) {
    var seen = {};
    items.forEach(function (item) { seen[featureState(item, feature)] = true; });
    if (seen.yes && !seen.no && !seen.unknown) return "yes";
    if (seen.yes) return "some";
    return "no";
  }

  function priceRange(items, shop) {
    var prices = items.map(function (i) { return Number(i.price); })
                      .filter(function (n) { return !isNaN(n); });
    if (!prices.length) return "";
    var lo = Math.min.apply(null, prices), hi = Math.max.apply(null, prices);
    return (lo === hi ? "" : "from ") + GunksPretix.money(lo, shop.currency);
  }

  /* ---------- the matrix ---------- */

  function render(tickets, shop) {
    listEl.innerHTML = "";
    unresolved = [];

    var groups = groupTickets(tickets);
    if (!groups.length) return;

    var table = document.createElement("table");
    table.className = "ticket-matrix";

    var cap = document.createElement("caption");
    cap.className = "matrix-caption";
    cap.textContent = "What each way in includes.";
    table.appendChild(cap);

    /* The corner cell is a <td>, not a <th>: it heads neither the row of group
       names nor the column of feature names, and calling it a header would
       have a screen reader announce it as one for both. */
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    headRow.appendChild(document.createElement("td")).className = "matrix-corner";

    groups.forEach(function (group) {
      var th = document.createElement("th");
      th.scope = "col";
      th.className = "matrix-head";
      th.dataset.itemIds = group.items.map(function (i) { return i.id; }).join(",");

      var name = document.createElement("span");
      name.className = "matrix-group";
      name.textContent = group.title;
      th.appendChild(name);

      var price = document.createElement("span");
      price.className = "matrix-price";
      price.textContent = priceRange(group.items, shop);
      th.appendChild(price);

      var badge = document.createElement("span");
      badge.className = "ticket-badge";
      badge.hidden = true;
      th.appendChild(badge);

      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    tbody.appendChild(featureRow("Days", groups.map(function (g) {
      return textCell(g.days || "—");
    })));
    FEATURES.forEach(function (feature) {
      tbody.appendChild(featureRow(feature.label, groups.map(function (g) {
        return markCell(groupState(g.items, feature));
      })));
    });
    table.appendChild(tbody);

    /* One Select per column, all pointing at the shop's own product list.
       A column stands for several products and ?item= names exactly one, so
       there is no honest per-column preselect to send — the choice between
       the tickets inside a group is made on pretix, where their full names
       and descriptions are. */
    var tfoot = document.createElement("tfoot");
    var footRow = document.createElement("tr");
    footRow.appendChild(document.createElement("td")).className = "matrix-corner";
    groups.forEach(function (group) {
      var td = document.createElement("td");
      td.className = "matrix-cta";
      var a = document.createElement("a");
      a.className = "btn btn-small";
      a.href = shop.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Select";
      a.setAttribute("aria-label", "Select from " + group.title + " tickets");
      td.appendChild(a);
      footRow.appendChild(td);
    });
    tfoot.appendChild(footRow);
    table.appendChild(tfoot);

    listEl.appendChild(table);
    listEl.hidden = false;
    if (fallbackEl) fallbackEl.hidden = true;
    if (noteEl) noteEl.hidden = false;
    if (someEl) someEl.hidden = !table.querySelector(".is-some");

    if (unresolved.length && window.console) {
      console.warn("tickets: could not read " + unresolved.join("; ") +
                   " from the pretix text — shown as not included. Set an item " +
                   "meta property in pretix to say so outright.");
    }
  }

  function featureRow(label, cells) {
    var tr = document.createElement("tr");
    var th = document.createElement("th");
    th.scope = "row";
    th.className = "matrix-label";
    th.textContent = label;
    tr.appendChild(th);
    cells.forEach(function (c) { tr.appendChild(c); });
    return tr;
  }

  function textCell(text) {
    var td = document.createElement("td");
    td.className = "matrix-cell matrix-text";
    td.textContent = text;
    return td;
  }

  /* The tick and the cross are drawn in CSS, the same way .pass-list's ticks
     are — no icon font, no image request, and they inherit colour. Which
     means they are invisible to a screen reader, so each carries the word it
     stands for as its accessible name. */
  function markCell(state) {
    var td = document.createElement("td");
    td.className = "matrix-cell";

    if (state === "some") {
      td.className += " matrix-text is-some";
      td.textContent = "Some";
      return td;
    }

    var mark = document.createElement("span");
    mark.className = "mark mark-" + state;
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", state === "yes" ? "Included" : "Not included");
    td.appendChild(mark);
    return td;
  }

  /* The headline card in the markup is hand-written around one specific pretix
     product, so its id is written down in the HTML rather than guessed here.
     If the two ever part company the badge is skipped and the console says so
     — better a missing badge than one that describes a different product. */
  function stamp(byId) {
    var item = card && byId[card.dataset.itemId];
    var passBadge = card && card.querySelector(".pass-badge");
    if (card && !item && window.console) {
      console.warn("tickets: pretix has no item " + card.dataset.itemId +
                   " — check the id on .pass-card against data/schedule.json");
    }
    if (item && passBadge) {
      var info = GunksPretix.describeAvailability(item);
      if (info) {
        passBadge.textContent = info.text;
        passBadge.className = "pass-badge is-" + info.tone;
        passBadge.hidden = false;
      }
    }

    /* A column's badge is the whole group's answer, so it only says something
       when it is true of every ticket in it: "Sold out" when nothing in the
       group is left, "Limited" when at least one is running low. Anything
       else stays quiet — "On sale" on all three columns is not news. */
    [].slice.call(document.querySelectorAll(".matrix-head[data-item-ids]")).forEach(function (th) {
      var badge = th.querySelector(".ticket-badge");
      if (!badge) return;

      var states = th.dataset.itemIds.split(",").map(function (id) {
        var found = byId[id];
        var info = found && GunksPretix.describeAvailability(found);
        return info ? info.tone : null;
      }).filter(Boolean);
      if (!states.length) return;

      var tone = null;
      if (states.every(function (t) { return t === "gone"; })) tone = "gone";
      else if (states.indexOf("low") > -1) tone = "low";
      if (!tone) return;

      badge.textContent = tone === "gone" ? "Sold out" : "Limited";
      badge.className = "ticket-badge is-" + tone;
      badge.hidden = false;
      th.classList.toggle("is-gone", tone === "gone");
    });
  }

  /* The shop is not open yet. Point the buy buttons at the updates section
     rather than at a shop that will turn people away. */
  function showComingSoon() {
    if (fallbackEl) {
      fallbackEl.textContent = "Tickets aren't on sale just yet — ";
      var a = document.createElement("a");
      a.href = "#updates";
      a.textContent = "get on the updates list";
      fallbackEl.appendChild(a);
      fallbackEl.appendChild(document.createTextNode(" and we'll tell you the moment they are."));
      fallbackEl.hidden = false;
    }
    if (!card) return;
    var cta = card.querySelector(".pass-cta");
    if (cta) {
      cta.href = "#updates";
      cta.textContent = "Get Ticket Updates";
      cta.removeAttribute("target");
      cta.removeAttribute("rel");
    }
  }
})();
