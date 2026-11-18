import { claimSetupBonus } from "./store.js";
import { auth, runAction } from "./db.js";

export const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const scope = new URL("../", import.meta.url).href;
const ownerKey = "charmsg_push_owner";
const optOutKey = (uid) => "charmsg_push_disabled_" + uid;

export async function setupDefaultMessagePush(uid) {
  if (!pushSupported || localStorage.getItem(optOutKey(uid)) || Notification.permission === "denied"
    || await currentPushSubscription()) return null;
  const options = await prepareMessagePush();
  if (auth.currentUser?.uid !== uid || localStorage.getItem(optOutKey(uid))) return null;
  if (Notification.permission === "granted" && !localStorage.getItem(ownerKey)) {
    await enableMessagePush(options);
    return null;
  }
  return options;
}

export function optOutMessagePush(uid) {
  localStorage.setItem(optOutKey(uid), "1");
}

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
  void claimSetupBonus();
  localStorage.setItem(ownerKey, auth.currentUser.uid);
  localStorage.removeItem(optOutKey(auth.currentUser.uid));
  window.dispatchEvent(new Event("charmsg:push-changed"));
}

export async function disableMessagePush({ remember = true } = {}) {
  if (remember && auth.currentUser) optOutMessagePush(auth.currentUser.uid);
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  localStorage.removeItem(ownerKey);
  window.dispatchEvent(new Event("charmsg:push-changed"));
  await runAction("unsubscribeFromPush", subscription.endpoint);
}
