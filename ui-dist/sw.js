if (!self.define) {
  let e,
    i = {};
  const n = (n, s) => (
    (n = new URL(n + ".js", s).href),
    i[n] ||
      new Promise((i) => {
        if ("document" in self) {
          const e = document.createElement("script");
          ((e.src = n), (e.onload = i), document.head.appendChild(e));
        } else ((e = n), importScripts(n), i());
      }).then(() => {
        let e = i[n];
        if (!e) throw new Error(`Module ${n} didn’t register its module`);
        return e;
      })
  );
  self.define = (s, r) => {
    const o = e || ("document" in self ? document.currentScript.src : "") || location.href;
    if (i[o]) return;
    let t = {};
    const d = (e) => n(e, o),
      f = { module: { uri: o }, exports: t, require: d };
    i[o] = Promise.all(s.map((e) => f[e] || d(e))).then((e) => (r(...e), t));
  };
}
define(["./workbox-3e722498"], function (e) {
  "use strict";
  (self.skipWaiting(),
    e.clientsClaim(),
    e.precacheAndRoute(
      [
        { url: "registerSW.js", revision: "1872c500de691dce40960bb85481de07" },
        { url: "index.html", revision: "c3e477c390e163fe33672af153bd3257" },
        { url: "assets/index-CSMtfWzw.js", revision: null },
        { url: "assets/index-0Fhy47qM.css", revision: null },
        { url: "apple-touch-icon-180x180.png", revision: "df3e70f0e86dd1f9f57527ff6a84915c" },
        { url: "favicon.svg", revision: "6ea2ecf5dcba8e639b91707c9e559b8c" },
        { url: "pwa-192x192.png", revision: "7e1a4d770576c03eddf4351c6f3e7ee1" },
        { url: "pwa-512x512.png", revision: "94fd2521ca866701b21af91c5089b188" },
        { url: "pwa-maskable-512x512.png", revision: "9a6686556af3f280839addec378b8bdf" },
        { url: "manifest.webmanifest", revision: "0886aa777f271bd21764de11459dbbf0" },
      ],
      {},
    ),
    e.cleanupOutdatedCaches(),
    e.registerRoute(
      new e.NavigationRoute(e.createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }),
    ),
    e.registerRoute(/^\/api\//, new e.NetworkOnly(), "GET"));
});
