import { auth, runAction } from "./db.js";

export const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const scope = new URL("../", import.meta.url).href;
const ownerKey = "charmsg_push_owner";

export async function prepareMessagePush() {
  const [publicKey] = await Promise.all([
    runAction("pushPublicKey"),
    navigator.serviceWorker.register(new URL("sw.js", scope))
  ]);
  const registration = await navigator.serviceWorker.ready;
  return { publicKey, registration };
}

export async function currentPushSubscription() {
  if (!pushSupported || localStorage.getItem(ownerKey) !== auth.currentUser?.uid) return null;
  const registration = await navigator.serviceWorker.getRegistration(scope);
  return registration?.pushManager.getSubscription() ?? null;
}

export async function enableMessagePush({ registration, publicKey }) {
  if (Notification.permission === "denied") {
    throw new Error("Разрешите уведомления в настройках браузера.");
  }
  const options = { userVisibleOnly: true, applicationServerKey: publicKey };
  const subscription = await registration.pushManager.subscribe(options);
  await runAction("subscribeToPush", subscription.toJSON());
  localStorage.setItem(ownerKey, auth.currentUser.uid);
}

export async function disableMessagePush() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  localStorage.removeItem(ownerKey);
  await runAction("unsubscribeFromPush", subscription.endpoint);
}
