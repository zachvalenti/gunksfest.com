/* GunksFest 2026 — minimal, dependency-free interactions */
(function () {
  "use strict";

  // --- Mobile nav toggle ---
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("nav-menu");

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    // Close the menu after tapping a link (mobile)
    menu.addEventListener("click", function (e) {
      if (e.target.tagName === "A" && menu.classList.contains("open")) {
        menu.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // --- Current year in footer ---
  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // --- Background photo slideshow (#about) ---
  var slideshow = document.querySelector(".slideshow");
  if (slideshow) {
    var slides = Array.prototype.slice.call(slideshow.querySelectorAll(".slide"));

    // Lazy-load the remaining slides one at a time so we don't hammer the
    // network on page load (slide 1 is already loaded via its src attribute).
    var loaded = 1;
    (function loadNext() {
      if (loaded >= slides.length) return;
      var img = slides[loaded];
      var done = function () { loaded++; setTimeout(loadNext, 250); };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      if (img.dataset.src) { img.src = img.dataset.src; } else { done(); }
    })();

    // Crossfade rotation (skipped when the user prefers reduced motion).
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (slides.length > 1 && !reduce) {
      var idx = 0;
      setInterval(function () {
        var next = (idx + 1) % slides.length;
        slides[idx].classList.remove("is-active");
        slides[next].classList.add("is-active");
        idx = next;
      }, 5500);
    }
  }
})();
