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

// Links back to the showcase site (sowel.org), in the language of the page: the
// articles and the site home. They sit at the end of the tab bar on a wide
// screen and at the end of the menu on a phone. The site's Docs menu points the
// other way, so each site reaches the other from its header.
(function () {
  "use strict";
  var fr = (document.documentElement.lang || "").indexOf("fr") === 0;
  var base = "https://sowel.org/" + (fr ? "fr" : "en") + "/";
  var links = [
    { label: "Articles", href: base + "articles/" },
    { label: fr ? "Site Sowel" : "Sowel site", href: base },
  ];
  function make(cls, linkCls, first) {
    return links.map(function (l, i) {
      var li = document.createElement("li");
      li.className = cls + " sowel-bridge" + (first && i === 0 ? " sowel-bridge--first" : "");
      var a = document.createElement("a");
      a.className = linkCls;
      a.href = l.href;
      a.textContent = l.label + " ↗";
      li.appendChild(a);
      return li;
    });
  }
  function addBridge() {
    var tabs = document.querySelector(".md-tabs__list");
    if (tabs && !tabs.querySelector(".sowel-bridge")) {
      make("md-tabs__item", "md-tabs__link", true).forEach(function (li) { tabs.appendChild(li); });
    }
    var drawer = document.querySelector(".md-nav--primary > .md-nav__list");
    if (drawer && !drawer.querySelector(".sowel-bridge")) {
      make("md-nav__item", "md-nav__link", false).forEach(function (li) { drawer.appendChild(li); });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addBridge);
  } else {
    addBridge();
  }
})();
