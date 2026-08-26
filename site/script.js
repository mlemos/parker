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

  /* ---- To-do demo (features page): click a checkbox to rotate its state ----
     Same eight states and the same order as ⌘⏎ in the app, and the same Lucide
     glyphs — the paths are copied verbatim from src/lib/todo-glyph.ts, along
     with the transform that normalizes every icon to one optical size. */
  (function () {
    var demo = document.getElementById("todo-demo");
    if (!demo) return;

    var ORDER = ["todo", "doing", "pause", "wait", "attn", "done", "fail", "cancel"];
    var TAG = {
      todo: "/TODO", doing: "/DOING", pause: "/PAUSE", wait: "/WAIT",
      attn: "/ATTN", done: "/DONE", fail: "/FAIL", cancel: "/CANCEL"
    };
    var G = {
      todo: "",
      doing: g("translate(0.541 1.003) scale(0.916)", 2.728,
        '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>'),
      pause: g("translate(1.333 1.333) scale(0.889)", 2.813,
        '<rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/>'),
      wait: g("translate(2.4 2.4) scale(0.8)", 3.125,
        '<path d="M5 22h14"/><path d="M5 2h14"/>' +
        '<path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/>' +
        '<path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>'),
      attn: g("translate(-4 -4) scale(1.333)", 1.875,
        '<path d="M12 6v12"/><path d="M17.196 9 6.804 15"/><path d="m6.804 9 10.392 6"/>'),
      done: g("translate(0 0.5) scale(1)", 2.5, '<path d="M20 6 9 17l-5-5"/>'),
      fail: g("translate(-4 -4) scale(1.333)", 1.875, '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
      cancel: g("translate(-1.714 -1.714) scale(1.143)", 2.188, '<path d="M5 12h14"/>')
    };

    function g(transform, width, shapes) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-linecap="round" stroke-linejoin="round"><g transform="' + transform +
        '" stroke-width="' + width + '">' + shapes + "</g></svg>";
    }

    demo.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("button.todo-out") : null;
      if (!btn) return;
      var row = btn.parentNode;
      var next = ORDER[(ORDER.indexOf(row.getAttribute("data-state")) + 1) % ORDER.length];
      row.setAttribute("data-state", next);
      row.querySelector(".tglyph").innerHTML = G[next];
      row.querySelector(".todo-tag").textContent = TAG[next];
    });
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
