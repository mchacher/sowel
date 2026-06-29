/* Spec 127 — Web Push handlers, imported into the generated service worker.
 * The backend sends a JSON payload { title, body }. */
/* global self, clients */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { body: event.data && event.data.text ? event.data.text() : "" };
  }
  const title = data.title || "Sowel";
  const options = {
    body: data.body || "",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: data.tag || "sowel",
    data: { url: data.url || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
