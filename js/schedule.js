/* GunksFest — schedule page.
 *
 * Two sources, on purpose:
 *   1. data/schedule.json — a snapshot of the pretix line-up, committed by
 *      .github/workflows/pretix-sync.yml. Renders instantly, works before the
 *      ticket shop goes live, and survives pretix being down.
 *   2. pretix's public widget endpoint — fetched in the background to stamp
 *      live "Sold out" / "Few spots left" badges on top. No API token: that
 *      endpoint is the one the pretix widget itself uses, and it sends
 *      Access-Control-Allow-Origin: *.
 *
 * If step 2 fails for any reason the page just keeps the snapshot's prices and
 * links, which is a perfectly good schedule.
 */
(function () {
  "use strict";

  var root = document.getElementById("schedule-root");
  if (!root) return;

  var statusEl = document.getElementById("schedule-status");
  var navEl = document.getElementById("schedule-nav");
  var filterEl = document.getElementById("schedule-filters");
  var updatedEl = document.getElementById("schedule-updated");

  var DATA_URL = "data/schedule.json";
  // ?demo=1 renders the bundled sample line-up — handy for checking the layout
  // before the real shop exists. Never used on a normal page load.
  if (/[?&]demo=1\b/.test(window.location.search)) DATA_URL = "data/schedule.example.json";

  // pretix Quota availability states (pretix/base/models/items.py)
  var AVAIL_GONE = 0, AVAIL_ORDERED = 10, AVAIL_RESERVED = 20, AVAIL_OK = 100;

  var state = { data: null, day: "all", category: "all", avail: null };

  fetch(DATA_URL, { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      state.data = data;
      render();
      if (hasSessions(data) && data.shop && data.shop.widget) loadAvailability(data.shop);
    })
    .catch(function (err) {
      setStatus(
        "We couldn't load the schedule just now. " +
        "You can always see the full line-up on our " + shopLink() + ".",
        "error"
      );
      if (window.console) console.warn("schedule: " + err.message);
    });

  function hasSessions(data) {
    return !!(data && ((data.days && data.days.length) || (data.unscheduled && data.unscheduled.length)));
  }

  function shopLink() {
    var d = state.data;
    var url = d && d.shop && d.shop.url;
    return url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">ticket shop</a>'
      : "ticket shop";
  }

  function setStatus(html, kind) {
    if (!statusEl) return;
    statusEl.innerHTML = html;
    statusEl.className = "schedule-status" + (kind ? " is-" + kind : "");
    statusEl.hidden = false;
  }

  /* ---------- rendering ---------- */

  function render() {
    var data = state.data;
    root.innerHTML = "";

    if (!hasSessions(data)) {
      renderEmpty();
      return;
    }
    if (statusEl) statusEl.hidden = true;

    renderDayNav();
    renderFilters();

    var days = (data.days || []).filter(function (d) {
      return state.day === "all" || state.day === d.date;
    });

    var shown = 0;
    days.forEach(function (day) {
      var sessions = day.sessions.filter(matchesCategory);
      if (!sessions.length) return;
      shown += sessions.length;
      root.appendChild(dayBlock(day.label, day.date, sessions));
    });

    // Products with no time on them — passes, camping, merch. Only worth a
    // block of their own when the current filters don't hide them.
    var extras = (data.unscheduled || []).filter(matchesCategory);
    if (extras.length && state.day === "all") {
      shown += extras.length;
      root.appendChild(dayBlock("Passes & Add-ons", "unscheduled", extras));
    }

    if (!shown) {
      var p = document.createElement("p");
      p.className = "schedule-none";
      p.textContent = "Nothing matches that filter yet.";
      root.appendChild(p);
    }

    if (updatedEl && data.generated) {
      updatedEl.textContent = "Line-up synced from our ticket shop on " + formatStamp(data.generated) + ".";
      updatedEl.hidden = false;
    }

    // Re-stamp live badges: render() rebuilt every card, so whatever we already
    // know from the widget endpoint has to be applied again.
    if (state.avail) applyAvailability(state.avail);
    reveal();
  }

  /* Cards are built after js/main.js has already run its own observer, so the
     schedule page does its own reveal pass on every render. Without this the
     `html.js .session { opacity: 0 }` rule would leave the list invisible. */
  function reveal() {
    var cards = root.querySelectorAll(".session");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!("IntersectionObserver" in window) || reduce) {
      Array.prototype.forEach.call(cards, function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -5% 0px" });
    Array.prototype.forEach.call(cards, function (el) { io.observe(el); });
  }

  function renderEmpty() {
    if (navEl) navEl.hidden = true;
    if (filterEl) filterEl.hidden = true;
    setStatus(
      "<strong>The 2026 clinic line-up isn't published yet.</strong><br />" +
      "Clinic schedules and tickets go live in early September — this page fills in " +
      "automatically the moment they do. " +
      '<a href="index.html#updates">Get on the updates list</a> and we\'ll tell you when.',
      "empty"
    );
  }

  function matchesCategory(session) {
    return state.category === "all" || String(session.categoryId) === state.category;
  }

  function dayBlock(label, key, sessions) {
    var sec = document.createElement("section");
    sec.className = "schedule-day";
    sec.id = "day-" + key;

    var h = document.createElement("h2");
    h.className = "schedule-day-title";
    h.textContent = label;
    sec.appendChild(h);

    var list = document.createElement("ul");
    list.className = "session-list";
    sessions.forEach(function (s) { list.appendChild(sessionCard(s)); });
    sec.appendChild(list);
    return sec;
  }

  function sessionCard(s) {
    var li = document.createElement("li");
    li.className = "session";
    li.dataset.itemId = String(s.id);

    var when = document.createElement("div");
    when.className = "session-when";
    if (s.start) {
      var t = document.createElement("time");
      t.dateTime = s.start;
      t.textContent = formatTimeRange(s.start, s.end);
      when.appendChild(t);
    } else {
      when.innerHTML = '<span class="session-anytime">All festival</span>';
    }
    li.appendChild(when);

    var body = document.createElement("div");
    body.className = "session-body";

    var title = document.createElement("h3");
    title.className = "session-title";
    title.textContent = s.name || "Untitled";
    body.appendChild(title);

    var chips = document.createElement("p");
    chips.className = "session-chips";
    [
      s.category,
      s.location,
      s.meta && (s.meta.guide || s.meta.instructor),
      s.meta && (s.meta.difficulty || s.meta.level)
    ].forEach(function (value) {
      if (!value) return;
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = value;
      chips.appendChild(chip);
    });
    if (chips.childNodes.length) body.appendChild(chips);

    if (s.description) {
      var desc = document.createElement("div");
      desc.className = "session-desc";
      desc.innerHTML = sanitize(s.description);
      body.appendChild(desc);
    }
    li.appendChild(body);

    var side = document.createElement("div");
    side.className = "session-side";

    var price = document.createElement("p");
    price.className = "session-price";
    price.textContent = formatPrice(s);
    side.appendChild(price);

    var badge = document.createElement("p");
    badge.className = "session-badge";
    badge.hidden = true;
    side.appendChild(badge);

    if (s.url) {
      var a = document.createElement("a");
      a.className = "btn btn-primary btn-sm session-cta";
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener";
      // Add-ons are bought alongside a pass rather than on their own, so
      // "Register" would promise a checkout the link can't deliver.
      var label = s.isAddon ? "View in shop" : "Register";
      a.textContent = label;
      a.setAttribute("aria-label", label + " — " + (s.name || "this session"));
      side.appendChild(a);
    }
    li.appendChild(side);
    return li;
  }

  function renderDayNav() {
    if (!navEl) return;
    var days = state.data.days || [];
    if (days.length < 2) { navEl.hidden = true; return; }

    navEl.innerHTML = "";
    navEl.hidden = false;
    var options = [{ key: "all", label: "All days" }].concat(
      days.map(function (d) { return { key: d.date, label: shortDay(d) }; })
    );
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-tab" + (state.day === opt.key ? " is-active" : "");
      btn.textContent = opt.label;
      btn.setAttribute("aria-pressed", String(state.day === opt.key));
      btn.addEventListener("click", function () { state.day = opt.key; render(); });
      navEl.appendChild(btn);
    });
  }

  function renderFilters() {
    if (!filterEl) return;
    // Only offer categories that actually have something in them right now.
    var used = {};
    collectAll().forEach(function (s) {
      if (s.categoryId != null) used[s.categoryId] = s.category;
    });
    var cats = Object.keys(used);
    if (cats.length < 2) { filterEl.hidden = true; return; }

    filterEl.innerHTML = "";
    filterEl.hidden = false;
    var label = document.createElement("span");
    label.className = "filter-label";
    label.textContent = "Filter:";
    filterEl.appendChild(label);

    [{ key: "all", label: "Everything" }].concat(
      cats.map(function (id) { return { key: id, label: used[id] }; })
    ).forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip" + (state.category === opt.key ? " is-active" : "");
      btn.textContent = opt.label;
      btn.setAttribute("aria-pressed", String(state.category === opt.key));
      btn.addEventListener("click", function () { state.category = opt.key; render(); });
      filterEl.appendChild(btn);
    });
  }

  function collectAll() {
    var out = [];
    (state.data.days || []).forEach(function (d) { out = out.concat(d.sessions); });
    return out.concat(state.data.unscheduled || []);
  }

  /* ---------- live availability from the pretix widget endpoint ---------- */

  function loadAvailability(shop) {
    var url = shop.widget + (shop.widget.indexOf("?") > -1 ? "&" : "?") + "lang=en";
    fetch(url, { mode: "cors", credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (widget) {
        if (!widget || widget.error || !widget.items_by_category) return;
        var byId = {};
        widget.items_by_category.forEach(function (group) {
          (group.items || []).forEach(function (item) { byId[item.id] = item; });
        });
        state.avail = byId;
        applyAvailability(byId);
      })
      .catch(function () { /* snapshot prices and links are still fine */ });
  }

  function applyAvailability(byId) {
    Array.prototype.forEach.call(root.querySelectorAll(".session"), function (card) {
      var item = byId[card.dataset.itemId];
      var badge = card.querySelector(".session-badge");
      var cta = card.querySelector(".session-cta");
      if (!item || !badge) return;

      var info = describeAvailability(item);
      if (!info) return;

      badge.textContent = info.text;
      badge.className = "session-badge is-" + info.tone;
      badge.hidden = false;
      card.classList.toggle("is-gone", info.tone === "gone");
      if (cta && info.cta) cta.textContent = info.cta;
    });
  }

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
      ? { text: "Sold out", tone: "gone", cta: "Join waiting list" }
      : { text: "Sold out", tone: "gone" };
  }

  /* ---------- formatting helpers ---------- */

  function tz() {
    return (state.data && state.data.shop && state.data.shop.timezone) || "America/New_York";
  }

  // Always render in the festival's timezone — a climber checking from Colorado
  // should read the same start time as one standing in the Trapps.
  function fmt(iso, opts) {
    try {
      return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: tz() }, opts)).format(new Date(iso));
    } catch (e) {
      return new Intl.DateTimeFormat("en-US", opts).format(new Date(iso));
    }
  }

  function formatTimeRange(start, end) {
    var out = fmt(start, { hour: "numeric", minute: "2-digit" });
    if (end) out += " – " + fmt(end, { hour: "numeric", minute: "2-digit" });
    return out;
  }

  function shortDay(day) {
    return day.sessions.length
      ? fmt(day.sessions[0].start, { weekday: "short", month: "numeric", day: "numeric" })
      : day.label;
  }

  function formatStamp(iso) {
    return fmt(iso, { month: "long", day: "numeric", year: "numeric" });
  }

  function formatPrice(s) {
    if (s.price == null) return "";
    var n = Number(s.price);
    if (!Number.isFinite(n)) return "";
    if (n === 0) return s.freePrice ? "Pay what you can" : "Free";
    var currency = (state.data.shop && state.data.shop.currency) || "USD";
    var text;
    try {
      text = new Intl.NumberFormat("en-US", {
        style: "currency", currency: currency,
        minimumFractionDigits: n % 1 ? 2 : 0,
      }).format(n);
    } catch (e) {
      text = "$" + n.toFixed(2);
    }
    return (s.priceFrom ? "from " : "") + text;
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* pretix hands back rendered HTML for descriptions. It comes from our own
     backend, but this page is public, so keep it to a boring tag allowlist
     rather than trusting the string wholesale. */
  var ALLOWED = { P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, UL: 1, OL: 1, LI: 1, A: 1, SPAN: 1 };
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
})();
