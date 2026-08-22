/* GunksFest 2026 — minimal, dependency-free interactions
 *
 * Every behaviour on the site is in this file and js/schedule.js. No framework,
 * no bundler, no npm install — the browser loads exactly what you see here.
 * That is a deliberate choice for a site this size, and worth understanding
 * before reaching for React: a landing page with a menu, a slideshow and some
 * scroll effects is a few hundred lines of DOM code, and shipping a framework
 * to run it costs the visitor a download and a parse before anything appears.
 *
 * Patterns used throughout, each explained at its first appearance below:
 *   - an IIFE wrapper, so nothing leaks into the global scope
 *   - feature detection before use, so an old browser degrades instead of
 *     throwing (an uncaught error stops every later line in the file)
 *   - JS toggles classes, CSS owns appearance
 *   - requestAnimationFrame throttling on anything driven by scroll
 *   - prefers-reduced-motion honoured before starting any animation
 *
 * The style is intentionally ES5 (`var`, `function`) with no build step, so it
 * runs anywhere without transpiling. In new code you'd reach for const/let and
 * arrow functions; js/schedule.js mixes in some of both.
 */

/* An IIFE — Immediately Invoked Function Expression. The whole file is a
 * function that is defined and called on the spot, so every `var` inside is
 * scoped to it rather than becoming a property of `window`. Two scripts on the
 * same page can then each have their own `ticking` variable without colliding.
 * (Modern code gets this for free with type="module", which is scoped by
 * default; the IIFE is how it was done before, and still works everywhere.)
 *
 * "use strict" opts into stricter parsing: assigning to an undeclared variable
 * throws instead of silently creating a global, among other sharp edges made
 * loud. Always worth it.
 */
