/*
 * Sowel landing — horizontal "flipbook" scroll.
 *
 * The DOM layout is:
 *   .sowel-flip                  (outer, height = N * 100vh)
 *     .sowel-flip__pin           (position: sticky)
 *       .sowel-flip__track       (display: flex, width = N * 100vw)
 *         .sowel-flip__page * N
 *
 * The user scrolls VERTICALLY. We read the outer container's scroll
 * progress and translate the inner track horizontally, so it feels
 * like flipping pages of a book. CSS provides the static layout and
 * the mobile / reduced-motion fallback (track becomes a vertical stack).
 *
 * Also injects a small set of dots fixed to the bottom-right that
 * indicates the current page and lets the user jump to a page.
 */
(function () {
  "use strict";

  // === Site title clickable (runs on every page) ======================
  // MkDocs Material only wraps the tiny logo icon in an <a>; the
  // 'Sowel Documentation' text next to it isn't a link. Make the
  // whole title behave like one so users can click anywhere on it
  // to return to the home page.
  function makeTitleClickable() {
    var title = document.querySelector(".md-header__title");
    var logo = document.querySelector(".md-header__button.md-logo");
    if (!title || !logo) return;
    var href = logo.getAttribute("href");
    if (!href) return;
    title.style.cursor = "pointer";
    title.setAttribute("role", "link");
    title.setAttribute("tabindex", "0");
    title.addEventListener("click", function () {
      window.location.href = href;
    });
    title.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.location.href = href;
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", makeTitleClickable);
  } else {
    makeTitleClickable();
  }

  function init() {
    var flip = document.querySelector(".sowel-flip");
    if (!flip) return;
    var pin = flip.querySelector(".sowel-flip__pin");
    var track = flip.querySelector(".sowel-flip__track");
    if (!pin || !track) return;

    var pages = track.querySelectorAll(".sowel-flip__page");
    var n = pages.length;
    if (n < 2) return;

    // Tell CSS how many pages we have (used by .sowel-flip height + track width).
    flip.style.setProperty("--sowel-flip-n", String(n));

    // Read the real header height (mkdocs material header + tabs) so the
    // sticky pin sits flush below them instead of being covered.
    function updateHeaderOffset() {
      var h = document.querySelector(".md-header");
      var t = document.querySelector(".md-tabs");
      var top = h ? h.offsetHeight : 0;
      // Tabs are positioned inside the header height in this theme, so we
      // only add their height when they're rendered below the header bar.
      if (t && t.getBoundingClientRect().bottom > (h ? h.getBoundingClientRect().bottom : 0)) {
        top = Math.max(top, t.getBoundingClientRect().bottom);
      }
      if (top > 0) {
        flip.style.setProperty("--sowel-flip-top", top + "px");
      }
    }
    updateHeaderOffset();

    // Disabled paths: small viewports + reduced motion.
    var mqSmall = window.matchMedia("(max-width: 899px)");
    var mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    function isDisabled() {
      return mqSmall.matches || mqReduced.matches;
    }

    // === Scroll cue (fixed bottom-right, only visible on the first page) =
    var cueLabel = (document.documentElement.lang || "en").startsWith("fr") ? "Défilez" : "Scroll";
    var cue = document.createElement("span");
    cue.className = "sowel-scroll-cue";
    cue.setAttribute("aria-hidden", "true");
    cue.innerHTML =
      "<span>" +
      cueLabel +
      '</span><span class="sowel-scroll-cue__chev">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>' +
      "</span>";
    document.body.appendChild(cue);

    // === Page indicator (dots) ==========================================
    var dots = document.createElement("div");
    dots.className = "sowel-flip__dots";
    dots.setAttribute("role", "tablist");
    dots.setAttribute("aria-label", "Page indicator");
    var dotEls = [];
    for (var i = 0; i < n; i++) {
      var b = document.createElement("button");
      b.className = "sowel-flip__dot";
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-label", "Go to page " + (i + 1));
      (function (idx) {
        b.addEventListener("click", function () {
          goTo(idx);
        });
      })(i);
      dots.appendChild(b);
      dotEls.push(b);
    }
    document.body.appendChild(dots);

    function setActiveDot(idx) {
      for (var i = 0; i < dotEls.length; i++) {
        if (i === idx) dotEls[i].setAttribute("aria-current", "true");
        else dotEls[i].removeAttribute("aria-current");
      }
    }

    // === Scroll → translateX ============================================
    function update() {
      if (isDisabled()) {
        track.style.transform = "";
        setActiveDot(-1);
        return;
      }
      var rect = flip.getBoundingClientRect();
      var scrolled = Math.max(0, -rect.top);
      var max = flip.offsetHeight - window.innerHeight;
      if (max <= 0) {
        track.style.transform = "translateX(0)";
        setActiveDot(0);
        return;
      }
      var progress = Math.min(1, scrolled / max);
      // 0..1 progress maps to 0..(n-1) page width in vw
      var translate = progress * (n - 1) * 100;
      track.style.transform = "translateX(-" + translate + "vw)";

      // Nearest page wins the dot highlight
      var current = Math.round(progress * (n - 1));
      setActiveDot(current);

      // Fade out the scroll cue as soon as the user has started flipping.
      // 0.04 ≈ a 4% scroll (one nudge of the wheel) is enough.
      cue.style.opacity = progress > 0.04 ? "0" : "";
      cue.style.pointerEvents = progress > 0.04 ? "none" : "";

      // The hero (page 1) already carries the Sowel logo + wordmark
      // in its copy column, so hide the duplicate header house mark
      // while we're on slide 1; bring it back from slide 2 onward.
      // We force opacity 1 (not "") because the landing's base CSS
      // pins it to 0 to prevent a flash on initial load.
      var headerLogo = document.querySelector(".md-header__button.md-logo");
      if (headerLogo) {
        var onHero = progress < 0.5 / (n - 1);
        headerLogo.style.opacity = onHero ? "0" : "1";
        headerLogo.style.pointerEvents = onHero ? "none" : "auto";
      }
    }

    function goTo(idx) {
      if (isDisabled()) {
        // Fallback: scroll the page into view in stacked layout
        var target = pages[idx];
        if (target && target.scrollIntoView) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      var max = flip.offsetHeight - window.innerHeight;
      var offset = flip.getBoundingClientRect().top + window.scrollY;
      var targetY = offset + (idx / (n - 1)) * max;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }

    // === Keyboard nav: Left/Right + PageUp/PageDown ======================
    window.addEventListener("keydown", function (e) {
      if (isDisabled()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var rect = flip.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      var max = flip.offsetHeight - window.innerHeight;
      var progress = Math.min(1, Math.max(0, -rect.top / max));
      var current = Math.round(progress * (n - 1));
      var next = null;
      if (e.key === "ArrowRight" || e.key === "PageDown") next = current + 1;
      else if (e.key === "ArrowLeft" || e.key === "PageUp") next = current - 1;
      if (next === null) return;
      next = Math.min(n - 1, Math.max(0, next));
      if (next !== current) {
        e.preventDefault();
        goTo(next);
      }
    });

    var rafPending = false;
    function onScroll() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(function () {
        rafPending = false;
        update();
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () {
      updateHeaderOffset();
      update();
    });
    mqSmall.addEventListener && mqSmall.addEventListener("change", update);
    mqReduced.addEventListener && mqReduced.addEventListener("change", update);
    update();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
