self.addEventListener("push", (event) => {
  let chatId;
  try { chatId = event.data?.json()?.chatId; } catch { /* open the chat list */ }
  event.waitUntil(self.registration.showNotification("CharMsg", {
    body: "Новое личное сообщение",
    icon: new URL("assets/logo.jpg", self.registration.scope).href,
    tag: chatId || "charmsg-direct",
    data: { chatId }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(self.registration.scope);
  const chatId = event.notification.data?.chatId;
  url.hash = "#/chats" + (chatId ? "?chat=" + encodeURIComponent(chatId) : "");
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((window) => window.url.startsWith(self.registration.scope));
    if (client) {
      const navigated = await client.navigate(url.href);
      if (navigated) return navigated.focus();
    }
    return self.clients.openWindow(url.href);
  })());
});
