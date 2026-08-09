// Parker landing — theme toggle, scroll reveal, sticky-nav border.
(function () {
  "use strict";

  /* ---- Theme toggle (persisted) ---- */
  var root = document.documentElement;
  var toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("parker-theme", next); } catch (e) {}
    });
  }

  /* ---- Typewriter headline ---- */
  (function () {
    var typer = document.querySelector(".typer");
    if (!typer) return;
    var textEl = typer.querySelector(".typer-text");
    var words = ["coding", "writing", "everything"];
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function reserveWidth() {
      // Reserve the widest word so the centered headline never reflows mid-type.
      var keep = textEl.textContent, max = 0;
      for (var i = 0; i < words.length; i++) {
        textEl.textContent = words[i];
        if (textEl.scrollWidth > max) max = textEl.scrollWidth;
      }
      textEl.textContent = keep;
      typer.style.minWidth = max + 18 + "px"; // + caret room
    }

    function start() {
      reserveWidth();
      if (reduce) { textEl.textContent = words[0]; return; }
      var wi = 0, ci = words[0].length, deleting = false;
      function tick() {
        var word = words[wi];
        if (!deleting) {
          ci++;
          textEl.textContent = word.slice(0, ci);
          if (ci >= word.length) { deleting = true; return setTimeout(tick, 1600); }
          return setTimeout(tick, 62 + Math.random() * 46);
        }
        ci--;
        textEl.textContent = word.slice(0, ci);
        if (ci <= 0) { deleting = false; wi = (wi + 1) % words.length; return setTimeout(tick, 280); }
        return setTimeout(tick, 34);
      }
      setTimeout(tick, 1600); // hold the initial word first
    }

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
    else start();
  })();

  /* ---- Sticky nav hairline once scrolled ---- */
  var nav = document.querySelector(".nav");
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- Reveal on scroll ---- */
  var items = document.querySelectorAll(".reveal");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

  items.forEach(function (el, i) {
    // slight stagger for grouped items
    el.style.transitionDelay = (Math.min(i, 6) * 40) + "ms";
    io.observe(el);
  });
})();
