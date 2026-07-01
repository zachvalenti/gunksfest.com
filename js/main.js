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

  // --- Draw a gentle, slightly-waving line into each rope divider ---
  // Path is built in plain pixels (SVG has no viewBox) so the woven fleck
  // pattern stays undistorted at any width. Each divider waves a bit differently.
  var ropes = document.querySelectorAll(".rope");
  Array.prototype.forEach.call(ropes, function (svg, i) {
    var W = 3200, mid = 30;
    var amp = [8, 11, 9, 10][i % 4];    // wave height (px)
    var wl  = [520, 470, 560, 500][i % 4]; // wavelength (px)
    var ph  = [0, 1.3, 2.4, 0.7][i % 4];   // phase offset
    var d = "";
    for (var x = -20; x <= W; x += 24) {
      var y = mid + amp * Math.sin((x / wl) * 2 * Math.PI + ph);
      d += (x === -20 ? "M" : "L") + x + " " + y.toFixed(1) + " ";
    }
    d = d.trim();
    Array.prototype.forEach.call(svg.querySelectorAll("path"), function (p) {
      p.setAttribute("d", d);
    });
  });
})();
