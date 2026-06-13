self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "AQHA Show Update", {
      body: data.body ?? "",
      tag: data.tag ?? "show-update",
      icon: "/favicon.ico",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes("/event/") && "focus" in client) return client.focus();
      }
      return clients.openWindow("/");
    })
  );
});
