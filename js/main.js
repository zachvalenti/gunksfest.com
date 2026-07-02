/* GunksFest 2026 — minimal, dependency-free interactions */
(function () {
  "use strict";

  // --- Floating burger menu (FAB + dropdown panel) ---
  var fab = document.querySelector(".menu-fab");
  var panel = document.getElementById("menu-panel");

  function closePanel() {
    if (!panel) return;
    panel.classList.remove("open");
    if (fab) fab.setAttribute("aria-expanded", "false");
  }

  if (fab && panel) {
    fab.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = panel.classList.toggle("open");
      fab.setAttribute("aria-expanded", String(open));
    });
    // Close when a link is tapped, when clicking away, or on Escape.
    panel.addEventListener("click", function (e) {
      if (e.target.closest("a")) closePanel();
    });
    document.addEventListener("click", function (e) {
      if (panel.classList.contains("open") && !panel.contains(e.target) && e.target !== fab) closePanel();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePanel();
    });
  }

  // --- Hide the top bar on scroll (body.scrolled drives the CSS) ---
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var scrolled = window.scrollY > 80;
      if (scrolled !== document.body.classList.contains("scrolled")) {
        document.body.classList.toggle("scrolled", scrolled);
        if (!scrolled) closePanel();   // tidy up when the bar returns
      }
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // --- Current year in footer ---
  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // --- Background photo slideshows (#about and #updates) ---
  // Every .slideshow shares one rotation tick; each has a data-offset so the
  // two never display the same image at the same time.
  var shows = [];
  Array.prototype.forEach.call(document.querySelectorAll(".slideshow"), function (ss) {
    var slides = Array.prototype.slice.call(ss.querySelectorAll(".slide"));
    if (!slides.length) return;
    var offset = ((parseInt(ss.dataset.offset || "0", 10) % slides.length) + slides.length) % slides.length;

    // Show the offset slide first.
    slides.forEach(function (s, i) { s.classList.toggle("is-active", i === offset); });

    // Lazy-load one at a time, starting from the visible slide, so we don't
    // hammer the network. Slides that already have a src (eager) are skipped.
    var order = slides.map(function (_, i) { return (offset + i) % slides.length; });
    var li = 0;
    (function loadNext() {
      if (li >= order.length) return;
      var img = slides[order[li]];
      if (img.getAttribute("src")) { li++; return loadNext(); }
      var done = function () { li++; setTimeout(loadNext, 220); };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      img.src = img.dataset.src || "";
    })();

    shows.push({ slides: slides, offset: offset });
  });

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
  var revealEls = document.querySelectorAll(".feature, .logo-card, .venue-card");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (revealEls.length && "IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(revealEls, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(revealEls, function (el) { el.classList.add("is-visible"); });
  }

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
        var L = layers[i], r = L.sec.getBoundingClientRect();
        // -1 = section just left the top, +1 = about to enter from the bottom
        var prog = (r.top + r.height / 2 - vh / 2) / ((vh + r.height) / 2);
        if (prog < -1.15 || prog > 1.15) continue;
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
  (function () {
    var ropes = Array.prototype.slice.call(document.querySelectorAll(".rope"));
    if (!ropes.length) return;
    var W = 3200, mid = 45, step = 22;
    var cfg = ropes.map(function (_, i) {
      return { amp: [8, 11, 9, 10][i % 4], wl: [520, 470, 560, 500][i % 4], ph: [0, 1.3, 2.4, 0.7][i % 4] };
    });
    var paths = ropes.map(function (svg) { return Array.prototype.slice.call(svg.querySelectorAll("path")); });
    var scrollPhase = 0;

    function build(i, whipAmp, tSec) {
      var c = cfg[i], d = "", first = true;
      for (var x = -20; x <= W; x += step) {
        var y = mid + c.amp * Math.sin(x / c.wl * 2 * Math.PI + c.ph + scrollPhase);
        if (whipAmp > 0.05) {   // fast, decaying, higher-frequency travelling squiggle
          y += whipAmp * Math.sin(x / (c.wl * 0.34) * 2 * Math.PI + tSec * 13 + i * 1.7);
        }
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

    function render(now) {
      for (var i = 0; i < ropes.length; i++) {
        var s = whipStart[i];
        if (s == null || now - s >= DUR) { build(i, 0, 0); continue; }
        var prog = (now - s) / DUR, decay = (1 - prog) * (1 - prog);
        build(i, AMP * decay, (now - s) / 1000);
      }
    }
    var running = false;
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
