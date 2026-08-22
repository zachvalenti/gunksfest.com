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
 *
 * That split is the design worth taking away from this file. The obvious build
 * would call the ticket API from the browser on every page load — and then the
 * schedule is blank whenever pretix is slow, down, or hasn't opened yet, and
 * every visitor waits on a third party before seeing anything. Committing a
 * snapshot at build time inverts it: the page always has an answer, and the
 * live call only ever *adds* to what's already on screen. Ask of any external
 * call: what does the visitor see if this never comes back? If the answer is
 * "nothing", move it off the critical path.
 *
 * The rendering approach is the other half: state lives in one `state` object,
 * render() rebuilds the list from it, and every interaction changes state and
 * calls render() again rather than reaching in to patch individual elements.
 * That is the core idea behind React and every framework like it, in about 20
 * lines and no dependencies. It costs a little efficiency — the whole list is
 * rebuilt to toggle one filter — and buys the guarantee that what's on screen
 * always matches the data, which is the bug class that eats afternoons.
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

  // Filters are two facets: cost (Free / Paid) and level (Beginner /
  // Intermediate / Advanced), ANDed together — pick Free and Beginner and you
  // get the free beginner clinics. Inside a facet every pill stacks as a union,
  // so Free + Paid is simply both, the same list you get with neither lit.
  var state = { data: null, day: "all", cost: {}, level: {}, avail: null };

  var COST_PILLS = [
    { key: "free", label: "Free" },
    { key: "paid", label: "Paid" }
  ];
  /* "All Levels" leads the level group, so it renders between Paid and
     Beginner — the pills are drawn cost-group first, then this list in order.
     It is a lens rather than a rung on the ladder: the three below it narrow to
     a level, this one narrows to the clinics that don't ask for one. */
  var LEVEL_PILLS = [
    { key: "all", label: "All Levels" },
    { key: "beginner", label: "Beginner" },
    { key: "intermediate", label: "Intermediate" },
    { key: "advanced", label: "Advanced" }
  ];

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
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">registration page</a>'
      : "registration page";
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

    // Only timed sessions are listed. Products with no time — the weekend passes
    // and film tickets — are sold on the pretix shop, not scheduled here.
    var shown = 0;
    days.forEach(function (day) {
      var sessions = day.sessions.filter(matchesFilters);
      if (!sessions.length) return;
      shown += sessions.length;
      root.appendChild(dayBlock(day.label, day.date, sessions));
    });

    if (!shown) {
      var p = document.createElement("p");
      p.className = "schedule-none";
      p.textContent = anyFilterActive()
        ? "Nothing matches those filters yet."
        : "Nothing scheduled for that day yet.";
      root.appendChild(p);
    }

    if (updatedEl && data.generated) {
      updatedEl.textContent = "Updated " + formatStamp(data.generated) + ".";
      updatedEl.hidden = false;
    }

    // Re-stamp live badges: render() rebuilt every card, so whatever we already
    // know from the widget endpoint has to be applied again.
    if (state.avail) applyAvailability(state.avail);
    clampDescriptions();
    reveal();
  }

  /* Full pretix descriptions run to a few hundred words, which turns 45 clinics
     into twenty screens of scrolling. Collapse anything taller than the clamp and
     offer a toggle — measured after layout, so cards whose text already fits get
     no button. */
  function clampDescriptions() {
    Array.prototype.forEach.call(root.querySelectorAll(".session-desc"), function (desc) {
      if (desc.scrollHeight <= desc.clientHeight + 4) return;
      desc.classList.add("is-clamped");

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "session-more";
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

  /* Builds one clinic card. Everything is createElement + textContent rather
     than a template string of HTML, which is more typing but means no value
     from the data file is ever parsed as markup — a clinic named
     `<img onerror=...>` is simply a card with a strange title. The one place
     markup is intended (the description) goes through sanitize() below.

     dataset.itemId writes data-item-id="1126451" onto the element, which is
     how applyAvailability() finds the right card to stamp a badge on later
     without keeping a separate map of elements. Storing an id on the DOM node
     that represents it is a small pattern that saves a lot of bookkeeping. */
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

    if (s.description) {
      var desc = document.createElement("div");
      desc.className = "session-desc";
      desc.id = "desc-" + s.slotId;
      desc.innerHTML = sanitize(s.description);
      body.appendChild(desc);
    }
    li.appendChild(body);

    var side = document.createElement("div");
    side.className = "session-side";

    var price = document.createElement("p");
    var money = formatPrice(s);
    price.className = "session-price" + (money.included ? " is-included" : "");
    price.textContent = money.text;
    side.appendChild(price);

    var badge = document.createElement("p");
    badge.className = "session-badge";
    badge.hidden = true;
    side.appendChild(badge);

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

  /* ---------- price / level filters ---------- */

  /* A $0 clinic isn't standalone-free — it comes with a pass — but from the
     climber's side of the counter it costs nothing extra, which is what the
     "Free" pill means. "Pay what you can" counts as free too. */
  /* Both facets answer the same question — which pills does this session belong
     under? — so both return a list of keys. Cost is always exactly one. Level
     can be none, one, or all three. */
  function costsOf(s) {
    var n = Number(s.price);
    if (s.price == null || !Number.isFinite(n)) return [];
    return [n === 0 ? "free" : "paid"];
  }

  /* Level comes from the `difficulty` item meta property in pretix (see
     scripts/fetch-pretix.mjs). Nothing is inferred from the title or the
     description: guessing a clinic's level from prose is how someone ends up
     in the wrong clinic.

     An "All Levels" clinic returns every key — its own pill AND all three
     rungs. Both halves matter, for different people:

       - the three rungs, because the person the label is written for is the
         beginner who presses Beginner. A clinic explicitly open to them has to
         be in that list, not filed away under a pill they have no reason to
         try. That is the difference between Beginner showing 5 and showing 18.
       - its own pill, because "show me the ones that don't ask for a level" is
         a real question, and it is not the same question as "show me beginner
         clinics".

     A consequence worth knowing before changing this: the level pills are not
     a partition. All Levels is a subset of each of the other three, so
     All Levels + Beginner lists the same 18 as Beginner alone. That is the
     price of the first bullet, and it is the right way round — the failure it
     avoids is somebody missing a clinic they could have taken.

     A clinic with no difficulty set, or one carrying a word this doesn't
     recognise, returns nothing and simply isn't offered under a level pill —
     the same deliberate silence as before. */
  function levelsOf(s) {
    var raw = s.meta && s.meta.difficulty;
    if (!raw) return [];
    var key = String(raw).trim().toLowerCase();
    if (key.indexOf("all") === 0) {
      return LEVEL_PILLS.map(function (p) { return p.key; });
    }
    for (var i = 0; i < LEVEL_PILLS.length; i++) {
      var k = LEVEL_PILLS[i].key;
      if (k !== "all" && key.indexOf(k) === 0) return [k];
    }
    return [];
  }

  function keysFor(facet, s) {
    return facet === "cost" ? costsOf(s) : levelsOf(s);
  }

  function facetActive(facet) {
    return Object.keys(state[facet]).length > 0;
  }

  function anyFilterActive() {
    return facetActive("cost") || facetActive("level");
  }

  /* A session clears a facet if any one of its keys is lit — so an "All Levels"
     clinic clears the level facet under Beginner, Intermediate or Advanced
     alike. Across facets it is still an and: Free + Beginner means both. */
  function litInFacet(facet, s) {
    var keys = keysFor(facet, s);
    for (var i = 0; i < keys.length; i++) {
      if (state[facet][keys[i]]) return true;
    }
    return false;
  }

  function matchesFilters(s) {
    if (facetActive("cost") && !litInFacet("cost", s)) return false;
    if (facetActive("level") && !litInFacet("level", s)) return false;
    return true;
  }

  /* Only offer a pill that would actually turn something up. Levels stay hidden
     until pretix carries difficulties, so the row never shows a dead control. */
  function renderFilters() {
    if (!filterEl) return;

    var sessions = [];
    (state.data.days || []).forEach(function (d) { sessions = sessions.concat(d.sessions); });

    var pills = [];
    ["cost", "level"].forEach(function (facet) {
      var used = {};
      sessions.forEach(function (s) {
        keysFor(facet, s).forEach(function (key) { used[key] = true; });
      });
      var group = (facet === "cost" ? COST_PILLS : LEVEL_PILLS).filter(function (opt) {
        return used[opt.key];
      });
      /* Two tests, both asking whether this row of pills earns its space.
         One pill filters nothing out, since every session it knows about
         matches it. And more than one pill still filters nothing if every
         session carries all of them — which is exactly what a line-up made
         entirely of "All Levels" clinics would look like now that one clinic
         can sit under several pills at once. */
      var discriminates = group.length > 1 && sessions.some(function (s) {
        var keys = keysFor(facet, s);
        return group.some(function (opt) { return keys.indexOf(opt.key) === -1; });
      });
      if (discriminates) {
        group.forEach(function (opt) { pills.push({ facet: facet, opt: opt }); });
      } else {
        state[facet] = {};
      }
    });

    if (!pills.length) { filterEl.hidden = true; return; }

    filterEl.innerHTML = "";
    filterEl.hidden = false;

    var label = document.createElement("span");
    label.className = "filter-label";
    label.textContent = "Filters:";
    filterEl.appendChild(label);

    pills.forEach(function (pill) {
      var on = !!state[pill.facet][pill.opt.key];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-pill is-" + pill.facet + (on ? " is-active" : "");
      btn.textContent = pill.opt.label;
      btn.setAttribute("aria-pressed", String(on));
      btn.addEventListener("click", function () {
        if (state[pill.facet][pill.opt.key]) delete state[pill.facet][pill.opt.key];
        else state[pill.facet][pill.opt.key] = true;
        render();
      });
      filterEl.appendChild(btn);
    });

    if (anyFilterActive()) {
      var clear = document.createElement("button");
      clear.type = "button";
      clear.className = "filter-clear";
      clear.textContent = "Clear";
      clear.addEventListener("click", function () {
        state.cost = {};
        state.level = {};
        render();
      });
      filterEl.appendChild(clear);
    }
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
      if (!item || !badge) return;

      var info = describeAvailability(item);
      if (!info) return;

      badge.textContent = info.text;
      badge.className = "session-badge is-" + info.tone;
      badge.hidden = false;
      card.classList.toggle("is-gone", info.tone === "gone");
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
      ? { text: "Waiting list", tone: "gone" }
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
    if (s.price == null) return { text: "", included: false };
    var n = Number(s.price);
    if (!Number.isFinite(n)) return { text: "", included: false };
    // A $0 clinic isn't free-standing — it comes with a festival pass.
    if (n === 0) {
      return s.freePrice
        ? { text: "Pay what you can", included: false }
        : { text: "Included", included: true };
    }
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
    // Leading "+" because every clinic is an add-on: the fee is on top of a day
    // or weekend pass, never the whole cost of attending.
    return { text: (s.priceFrom ? "from " : "") + "+" + text, included: false };
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* pretix hands back rendered HTML for descriptions. It comes from our own
     backend, but this page is public, so keep it to a boring tag allowlist
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
})();
