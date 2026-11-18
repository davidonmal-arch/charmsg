import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { sendNotification } from "web-push";

const vapid = process.env.CHARMSG_VAPID ? JSON.parse(process.env.CHARMSG_VAPID) : null;
const subscriptions = () => getFirestore().collection("pushSubscriptions");
const endpointId = (endpoint) => createHash("sha256").update(endpoint).digest("hex");
const invalid = () => new HttpsError("invalid-argument", "Браузер передал некорректную подписку.");

export function pushPublicKey() {
  if (!vapid) throw new HttpsError("failed-precondition", "Push-уведомления ещё не настроены.");
  return vapid.publicKey;
}

export function pushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) throw invalid();
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  const host = url.hostname;
  const knownHost = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com"
    || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
  if (!knownHost || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw invalid();
  return url.href;
}

export async function subscribeToPush(uid, input) {
  pushPublicKey();
  const endpoint = pushEndpoint(input?.endpoint);
  const { auth, p256dh } = input?.keys ?? {};
  if (typeof auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(auth)
    || typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(p256dh)) throw invalid();
  await subscriptions().doc(endpointId(endpoint)).set({ uid, endpoint, keys: { auth, p256dh } });
}

export async function unsubscribeFromPush(uid, value) {
  const endpoint = pushEndpoint(value);
  const db = getFirestore();
  const ref = subscriptions().doc(endpointId(endpoint));
  await db.runTransaction(async (tx) => {
    const stored = await tx.get(ref);
    if (stored.data()?.uid === uid) tx.delete(ref);
  });
}

export async function notifyDirectMessage(chat, senderUid) {
  if (!vapid || chat.isPublic || !chat.isDM) return;
  const recipient = chat.members?.find((uid) => uid !== senderUid);
  if (!recipient) return;
  const user = (await getFirestore().collection("users").doc(recipient).get()).data();
  if (!user || user.banned) return;
  const devices = await subscriptions().where("uid", "==", recipient).limit(10).get();
  await Promise.all(devices.docs.map(async (device) => {
    const { endpoint, keys } = device.data();
    try {
      await sendNotification({ endpoint: pushEndpoint(endpoint), keys }, JSON.stringify({ chatId: chat.id }), {
        TTL: 300,
        timeout: 2500,
        vapidDetails: { subject: "https://davidonmal-arch.github.io/charmsg/", ...vapid }
      });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await unsubscribeFromPush(recipient, endpoint);
      } else {
        console.warn("DM push delivery failed", error.statusCode || error.code || "unknown");
      }
    }
  }));
}
