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
    { key: "weekend", title: "Full Weekend Passes", test: /weekend/i },
    { key: "day",     title: "Day Passes",          test: /(saturday|sunday|single.?day)\s+pass/i },
    { key: "film",    title: "Film-Only Passes",    test: /films?\s*only/i }
  ];
  var OTHER_TITLE = "More tickets";

  var fallbackEl = document.getElementById("tickets-fallback");
  var noteEl = document.getElementById("tickets-note");
  var card = document.querySelector(".pass-card");

  fetch("data/schedule.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      var shop = data.shop || {};
      /* The headline pass already has a card of its own beside this table,
         so it is filtered out rather than printed twice. Which product that is
         comes from the data-item-id on that card — the same single place the
         card's own link and its badge already read — so there is no second
         copy of "which one is the headline" to keep in step. If the id isn't
         in the data at all, nothing is filtered and the visitor sees the full
         list, which is the right way for that to fail. */
      var headline = card && card.dataset.itemId;
      var tickets = (data.unscheduled || []).filter(function (item) {
        // Add-ons — clinics, merch — are chosen inside checkout, on top of a
        // pass. Only the things you can buy on their own belong in this list.
        return !item.isAddon && String(item.id) !== headline;
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
      .map(function (g) { return { title: g.title, items: buckets[g.key] }; });
    if (other.length) out.push({ title: out.length ? OTHER_TITLE : "", items: other });
    return out;
  }

  /* Every ticket in a group tends to open with the same words — the three
     remaining weekend passes all begin "Full Weekend Pass with", the film
     tickets all begin "Films Only -" — and in a title column barely 300px wide
     those shared words are most of the line, pushing the part that actually
     differs onto a second and third line. The group heading directly above already
     says them once. So find the words a group's names start with in common and
     let the heading carry them.

     Only the display is shortened. The full product name still goes on the Buy
     link's aria-label, which is what someone listing the page's links hears,
     and it is what pretix shows at checkout — so nobody ever has to match a
     name here against a different one there.

     The rules are deliberately timid, because getting this wrong means a row
     that lies about what it sells: at least two tickets to compare, at least
     two words in common, and every shortened name must keep at least two words
     of its own. A group that fails any of them keeps its full names, which is
     the same thing that happens to a group of one. */
  var CONNECTORS = /^(?:with|and|for|-|–|—|:|,)$/i;

  function shortNames(items) {
    var full = items.map(function (it) { return String(it.name || "Ticket"); });
    if (full.length < 2) return full;

    var words = full.map(function (n) { return n.split(/\s+/); });
    var n = 0;
    while (words.every(function (w) {
      return w.length > n && w[n].toLowerCase() === words[0][n].toLowerCase();
    })) n++;

    // Never let the heading swallow a word the row needs: back off past any
    // trailing connector, so "Full Weekend Pass with" doesn't leave "Camping"
    // reading as though it were the whole product.
    while (n > 0 && CONNECTORS.test(words[0][n - 1])) n--;
    if (n < 2) return full;

    var short = words.map(function (w) {
      var rest = w.slice(n);
      while (rest.length && CONNECTORS.test(rest[0])) rest.shift();
      return rest.join(" ");
    });
    return short.every(function (s) { return s.split(/\s+/).length >= 2; }) ? short : full;
  }

  function render(tickets, shop) {
    listEl.innerHTML = "";

    /* A GET form whose action is the shop, with every radio named "item",
       submits to exactly shop.url + "?item=<id>" — byte for byte the URL the
       per-row Buy links used to carry, and the one on the pass card above.
       That equivalence is the whole reason this is a form and not a button
       with a scripted href: choosing a ticket needs no JavaScript of its own
       to become a destination, and there is no second URL scheme that has to
       be kept working against a shop we do not control. */
    var form = document.createElement("form");
    form.className = "ticket-form";
    form.action = shop.url;
    form.method = "get";
    form.target = "_blank";
    form.setAttribute("rel", "noopener");

    var table = document.createElement("table");
    table.className = "ticket-table";

    /* Radios rather than checkboxes, and it is worth writing down why, because
       the markup reads like a shopping list and isn't one. These are
       alternatives — the section is called "Other ways in", and you take one
       way in — so ticking three is not a thing anyone means to do. It is also
       what the destination supports: ?item= names a single product. Checkboxes
       would let someone tick three and then carry one, which is the kind of
       quiet wrong answer that only shows up on the payment page. Buying for
       two people is a quantity, and pretix asks for that at checkout. */
    var cap = document.createElement("caption");
    cap.className = "ticket-caption";
    cap.textContent = "Pick one, then Select.";
    table.appendChild(cap);

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    [["Ticket", "ticket-col-name"],
     ["Price", "ticket-col-price"],
     ["Select", "ticket-col-select"]].forEach(function (col) {
      var th = document.createElement("th");
      th.scope = "col";
      th.className = col[1];
      th.textContent = col[0];
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    /* One <tbody> per group, headed by a row-group <th>. A group is a real
       section of the table, so it gets the element that means that rather
       than a styled row that only looks like one. */
    groupTickets(tickets).forEach(function (group) {
      var body = document.createElement("tbody");
      body.className = "ticket-group";

      if (group.title) {
        var gRow = document.createElement("tr");
        var gHead = document.createElement("th");
        gHead.className = "ticket-group-title";
        gHead.colSpan = 3;
        gHead.scope = "rowgroup";
        gHead.textContent = group.title;
        gRow.appendChild(gHead);
        body.appendChild(gRow);
      }

      var names = shortNames(group.items);
      group.items.forEach(function (item, i) {
        body.appendChild(ticketRow(item, shop, names[i]));
      });
      table.appendChild(body);
    });

    form.appendChild(table);

    var foot = document.createElement("div");
    foot.className = "ticket-form-foot";
    var go = document.createElement("button");
    go.type = "submit";
    go.className = "btn btn-primary";
    go.textContent = "Select";
    foot.appendChild(go);
    form.appendChild(foot);

    listEl.appendChild(form);
    listEl.hidden = false;
    if (fallbackEl) fallbackEl.hidden = true;
    if (noteEl) noteEl.hidden = false;
    clampDescriptions();
  }

  /* A table only reads as a table if the rows are one height, so a
     description is collapsed to nothing and opened by a button rather than
     shown clamped. The collapse itself is in the stylesheet, applied to every
     row up front; this only measures which ones have something to show and
     gives those the button. The information is still one click away, which
     matters here: "you will need a valid Mohonk Preserve pass" is exactly the
     sort of line that belongs in front of someone before they pay, not
     after. */
  function clampDescriptions() {
    Array.prototype.forEach.call(listEl.querySelectorAll(".ticket-desc"), function (desc) {
      if (desc.scrollHeight <= desc.clientHeight + 4) return;
      desc.classList.add("is-clamped");

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ticket-more";
      btn.textContent = "More";
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", desc.id);
      btn.addEventListener("click", function () {
        var open = desc.classList.toggle("is-open");
        btn.textContent = open ? "Less" : "More";
        btn.setAttribute("aria-expanded", String(open));
      });
      desc.parentNode.insertBefore(btn, desc.nextSibling);
    });
  }

  /* Built with createElement and textContent rather than a template string, so
     no value out of the data file is ever parsed as markup — a product named
     `<img onerror=...>` is simply a row with a strange title. The one place
     markup is intended, the description, goes through GunksPretix.sanitize. */
  function ticketRow(item, shop, displayName) {
    var tr = document.createElement("tr");
    tr.className = "ticket";
    tr.dataset.itemId = String(item.id);

    var inputId = "tkt-" + item.id;

    var nameCell = document.createElement("td");
    nameCell.className = "ticket-name";

    /* The name is the radio's <label>, so the whole ticket title is a click
       target for selecting it — a 12px radio on its own is a poor one. */
    var label = document.createElement("label");
    label.className = "ticket-title";
    label.htmlFor = inputId;
    label.textContent = displayName || item.name || "Ticket";
    nameCell.appendChild(label);

    if (item.description) {
      var desc = document.createElement("div");
      desc.className = "ticket-desc";
      desc.id = "tdesc-" + item.id;          // what the More button controls
      desc.innerHTML = GunksPretix.sanitize(item.description);
      nameCell.appendChild(desc);
    }
    tr.appendChild(nameCell);

    var priceCell = document.createElement("td");
    priceCell.className = "ticket-price";
    var amount = document.createElement("span");
    amount.className = "ticket-amount";
    amount.textContent = (item.priceFrom ? "from " : "") + GunksPretix.money(item.price, shop.currency);
    priceCell.appendChild(amount);

    var badge = document.createElement("p");
    badge.className = "ticket-badge";
    badge.hidden = true;
    priceCell.appendChild(badge);
    tr.appendChild(priceCell);

    var selectCell = document.createElement("td");
    selectCell.className = "ticket-select";
    var radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "item";                     // the ?item= the form submits
    radio.value = String(item.id);
    radio.id = inputId;
    /* The visible label may be shortened to just the words that differ from
       its group's heading; the full product name goes here, so the control
       announces the same thing pretix will show at checkout. The visible text
       is always contained in it, never contradicted by it. */
    radio.setAttribute("aria-label", item.name || "Ticket");
    selectCell.appendChild(radio);
    tr.appendChild(selectCell);

    return tr;
  }

  /* The headline card in the markup is hand-written around one specific pretix
     product, so its id is written down in the HTML rather than guessed here.
     If the two ever part company the badge is skipped and the console says so
     — better a missing badge than one that describes a different product. */
  function stamp(byId) {
    var targets = [].slice.call(document.querySelectorAll(".ticket, .pass-card[data-item-id]"));
    targets.forEach(function (el) {
      var item = byId[el.dataset.itemId];
      var badge = el.querySelector(".ticket-badge, .pass-badge");
      if (!badge) return;
      if (!item) {
        if (el.classList.contains("pass-card") && window.console) {
          console.warn("tickets: pretix has no item " + el.dataset.itemId +
                       " — check the id on .pass-card against data/schedule.json");
        }
        return;
      }

      var info = GunksPretix.describeAvailability(item);
      if (!info) return;
      badge.textContent = info.text;
      badge.className = badge.className.replace(/\s*is-\w+/g, "") + " is-" + info.tone;
      badge.hidden = false;
      el.classList.toggle("is-gone", info.tone === "gone");

      /* A row you cannot buy is a row you cannot pick. Left enabled, the only
         thing telling someone their choice is impossible would be the badge —
         and they would find out for certain on pretix, after the click. */
      var radio = el.querySelector('input[name="item"]');
      if (radio) radio.disabled = info.tone === "gone";
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
