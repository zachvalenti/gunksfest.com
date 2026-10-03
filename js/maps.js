/* GunksFest 2026 — the maps page (maps/index.html)
 *
 * Links each map to its key, both ways. Pick a row in the key and its pin
 * lights up; pick a pin and its row does; pick an amenity in the legend
 * ("Restrooms") and every place that has one lights up in both. Pick the same
 * thing again, press Escape, or click an empty patch of map to clear it.
 *
 * Everything is wired from data attributes in the markup, so adding a place
 * means adding a pin and a row with the same data-place, and nothing here:
 *   data-place      on a pin and its key row — the shared id ("fg-3")
 *   data-amenities  on the same two — space-separated badge names
 *   data-amenity    on a legend button — the badge it stands for
 *   data-layer      on a legend button and the overlay it names ("route")
 *   data-name       on a pin — what its name tag says
 *
 * JS only sets classes and attributes; how a highlight looks is all in
 * css/maps.css. Same ES5 style as js/main.js, for the same reason.
 */
(function () {
  "use strict";

  var cards = document.querySelectorAll(".map-card");
  if (!cards.length) return;

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var behavior = reduceMotion ? "auto" : "smooth";

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function hasWord(list, word) { return (" " + (list || "") + " ").indexOf(" " + word + " ") !== -1; }

  // Every card's clear function, so one Escape can clear them all.
  var clearers = [];

  each(cards, function (card) {
    var scroller = card.querySelector(".map-scroll");
    var canvas = card.querySelector(".map-canvas");
    var callout = card.querySelector(".map-callout");
    var pins = card.querySelectorAll(".map-pin");
    var rows = card.querySelectorAll(".map-row");
    var chips = card.querySelectorAll(".map-chip");
    var layers = card.querySelectorAll(".map-overlay[data-layer]");

    // What is picked right now: null, or { type: "place" | "amenity" | "layer", key }.
    var current = null;

    // A map wider than the phone it's on opens scrolled to its middle, which
    // is where most of the pins are, rather than to its left edge.
    if (scroller) scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;

    // Does a pin or key row belong to the current pick?
    function matches(el, pick) {
      if (!pick) return false;
      if (pick.type === "place") return el.getAttribute("data-place") === pick.key;
      if (pick.type === "amenity") return hasWord(el.getAttribute("data-amenities"), pick.key);
      return false;   // a layer pick highlights an overlay, not pins
    }

    function setOn(el, on, pressable) {
      el.classList.toggle("is-selected", on);
      if (pressable) el.setAttribute("aria-pressed", on ? "true" : "false");
    }

    function select(pick, from) {
      // Picking what is already picked clears it, so every button is a toggle.
      if (pick && current && pick.type === current.type && pick.key === current.key) pick = null;
      current = pick;

      card.classList.toggle("has-selection", !!pick);
      each(pins, function (pin) { setOn(pin, matches(pin, pick), false); });
      each(rows, function (row) { setOn(row, matches(row, pick), true); });
      each(chips, function (chip) {
        var on = !!pick && (
          (pick.type === "amenity" && chip.getAttribute("data-amenity") === pick.key) ||
          (pick.type === "layer" && chip.getAttribute("data-layer") === pick.key));
        setOn(chip, on, true);
      });
      each(layers, function (layer) {
        setOn(layer, !!pick && pick.type === "layer" && layer.getAttribute("data-layer") === pick.key, false);
      });

      showCallout(pick);
      // Picked from the key or legend: make sure the map is where you can see
      // it. Picked on the map: you are already looking at it, so stay put.
      if (pick && from !== "map") reveal();
    }

    // The name tag beside a picked place. It hangs below the pin, or above it
    // near the bottom edge, and shifts sideways near the left and right edges
    // so it never runs off the photo.
    function showCallout(pick) {
      if (!callout) return;
      var pin = pick && pick.type === "place" && card.querySelector('.map-pin[data-place="' + pick.key + '"]');
      if (!pin) { callout.hidden = true; return; }
      var x = parseFloat(pin.style.left);
      var y = parseFloat(pin.style.top);
      callout.textContent = pin.getAttribute("data-name");
      callout.style.left = pin.style.left;
      callout.style.top = pin.style.top;
      callout.classList.toggle("is-above", y > 70);
      callout.classList.toggle("is-start", x < 20);
      callout.classList.toggle("is-end", x > 80);
      callout.hidden = false;
    }

    // Bring the highlighted pins into view: sideways inside the scrolling box
    // on a phone, and the map itself into the window if the key has been
    // scrolled away from it.
    function reveal() {
      var on = card.querySelectorAll(".map-pin.is-selected");
      if (scroller && on.length && scroller.scrollWidth > scroller.clientWidth) {
        var sum = 0;
        // offsetLeft ignores the centring transform, so it is the pin's centre.
        each(on, function (pin) { sum += pin.offsetLeft; });
        var target = sum / on.length - scroller.clientWidth / 2;
        if (scroller.scrollTo) scroller.scrollTo({ left: target, behavior: behavior });
        else scroller.scrollLeft = target;
      }
      // Vertically by moving the window, not with scrollIntoView: that would
      // also scroll the sideways box to the canvas's left edge and undo the
      // centring just above.
      var box = canvas.getBoundingClientRect();
      var tall = window.innerHeight || document.documentElement.clientHeight;
      var gap = 16;
      var by = 0;
      if (box.top < gap) by = box.top - gap;
      else if (box.bottom > tall - gap) by = Math.min(box.bottom - tall + gap, box.top - gap);
      if (by) {
        var top = (window.pageYOffset || document.documentElement.scrollTop) + by;
        if (window.scrollTo) window.scrollTo({ top: top, behavior: behavior });
      }
    }

    // Hovering a row nudges its pin, and hovering a pin nudges its row — a
    // preview of what a click would pick. Mouse only: on a touchscreen a hover
    // would stick after the tap and fight the real selection.
    function hoverPair(el) {
      var key = el.getAttribute("data-place");
      var pair = el.classList.contains("map-pin") ? rows : pins;
      el.addEventListener("pointerenter", function (e) {
        if (e.pointerType !== "mouse") return;
        each(pair, function (other) { other.classList.toggle("is-hover", other.getAttribute("data-place") === key); });
      });
      el.addEventListener("pointerleave", function () {
        each(pair, function (other) { other.classList.remove("is-hover"); });
      });
    }

    each(pins, function (pin) {
      pin.addEventListener("click", function (e) {
        e.stopPropagation();   // or the canvas handler below would clear it again
        select({ type: "place", key: pin.getAttribute("data-place") }, "map");
      });
      hoverPair(pin);
    });
    each(rows, function (row) {
      row.addEventListener("click", function () {
        select({ type: "place", key: row.getAttribute("data-place") }, "key");
      });
      hoverPair(row);
    });
    each(chips, function (chip) {
      chip.addEventListener("click", function () {
        var amenity = chip.getAttribute("data-amenity");
        select(amenity ? { type: "amenity", key: amenity }
                       : { type: "layer", key: chip.getAttribute("data-layer") }, "legend");
      });
    });
    // A click on the photo itself, away from any pin, clears the pick.
    if (canvas) canvas.addEventListener("click", function () { if (current) select(null); });

    clearers.push(function () { if (current) select(null); });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") each(clearers, function (clear) { clear(); });
  });
})();
