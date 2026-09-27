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
(function () {
  var KEY = "sowel_last_visit";
  var ABSENCE_MS = 8 * 60 * 60 * 1000;
  var root = document.documentElement;
  var now = Date.now();
  var last = null;
  try {
    last = Number(localStorage.getItem(KEY)) || null;
    localStorage.setItem(KEY, String(now));
  } catch (e) {
    last = null;
  }
  if (last !== null && now - last >= 0 && now - last < ABSENCE_MS) {
    root.classList.add("no-splash");
  } else {
    // main.tsx counts the splash's minimum from here, the first paint.
    root.dataset.splashTs = String(now);
  }
})();