(function () {
  "use strict";

  // --- Floating burger menu (FAB + dropdown panel) ---
  // querySelector takes any CSS selector and returns the first match, or null.
  // getElementById is the same idea for an id, and marginally faster. Both can
  // return null — hence the `if (fab && panel)` guard before wiring anything
  // up. This file runs on two different pages, and neither is guaranteed to
  // contain every element it knows about.
  var fab = document.querySelector(".menu-fab");
  var panel = document.getElementById("menu-panel");

  function closePanel() {
    if (!panel) return;
    panel.classList.remove("open");
    if (fab) fab.setAttribute("aria-expanded", "false");
  }

  if (fab && panel) {
    fab.addEventListener("click", function (e) {
      // Without this the click keeps bubbling up to the document listener
      // below, which would see a click "outside the panel" and immediately
      // close what we just opened. Events travel up through every ancestor by
      // default; stopPropagation ends that journey here.
      e.stopPropagation();
      // classList.toggle returns the resulting state, so one call both flips
      // the class and tells us what to write into aria-expanded. That
      // attribute is what a screen reader announces ("collapsed"/"expanded"),
      // and what the CSS reads to animate the bars into an X — so it has to
      // stay truthful, not just be set once at page load.
      var open = panel.classList.toggle("open");
      fab.setAttribute("aria-expanded", String(open));
    });
    // Close when a link is tapped, when clicking away, or on Escape.
    // One listener on the panel handles every link inside it, now and in
    // future — that's event delegation. e.target is whatever was actually
    // clicked (possibly a <span> inside the link), and .closest("a") walks up
    // from there to find the enclosing anchor, or null if there isn't one.
    panel.addEventListener("click", function (e) {
      if (e.target.closest("a")) closePanel();
    });
    // Click-outside-to-close, the standard implementation: listen on the
    // document, and ignore clicks that landed inside the panel. .contains()
    // asks whether one node is an ancestor of another.
    document.addEventListener("click", function (e) {
      if (panel.classList.contains("open") && !panel.contains(e.target) && e.target !== fab) closePanel();
    });
    // Escape closes any transient layer — menu, dialog, popover. Users expect
    // it, and it costs three lines.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePanel();
    });
  }

  // --- Hide the top bar on scroll (body.scrolled drives the CSS) ---
  // Scroll events fire far faster than the screen refreshes — potentially
  // hundreds of times a second — and doing layout work in each one is the
  // classic cause of janky scrolling. The fix, used everywhere in this file:
  // ignore every event until the next animation frame. `ticking` records that
  // a frame is already booked, so a hundred scroll events collapse into one
  // piece of work, run by requestAnimationFrame at exactly the moment the
  // browser is about to paint.
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var scrolled = window.scrollY > 80;
      // Only touch the DOM when the answer actually changed. Reading and
      // writing layout is the expensive part; comparing two booleans is free.
      if (scrolled !== document.body.classList.contains("scrolled")) {
        document.body.classList.toggle("scrolled", scrolled);
        if (!scrolled) closePanel();   // tidy up when the bar returns
      }
      ticking = false;
    });
  }
  // { passive: true } promises this listener will never call
  // preventDefault(), which lets the browser scroll immediately instead of
  // waiting to see whether our handler cancels it. On touch devices that is
  // the difference between scrolling that tracks the finger and scrolling that
  // stutters. Pass it on every scroll/touch listener that only observes.
  window.addEventListener("scroll", onScroll, { passive: true });
  // Run once at startup: the page may load already scrolled down (a #anchor
  // link, or a restored position on refresh), and the event won't fire on its
  // own to tell us that.
  onScroll();

  // --- Current year in footer ---
  // textContent, not innerHTML. innerHTML parses its input as markup, so it
  // will happily build elements out of any string you hand it — which is how
  // cross-site scripting happens the moment that string comes from a user, a
  // URL or an API. textContent always writes plain text. Reach for it by
  // default and use innerHTML only deliberately, on markup you built or
  // sanitised yourself (js/schedule.js does exactly that, with a scrubber).
  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // --- Background photo slideshows (#about and #updates) ---
  // Every .slideshow shares one rotation tick; each has a data-offset so the
  // two never display the same image at the same time.
  var shows = [];
  // querySelectorAll returns a NodeList, not an Array — it has length and
  // indexes but not map/filter/slice. `Array.prototype.forEach.call(list, fn)`
  // borrows the array method and applies it to the list. (Today you'd write
  // Array.from(list) or [...list]; NodeList also has its own forEach in modern
  // browsers. This form works everywhere, which is why it's used throughout.)
  Array.prototype.forEach.call(document.querySelectorAll(".slideshow"), function (ss) {
    var slides = Array.prototype.slice.call(ss.querySelectorAll(".slide"));
    if (!slides.length) return;
    // element.dataset exposes every data-* attribute in the HTML as a
    // property, hyphens converted to camelCase: data-offset → dataset.offset.
    // It's the sanctioned way to hang configuration on an element, and it's
    // how the markup tells the JS what to do without the JS hardcoding
    // per-element rules (see also data-video and data-amp below).
    // The double modulo is the standard fix for JS's % returning a negative
    // result for negative inputs: -1 % 12 is -1, not 11.
    var offset = ((parseInt(ss.dataset.offset || "0", 10) % slides.length) + slides.length) % slides.length;

    // Show the offset slide first.
    slides.forEach(function (s, i) { s.classList.toggle("is-active", i === offset); });

    // Lazy-load one at a time, starting from the visible slide, so we don't
    // hammer the network. Slides that already have a src (eager) are skipped.
    //
    // The <img> tags for hidden slides carry data-src, not src, so the browser
    // never requests them on its own; this loop assigns .src to start each
    // download, and only starts the next one after the previous fires load (or
    // error). Twelve photos requested at once would compete with the CSS, the
    // fonts and the one slide actually on screen — a browser only opens a
    // handful of connections at a time, so "download everything immediately"
    // really means "delay the thing the visitor is looking at".
    // The one visible slide in index.html instead ships a real src plus
    // fetchpriority="high", so it starts first and at the front of the queue.
    var order = slides.map(function (_, i) { return (offset + i) % slides.length; });
    var li = 0;
    (function loadNext() {
      if (li >= order.length) return;
      var img = slides[order[li]];
      if (img.getAttribute("src")) { li++; return loadNext(); }
      // Listening for BOTH load and error, with the same handler, is what
      // keeps the chain alive: a single missing file would otherwise stall
      // every remaining slide forever. Whenever you wait on a network event,
      // ask what happens if it never arrives.
      // { once: true } removes the listener after it fires — a tidy way to
      // avoid the leak of handlers that accumulate on long-lived elements.
      var done = function () { li++; setTimeout(loadNext, 220); };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      // Assigning .src is what actually starts the download. Note the
      // listeners are attached first — if the image is already cached the
      // load event can fire immediately, and a listener added afterwards
      // would miss it.
      img.src = img.dataset.src || "";
    })();

    shows.push({ slides: slides, offset: offset });
  });

  // matchMedia lets JS ask the same questions CSS media queries ask. Here it's
  // the accessibility check: if the visitor's OS is set to reduce motion, the
  // slideshow simply never starts rotating and the first photo stays put. The
  // `window.matchMedia &&` guard is feature detection — call a method that
  // doesn't exist and the resulting TypeError kills the rest of this file.
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (shows.length && !reduce) {
    var tick = 0;
    setInterval(function () {
      tick++;
      shows.forEach(function (sh) {
        var active = (tick + sh.offset) % sh.slides.length;
        sh.slides.forEach(function (s, i) { s.classList.toggle("is-active", i === active); });
      });
    }, 5500);
  }

  // --- Reveal cards on scroll ---
  // IntersectionObserver is the right tool for "do something when this element
  // comes into view". The naive version — a scroll handler calling
  // getBoundingClientRect() on every card — forces the browser to recalculate
  // layout on every frame of every scroll. The observer instead tells the
  // browser what you care about and gets called back only when the answer
  // changes, off the main scroll path.
  //   threshold: 0.15   fire once 15% of the card is showing
  //   rootMargin        shrinks the viewport it measures against; the -8% on
  //                     the bottom edge delays the trigger until the card is
  //                     properly on screen rather than peeking over the fold
  // unobserve() after the first hit stops watching a card that has already
  // been revealed — this animation is one-way, so keeping the observation
  // alive would be pure waste.
  var revealEls = document.querySelectorAll(".feature, .logo-card, .venue-card, .pass-card");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (revealEls.length && "IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(revealEls, function (el) { io.observe(el); });
  } else {
    // The else branch is the important half, and the habit to copy. The CSS
    // starts these cards at opacity 0, so if the observer is unavailable or
    // motion is unwanted, something must still make them visible — otherwise
    // the "enhancement" has hidden the page's content. Whenever JS hides
    // something, make sure every path un-hides it.
    Array.prototype.forEach.call(revealEls, function (el) { el.classList.add("is-visible"); });
  }

  // --- Click-to-load video embeds ---
  // The page ships a thumbnail + play button; YouTube isn't contacted at all
  // until someone hits play. If the thumbnail 404s (some videos have no
  // maxres still), drop it and let the card's dark background show through.
  //
  // This pattern is called a facade, and it's worth knowing. A YouTube <iframe>
  // is not a video player, it's a whole second web page: roughly a megabyte of
  // script, executing in your page, setting cookies and tracking the visit
  // before anyone has decided to watch anything. Swapping it for an image and
  // a button until the moment of intent removes all of that from the initial
  // load, and it's usually the single biggest performance win available on a
  // marketing page. The same trick applies to maps, chat widgets and comment
  // embeds. (The iframe below is built with the -nocookie host, too.)
  Array.prototype.forEach.call(document.querySelectorAll(".video-embed"), function (box) {
    var id = box.dataset.video;
    var btn = box.querySelector(".video-play");
    if (!id || !btn) return;

    var thumb = box.querySelector(".video-thumb");
    if (thumb) {
      thumb.addEventListener("error", function () { thumb.remove(); }, { once: true });
    }

    btn.addEventListener("click", function () {
      // createElement + property assignment, rather than assembling a string
      // of HTML. It's the safe default (nothing is ever parsed as markup) and
      // it reads better than escaping quotes inside a template literal.
      var frame = document.createElement("iframe");
      frame.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0";
      // An iframe needs a title for the same reason an image needs alt text:
      // it's what a screen reader announces in place of content it can't see.
      frame.title = btn.getAttribute("aria-label") || "Video";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      frame.allowFullscreen = true;
      box.innerHTML = "";
      box.appendChild(frame);
    });
  });

  // --- Parallax backgrounds ---
  // Photo layers lag behind the scroll (translate3d, rAF-throttled). Each layer
  // has ±90px CSS bleed; depths stay below that so edges never show. The hero
  // text drifts and fades slightly for a second plane of depth.
  (function () {
    var layers = [];
    var hero = document.querySelector(".hero");
    var heroBg = document.querySelector(".hero-bg");
    var heroInner = document.querySelector(".hero-inner");
    if (hero && heroBg) layers.push({ sec: hero, el: heroBg, depth: 75 });
    Array.prototype.forEach.call(document.querySelectorAll(".section-photo"), function (sec) {
      var bg = sec.querySelector(".slideshow, .section-bg");
      if (bg) layers.push({ sec: sec, el: bg, depth: 55 });
    });
    if (!layers.length) return;

    var vh = window.innerHeight;
    window.addEventListener("resize", function () { vh = window.innerHeight; }, { passive: true });

    function update() {
      for (var i = 0; i < layers.length; i++) {
        // getBoundingClientRect() returns an element's position and size
        // relative to the viewport right now — .top is how far its top edge is
        // below the top of the screen, negative once it has scrolled past.
        var L = layers[i], r = L.sec.getBoundingClientRect();
        // Normalising to a -1…+1 range is the trick that makes this readable.
        // Compare the section's centre to the viewport's centre, divide by the
        // total distance over which they can differ, and you get one number
        // that means "how far through its pass across the screen is this",
        // independent of how tall the section or the window happens to be.
        // Multiply that by a depth and you have a parallax offset.
        // -1 = section just left the top, +1 = about to enter from the bottom
        var prog = (r.top + r.height / 2 - vh / 2) / ((vh + r.height) / 2);
        // Skip anything off screen: no point computing a transform nobody sees.
        if (prog < -1.15 || prog > 1.15) continue;
        // translate3d rather than `top` or margin. Moving an element with a
        // transform only re-composites it — usually on the GPU — while
        // changing top forces the browser to redo layout for the page. Same
        // visual result, wildly different cost. The 3d variant is the old way
        // of asking for that promotion explicitly; it's why animations should
        // stick to transform and opacity wherever possible.
        L.el.style.transform = "translate3d(0," + (-prog * L.depth).toFixed(1) + "px,0)";
      }
      if (hero && heroInner) {
        var sy = window.scrollY, hh = hero.offsetHeight || 1;
        heroInner.style.transform = "translate3d(0," + (sy * 0.12).toFixed(1) + "px,0)";
        heroInner.style.opacity = String(Math.max(1 - (sy / hh) * 0.7, 0.2));
      }
    }
    var pxTick = false;
    window.addEventListener("scroll", function () {
      if (pxTick) return;
      pxTick = true;
      requestAnimationFrame(function () { update(); pxTick = false; });
    }, { passive: true });
    update();
  })();

  // --- Rope dividers: whip on load, settle into a gentle wave, nudge on scroll ---
  // Path is built in plain pixels (SVG has no viewBox) so the woven fleck
  // pattern stays undistorted at any width. Each divider waves a bit differently.
  //
  // Worth reading even if you never need a wavy rope: this is how you draw with
  // SVG from JavaScript. An SVG <path> is described entirely by its `d`
  // attribute, a string of drawing commands — "M x y" to move the pen without
  // drawing, "L x y" to draw a line to a point. So a curve is just a series of
  // short straight segments with points close enough together to read as
  // smooth, and animating it means recomputing that string and setting the
  // attribute again. Everything below is arithmetic in service of that.
  //
  // The sine wave is the standard way to express anything that oscillates:
  //   y = mid + amplitude * sin(x / wavelength * 2π + phase)
  //   mid        the line it waves around
  //   amplitude  how far it swings either side
  //   wavelength how much x it takes to complete one cycle
  //   phase      where in the cycle x=0 starts — offsetting this per rope is
  //              what stops the six dividers moving in lockstep, and adding
  //              scroll position to it is what makes them ripple as you scroll
  (function () {
    var ropes = Array.prototype.slice.call(document.querySelectorAll(".rope"));
    if (!ropes.length) return;
    var W = 3200, mid = 45, step = 22;
    // Defaults cycle so adjacent ropes never wave in step. A divider can opt out
    // with data-amp / data-wavelength when its seam wants a calmer line.
    var cfg = ropes.map(function (svg, i) {
      var d = svg.dataset || {};
      var amp = parseFloat(d.amp), wl = parseFloat(d.wavelength);
      return {
        amp: isNaN(amp) ? [8, 11, 9, 10][i % 4] : amp,
        wl: isNaN(wl) ? [520, 470, 560, 500][i % 4] : wl,
        ph: [0, 1.3, 2.4, 0.7][i % 4]
      };
    });
    var paths = ropes.map(function (svg) { return Array.prototype.slice.call(svg.querySelectorAll("path")); });
    var scrollPhase = 0;

    function build(i, whipAmp, tSec) {
      var c = cfg[i], d = "", first = true;
      // Walk left to right in `step`-pixel increments, computing a y for each
      // x and appending one path command per point. Bigger steps mean a
      // shorter string and less work; too big and the curve turns into a
      // visible polygon. 22px is the point where it still reads as a rope.
      for (var x = -20; x <= W; x += step) {
        var y = mid + c.amp * Math.sin(x / c.wl * 2 * Math.PI + c.ph + scrollPhase);
        if (whipAmp > 0.05) {   // fast, decaying, higher-frequency travelling squiggle
          // Adding a second, faster sine on top of the first is how you get a
          // complex-looking motion out of simple parts: one slow sway plus one
          // quick shiver whose amplitude decays to zero. Include time (tSec)
          // in the phase and the squiggle travels along the rope.
          y += whipAmp * Math.sin(x / (c.wl * 0.34) * 2 * Math.PI + tSec * 13 + i * 1.7);
        }
        // "M" for the first point (move the pen there), "L" for every one
        // after (draw a line to it). toFixed(1) keeps the string short —
        // sub-pixel precision beyond a decimal place is wasted bytes.
        d += (first ? "M" : "L") + x + " " + y.toFixed(1) + " ";
        first = false;
      }
      d = d.trim();
      paths[i].forEach(function (p) { p.setAttribute("d", d); });
    }
    function drawAll(whipAmp, tSec) { for (var i = 0; i < ropes.length; i++) build(i, whipAmp, tSec); }

    drawAll(0, 0);   // paint the resting wave immediately (robust if rAF is throttled)

    // The rope motion is subtle and decorative, so it runs even under
    // reduced-motion. Each rope whips once, the moment it scrolls into view
    // (so it's actually seen on mobile, where the dividers start below the fold).
    var DUR = 1000, AMP = 7;
    var whipStart = ropes.map(function () { return null; });

    // A hand-written animation, and the anatomy is always the same: record a
    // start time, and on each frame work out how far through you are
    // (0 → 1) and derive everything from that. Never animate by adding a fixed
    // amount per frame — frame rates differ between a 60Hz laptop and a 120Hz
    // phone, and the animation would run at different speeds on each. Elapsed
    // time is the only reliable clock.
    function render(now) {
      for (var i = 0; i < ropes.length; i++) {
        var s = whipStart[i];
        if (s == null || now - s >= DUR) { build(i, 0, 0); continue; }
        // `decay` squared gives an ease-out: the whip loses most of its energy
        // early and tails off gently, which is what a real rope does. Squaring
        // or cubing a 0→1 progress value is the cheapest way to shape motion,
        // and the same idea CSS spells `ease-out`.
        var prog = (now - s) / DUR, decay = (1 - prog) * (1 - prog);
        build(i, AMP * decay, (now - s) / 1000);
      }
    }
    var running = false;
    // A requestAnimationFrame loop: do the work for this frame, then ask for
    // another only if there's still something to animate. Stopping when idle
    // matters — a loop that re-queues unconditionally keeps a device's GPU and
    // CPU awake forever, which on a phone means measurable battery drain for a
    // page nobody is looking at. (The browser does at least pause rAF entirely
    // in background tabs.)
    function loop(now) {
      render(now);
      var any = false;
      for (var i = 0; i < ropes.length; i++) {
        if (whipStart[i] != null && now - whipStart[i] < DUR) { any = true; break; }
      }
      if (any) requestAnimationFrame(loop); else running = false;
    }
    function startLoop() { if (!running) { running = true; requestAnimationFrame(loop); } }

    if ("IntersectionObserver" in window) {
      var ropeIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var i = ropes.indexOf(en.target);
          if (en.isIntersecting && i > -1 && whipStart[i] == null) {
            whipStart[i] = (window.performance || Date).now();
            startLoop();
            ropeIO.unobserve(en.target);
          }
        });
      }, { threshold: 0.25 });
      // Only the first rope performs the entrance whip; the rest just ripple on scroll.
      if (ropes[0]) ropeIO.observe(ropes[0]);
    }

    // Scroll-driven ripple (and keeps any in-progress whip rendering).
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        scrollPhase = window.scrollY * 0.0035;
        render((window.performance || Date).now());
        ticking = false;
      });
    }, { passive: true });
  })();
})();
