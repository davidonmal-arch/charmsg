self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* open the chat list */ }
  const offer = payload.type === "offer" && typeof payload.offerId === "string";
  event.waitUntil(Promise.all([self.registration.showNotification(offer ? (payload.sender || "Игрок") + " предлагает обмен" : "CharMsg", {
    body: offer ? payload.body || "Открой предложение обмена" : "Новое личное сообщение",
    icon: new URL("assets/logo.jpg", self.registration.scope).href,
    ...(offer && /^https:\/\//.test(payload.image || "") ? { image: payload.image } : {}),
    tag: offer ? "offer-" + payload.offerId : payload.chatId || "charmsg-direct",
    data: offer ? { offerId: payload.offerId } : { chatId: payload.chatId }
  }), offer ? self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    for (const client of windows) client.postMessage({ type: "charmsg:offer", offerId: payload.offerId });
  }) : Promise.resolve()]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(self.registration.scope);
  const chatId = event.notification.data?.chatId;
  const offerId = event.notification.data?.offerId;
  url.hash = offerId ? "#/offers?offer=" + encodeURIComponent(offerId) : "#/chats" + (chatId ? "?chat=" + encodeURIComponent(chatId) : "");
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
