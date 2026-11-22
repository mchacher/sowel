// Material wraps only the logo icon in a link. Make the whole header title
// go back to the home page too.
(function () {
  "use strict";
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
})();
