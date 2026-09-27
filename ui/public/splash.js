// Splash gate (#976). Loaded as a classic, render-blocking script from
// <head>, so it decides before the first paint and the splash never flashes.
// It lives in public/ rather than inline in index.html because the CSP is
// `script-src 'self'`.
//
// The splash is for a first landing, or a return after a long absence (the
// PWA's cold start in the morning). A refresh, a deep link opened in a new
// tab, a notification tap: straight to the app. localStorage, not
// sessionStorage, because a link opened in a new tab starts a fresh session.
// No storage (private mode, blocked site data): the splash shows, as before.
//
// Absence is measured from the last time a page was in use, not the last
// load: the stamp is refreshed whenever a page is hidden or closed, so a tab
// used all day and refreshed in the evening goes straight to the app.
(function () {
  var KEY = "sowel_last_visit";
  var ABSENCE_MS = 8 * 60 * 60 * 1000;
  var root = document.documentElement;
  var now = Date.now();
  var last = null;

  function stamp() {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch (e) {
      // no storage: every load shows the splash, as before
    }
  }

  try {
    last = Number(localStorage.getItem(KEY)) || null;
  } catch (e) {
    last = null;
  }
  stamp();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") stamp();
  });
  window.addEventListener("pagehide", stamp);

  // Theme before first paint, so neither the splash nor the empty page
  // behind a skipped one flashes light for a dark-mode user. main.tsx
  // applies the same setting again through applyTheme (theme.ts).
  try {
    var theme = localStorage.getItem("sowel_theme");
    var dark =
      theme === "dark" ||
      (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) root.classList.add("dark");
  } catch (e) {
    // theme.ts will apply it once the bundle runs
  }

  if (last !== null && now - last >= 0 && now - last < ABSENCE_MS) {
    root.classList.add("no-splash");
  } else {
    // main.tsx counts the splash's minimum from here, the first paint.
    root.dataset.splashTs = String(now);
  }
})();
