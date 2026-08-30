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
      /* The headline pass already has a card of its own above this list, so
         it is filtered out rather than printed twice. Which product that is
         comes from the data-item-id on that card — the same single place the
         card's buy link and its badge already read — so there is no second
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
      // The shipped markup already names the pass and links to the shop, so
      // there is nothing to apologise for on screen — but say something useful
      // in the console, because the overwhelmingly likely cause is the local
      // preview trap below rather than anything wrong with the site.
      if (window.console) console.warn("tickets: " + err.message + fileProtocolHint());
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

  /* Order comes from pretix and is not second-guessed here. Whoever arranges
     the products in the backend is deciding what a visitor should see first,
     and re-sorting in the browser would quietly overrule them. */
  function render(tickets, shop) {
    listEl.innerHTML = "";
    tickets.forEach(function (item) { listEl.appendChild(ticketCard(item, shop)); });
    listEl.hidden = false;
    if (fallbackEl) fallbackEl.hidden = true;
    if (noteEl) noteEl.hidden = false;
  }

  /* Built with createElement and textContent rather than a template string, so
     no value out of the data file is ever parsed as markup — a product named
     `<img onerror=...>` is simply a card with a strange title. The one place
     markup is intended, the description, goes through GunksPretix.sanitize. */
  function ticketCard(item, shop) {
    var li = document.createElement("li");
    li.className = "ticket";
    li.dataset.itemId = String(item.id);

    var head = document.createElement("div");
    head.className = "ticket-head";

    var title = document.createElement("h4");
    title.className = "ticket-title";
    title.textContent = item.name || "Ticket";
    head.appendChild(title);

    var price = document.createElement("p");
    price.className = "ticket-price";
    price.textContent = (item.priceFrom ? "from " : "") + GunksPretix.money(item.price, shop.currency);
    head.appendChild(price);
    li.appendChild(head);

    if (item.description) {
      var desc = document.createElement("div");
      desc.className = "ticket-desc";
      desc.innerHTML = GunksPretix.sanitize(item.description);
      li.appendChild(desc);
    }

    var foot = document.createElement("div");
    foot.className = "ticket-foot";

    var badge = document.createElement("p");
    badge.className = "ticket-badge";
    badge.hidden = true;
    foot.appendChild(badge);

    var buy = document.createElement("a");
    buy.className = "btn btn-small";
    // ?item= preselects this product in pretix's own list. An id pretix no
    // longer knows is ignored rather than erroring, so the worst case of a
    // stale snapshot is landing on the shop with nothing ticked.
    buy.href = item.url || shop.url;
    buy.target = "_blank";
    buy.rel = "noopener";
    buy.textContent = "Buy";
    // The visible label is the same word on every row, so name each link by
    // what it actually buys — a screen reader user listing the page's links
    // otherwise gets nine identical "Buy"s and no way to tell them apart.
    buy.setAttribute("aria-label", "Buy " + (item.name || "ticket"));
    foot.appendChild(buy);

    li.appendChild(foot);
    return li;
  }

  /* The headline card in the markup is hand-written around one specific pretix
     product, so its id is written down in the HTML rather than guessed here.
     If the two ever part company the badge is skipped and the console says so
     — better a missing badge than one that describes a different product. */
  function stamp(byId) {
    var cards = [].slice.call(document.querySelectorAll(".ticket, .pass-card[data-item-id]"));
    cards.forEach(function (el) {
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
