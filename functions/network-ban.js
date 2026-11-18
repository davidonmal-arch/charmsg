import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

const key = process.env.CHARMSG_MODERATION_KEY;
// shortcut: one registry fits a small moderator team, shard by signal if active bans approach the Firestore document limit.
const bans = () => getFirestore().doc("moderation/networkBans");
const loginSignals = (uid) => getFirestore().doc(`users/${uid}/private/login`);
let cachedBans;
let expiresAt = 0;

export function browserSignals(request, browserId) {
  if (!key) return [];
  const ip = process.env.RENDER ? request.get("CF-Connecting-IP") : undefined;
  const signals = [];
  if (isIP(ip || "")) signals.push(["ip", ip.toLowerCase()]);
  if (typeof browserId === "string" && /^[a-f0-9-]{36}$/.test(browserId)) signals.push(["browser", browserId]);
  return signals.map(([type, value]) => createHmac("sha256", key).update(type + ":" + value).digest("hex"));
}

export async function checkNetworkBan(signals) {
  if (!signals.length) return;
  const now = Date.now();
  if (!cachedBans || expiresAt <= now) {
    cachedBans = (await bans().get()).data()?.entries || {};
    expiresAt = now + 30_000;
  }
  const match = Object.values(cachedBans).find((ban) => (!ban.until || ban.until > now)
    && ban.signals.some((signal) => signals.includes(signal)));
  if (match) {
    throw new HttpsError("permission-denied", "Доступ заблокирован усиленным баном.", {
      kind: "network-ban", until: match.until, since: match.since
    });
  }
}

export async function rememberSignals(uid, signals) {
  if (!signals.length) return;
  const ref = loginSignals(uid);
  const previous = (await ref.get()).data()?.signals || [];
  if (JSON.stringify(previous) !== JSON.stringify(signals)) await ref.set({ signals });
}

export async function updatePlayerBan(uid, profilePatch, radical) {
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`);
    const registry = await tx.get(bans());
    const entries = Object.fromEntries(Object.entries(registry.data()?.entries || {})
      .filter(([, entry]) => !entry.until || entry.until > Date.now()));
    delete entries[uid];
    if (radical) {
      const signals = (await tx.get(loginSignals(uid))).data()?.signals || [];
      if (!signals.length) throw new HttpsError("failed-precondition", "Игроку нужно хотя бы раз открыть CharMsg после обновления.");
      entries[uid] = { signals, until: profilePatch.banUntil, since: profilePatch.banAt };
    }
    tx.set(bans(), { entries });
    tx.update(ref, profilePatch);
  });
  cachedBans = undefined;
}
