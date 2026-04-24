// Vision notifications service worker.
// Handles incoming Web Push events and relays clicks to the app.
//
// Payload shape (set by supabase/functions/notifications-send):
//   { title, body, link, category }

self.addEventListener("install", (event) => {
  // Activate immediately so a freshly-registered SW can receive pushes without
  // waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "Vision" };
  }

  const title = data.title || "Vision";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: {
      link: data.link || "/",
      category: data.category || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // If an app tab is already open, focus it and navigate.
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) {
              await client.navigate(link);
            } else {
              client.postMessage({ type: "notification-click", link });
            }
            return;
          }
        } catch {
          /* ignore */
        }
      }
      await self.clients.openWindow(link);
    })(),
  );
});
