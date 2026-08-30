/* GunksFest — the bits of pretix that more than one page needs.
 *
 * Two pages now read the same ticket shop: clinics.html lists the clinics
 * (js/schedule.js) and index.html lists the passes (js/tickets.js). Both need
 * to ask pretix what is still on sale, both render descriptions written in the
 * pretix backend, and both format money. Rather than have each keep its own
 * copy — which is how two pages start disagreeing about what "Sold out" means
 * — that shared ground lives here, and both pages load this file first.
 *
 * It attaches one global, GunksPretix. No modules, no bundler: this site has
 * no build step, and a plain script that assigns one namespaced object is the
 * whole of what a bundler would have done for four functions.
 */
window.GunksPretix = (function () {
  "use strict";

  // pretix Quota availability states (pretix/base/models/items.py). The widget
  // endpoint reports availability as [state, number_left], where number_left is
  // null unless the shop is configured to show remaining counts.
  var AVAIL_GONE = 0, AVAIL_ORDERED = 10, AVAIL_RESERVED = 20, AVAIL_OK = 100;

  /* ---------- live availability ---------- */

  /* Ask pretix's public widget endpoint what is still on sale, and hand back a
     map of item id → item. No API token is involved: this is the same endpoint
     the pretix widget itself calls, and it sends Access-Control-Allow-Origin: *.
     Failure is deliberately silent — every caller has already rendered prices
     and links from the committed snapshot, so a badge that never arrives costs
     the visitor nothing. */
  function loadAvailability(shop, onLoad) {
    if (!shop || !shop.widget) return;
    var url = shop.widget + (shop.widget.indexOf("?") > -1 ? "&" : "?") + "lang=en";
    fetch(url, { mode: "cors", credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (widget) {
        if (!widget || widget.error || !widget.items_by_category) return;
        var byId = {};
        widget.items_by_category.forEach(function (group) {
          (group.items || []).forEach(function (item) { byId[item.id] = item; });
        });
        onLoad(byId);
      })
      .catch(function () { /* snapshot prices and links are still fine */ });
  }

  /* One widget item → the badge to draw, or null for "say nothing". Returning
     null rather than a cheerful default matters: a card with no badge reads as
     "no information", which is honest, where a wrong "Open" sends someone to a
     checkout that turns them away. */
  function describeAvailability(item) {
    // Variations each carry their own availability; the item is open if any is.
    var states = item.has_variations && item.variations && item.variations.length
      ? item.variations.map(function (v) { return v.avail; })
      : [item.avail];
    states = states.filter(Boolean);
    if (!states.length) {
      return item.current_unavailability_reason ? { text: "Not on sale", tone: "gone" } : null;
    }

    var best = Math.max.apply(null, states.map(function (a) { return a[0]; }));
    if (best === AVAIL_OK) {
      // avail[1] is the number left, but only when the shop is set to show it.
      var left = states.reduce(function (sum, a) {
        return a[0] === AVAIL_OK && typeof a[1] === "number" ? sum + a[1] : sum;
      }, 0);
      if (left > 0 && left <= 5) return { text: left === 1 ? "1 spot left" : left + " spots left", tone: "low" };
      return { text: "Open", tone: "open" };
    }
    if (best === AVAIL_RESERVED || best === AVAIL_ORDERED) {
      return { text: "Currently reserved", tone: "low" };
    }
    return item.allow_waitinglist
      ? { text: "Waiting list", tone: "gone" }
      : { text: "Sold out", tone: "gone" };
  }

  /* ---------- money ---------- */

  /* A bare amount, formatted. Callers add their own framing — the schedule
     prefixes clinic prices with "+" because they sit on top of a pass; the
     ticket list doesn't, because a pass is the whole price. */
  function money(amount, currency) {
    var n = Number(amount);
    if (!Number.isFinite(n)) return "";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency: currency || "USD",
        minimumFractionDigits: n % 1 ? 2 : 0,
      }).format(n);
    } catch (e) {
      return "$" + n.toFixed(2);
    }
  }

  /* ---------- escaping and sanitising ---------- */

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* pretix hands back rendered HTML for descriptions. It comes from our own
     backend, but these pages are public, so keep it to a boring tag allowlist
     rather than trusting the string wholesale.

     The principle, which generalises well beyond HTML: allowlist, never
     blocklist. A blocklist ("strip <script>") requires you to have thought of
     every dangerous case in advance, and attackers are in the business of
     finding the one you missed — an onerror attribute, an SVG, a javascript:
     URL, a nested tag that survives the first pass. An allowlist requires you
     to have thought of the safe cases, and anything you forget merely fails to
     render. Getting it wrong is a missing <em>, not a stolen session.

     Note also that this is the second check, not the only one: the sync script
     already escaped the text before converting Markdown. Layering two
     independent defences means a mistake in either one alone isn't a hole. */
  var ALLOWED = {
    P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, UL: 1, OL: 1, LI: 1, A: 1, SPAN: 1,
    // Descriptions are Markdown converted at sync time; these are what it emits.
    H4: 1, H5: 1, H6: 1, CODE: 1
  };
  // Unwrapping these would spill code or alt text into the page as prose, so
  // they get removed outright, contents and all.
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, TEMPLATE: 1, NOSCRIPT: 1, SVG: 1 };

  function sanitize(html) {
    // Parse into a <template>, whose contents are an inert fragment: images
    // don't load and no handler runs, so a hostile `onerror` never fires while
    // we're still scrubbing. A plain detached <div> is NOT safe here.
    var tpl = document.createElement("template");
    tpl.innerHTML = String(html);
    scrub(tpl.content);
    var out = document.createElement("div");
    out.appendChild(tpl.content);
    return out.innerHTML;
  }

  function scrub(node) {
    Array.prototype.slice.call(node.children).forEach(function (el) {
      // SVG/MathML keep their original case in tagName, so normalise first.
      var tag = el.tagName.toUpperCase();
      if (DROP[tag]) {
        node.removeChild(el);
        return;
      }
      if (!ALLOWED[tag]) {
        // Keep the words, drop the tag.
        while (el.firstChild) node.insertBefore(el.firstChild, el);
        node.removeChild(el);
        return;
      }
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var ok = tag === "A" && attr.name === "href" && /^(https?:|mailto:|\/|#)/i.test(attr.value);
        if (!ok) el.removeAttribute(attr.name);
      });
      if (tag === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener nofollow");
      }
      scrub(el);
    });
  }

  return {
    loadAvailability: loadAvailability,
    describeAvailability: describeAvailability,
    money: money,
    esc: esc,
    sanitize: sanitize
  };
})();
