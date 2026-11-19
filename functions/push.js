import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "./database.js";
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
  return sendToUser(recipient, { chatId: chat.id });
}

export async function notifyTradeOffer(recipient, offer) {
  const nft = offer.give?.find(nft => nft.image);
  let image;
  if (nft && /^https:\/\/\S{1,2040}$/.test(nft.image)) image = nft.image;
  else if (nft && vapid) {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const signature = createHmac("sha256", vapid.privateKey).update(nft.id + ":" + expires).digest("hex");
    image = (process.env.RENDER_EXTERNAL_URL || "https://charmsg-api.onrender.com") + "/notification-image/" + encodeURIComponent(nft.id) + "?expires=" + expires + "&signature=" + signature;
  }
  return sendToUser(recipient, {
    type: "offer", offerId: offer.id, sender: offer.creatorNick,
    body: offer.give?.length ? offer.give.map(nft => nft.name).join(", ").slice(0, 120) : String(offer.giveCr) + " CR",
    ...(image ? { image } : {})
  });
}

export async function notificationImage(nftId, expires, signature) {
  if (!vapid || !/^[a-zA-Z0-9_-]{1,160}$/.test(nftId) || !/^\d{1,12}$/.test(expires || "")
    || Number(expires) < Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(signature || "")) return null;
  const expected = createHmac("sha256", vapid.privateKey).update(nftId + ":" + expires).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
  const nft = (await getFirestore().doc("nfts/" + nftId).get()).data();
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]{1,160000})$/.exec(nft?.image || "");
  return match ? { type: match[1], bytes: Buffer.from(match[2], "base64") } : null;
}

async function sendToUser(recipient, payload) {
  if (!vapid) return;
  const user = (await getFirestore().collection("users").doc(recipient).get()).data();
  if (!user || user.banned) return;
  const devices = await subscriptions().where("uid", "==", recipient).limit(10).get();
  await Promise.all(devices.docs.map(async (device) => {
    const { endpoint, keys } = device.data();
    try {
      await sendNotification({ endpoint: pushEndpoint(endpoint), keys }, JSON.stringify(payload), {
        TTL: 300,
        timeout: 2500,
        vapidDetails: { subject: "https://davidonmal-arch.github.io/charmsg/", ...vapid }
      });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await unsubscribeFromPush(recipient, endpoint);
      } else {
        console.warn("Push delivery failed", error.statusCode || error.code || "unknown");
      }
    }
  }));
}
