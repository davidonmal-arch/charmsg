import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const handlers = {}, displayed = [], messages = [], destinations = [];
const scope = "https://davidonmal-arch.github.io/charmsg/";
const client = { url: scope, postMessage: message => messages.push(message), navigate: async url => { destinations.push(url); return { focus() {} }; } };
const self = {
  addEventListener: (name, callback) => { handlers[name] = callback; },
  registration: { scope, showNotification: async (title, options) => { displayed.push({ title, options }); } },
  clients: { matchAll: async () => [client], openWindow: async url => destinations.push(url) }
};
runInNewContext(await readFile(new URL("../sw.js", import.meta.url), "utf8"), { self, URL, Promise, encodeURIComponent });
async function push(payload) {
  let completion;
  handlers.push({ data: { json: () => payload }, waitUntil: promise => { completion = promise; } });
  await completion;
}
await push({ type: "offer", offerId: "offer123", sender: "Alice", body: "Котокролик", image: "https://charmsg-api.onrender.com/notification-image/nft123?signature=example" });
assert.equal(displayed[0].title, "Alice предлагает обмен");
assert.equal(displayed[0].options.body, "Котокролик");
assert.ok(displayed[0].options.image.includes("notification-image"));
assert.equal(messages[0].type, "charmsg:offer");
let clicked;
handlers.notificationclick({ notification: { data: { offerId: "offer123" }, close() {} }, waitUntil: promise => { clicked = promise; } });
await clicked;
assert.equal(destinations[0], scope + "#/offers?offer=offer123");
await push({ chatId: "chat123" });
assert.equal(displayed[1].options.body, "Новое личное сообщение");
handlers.notificationclick({ notification: { data: { chatId: "chat123" }, close() {} }, waitUntil: promise => { clicked = promise; } });
await clicked;
assert.equal(destinations[1], scope + "#/chats?chat=chat123");
console.log("Notification checks passed: offer image/title, foreground delivery, offer deep link and existing chat notifications.");
