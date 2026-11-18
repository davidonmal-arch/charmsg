import { enhanceNft, releaseNfts } from "./releases.js";
import { browserSignals, checkNetworkBan, rememberSignals, updatePlayerBan } from "./network-ban.js";
import { getAuth } from "firebase-admin/auth";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as ops from "./operations.js";
import { notifyDirectMessage, pushPublicKey, subscribeToPush, unsubscribeFromPush } from "./push.js";

const serviceAccount = process.env.CHARMSG_SERVICE_ACCOUNT;
if (serviceAccount) {
  const credentials = JSON.parse(serviceAccount);
  if (credentials.project_id !== process.env.GCLOUD_PROJECT) throw new Error("Firebase project does not match the service account");
  initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
} else {
  initializeApp();
}
const db = () => getFirestore();
const isAdmin = (auth) => auth.uid === ops.ADMIN_UID && auth.token.admin === true;
const denied = () => new HttpsError("permission-denied", "Для этого действия нет доступа");
const ttlValue = (value) => [1, 2, 7, 30].includes(value / ops.DAY) ? value : ops.DAY;

function id(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Некорректный идентификатор");
  }
  return value;
}

function data(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Некорректные данные");
  }
  return value;
}

async function read(collection, key) {
  const snap = await db().collection(collection).doc(id(key)).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}

function chatAccess(chat, user) {
  return chat && (chat.isPublic
    ? !chat.verifiedOnly || user?.verified === true || user?.isAdmin
    : chat.members?.includes(user?.uid));
}

async function authorizedChat(key, user, manage = false) {
  const chat = await read("chats", key);
  if (manage ? !(chat && (user.isAdmin || (chat.isPublic && chat.createdBy === user.uid))) : !chatAccess(chat, user)) {
    throw denied();
  }
  return chat;
}

function pasteEditor(paste, user) {
  return paste && (user.isAdmin || paste.authorUid === user.uid || paste.editors?.includes(user.uid));
}

async function authorizedPaste(key, user, ownerOnly = false) {
  const paste = await read("pastes", key);
  if (!pasteEditor(paste, user) || (ownerOnly && !user.isAdmin && paste.authorUid !== user.uid)) throw denied();
  return paste;
}

function authenticatedProfile(auth, profile) {
  return { ...profile, uid: auth.uid, isAdmin: isAdmin(auth) };
}

const actions = {
  checkAccess: () => null,
  async adminUnbanUser(user, target) {
    if (!user.isAdmin || target === ops.ADMIN_UID) throw denied();
    await updatePlayerBan(id(target), { banned: false, banType: "", banReason: "", banAt: 0, banYears: 0, banUntil: 0, banImage: "" }, false);
  },
  pushPublicKey,
  subscribeToPush: (user, input) => subscribeToPush(user.uid, input),
  unsubscribeFromPush: (user, endpoint) => unsubscribeFromPush(user.uid, endpoint),
  createProfile: (user, input) => {
    if (user.isAdmin || user.uid === ops.ADMIN_UID) throw denied();
    return ops.createProfile(user.uid, data(input));
  },
  updateProfile: (user, input) => ops.updateProfile(user.uid, data(input)),
  expireBanIfNeeded: (user) => ops.expireBanIfNeeded(user.uid),
  banForScreenshot: (user) => ops.banForScreenshot(user.uid),
  async adminSetPlayerPassword(user, target, input) {
    if (!user.isAdmin || target === ops.ADMIN_UID) throw denied();
    const uid = id(target);
    const { login, password } = data(input);
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      throw new HttpsError("invalid-argument", "Пароль должен содержать от 12 до 128 символов.");
    }
    if (!await read("users", uid)) throw new HttpsError("not-found", "Профиль не найден.");
    const auth = getAuth();
    const domain = "@players.charmsg.invalid";
    try {
      const account = await auth.getUser(uid);
      if (account.email && !account.email.endsWith(domain)) throw denied();
      const newLogin = typeof login === "string" ? login.trim().toLowerCase() : "";
      if (!account.email && !/^[a-z0-9_-]{3,24}$/.test(newLogin)) {
        throw new HttpsError("invalid-argument", "Для анонимного игрока укажите логин: 3–24 латинские буквы, цифры, дефисы или подчёркивания.");
      }
      const email = account.email || newLogin + domain;
      await auth.updateUser(uid, { ...(account.email ? {} : { email }), password });
      return { login: email.slice(0, -domain.length) };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error.code === "auth/email-already-exists") throw new HttpsError("already-exists", "Этот логин уже занят.");
      if (error.code === "auth/user-not-found") throw new HttpsError("not-found", "У этого профиля нет учётной записи Firebase.");
      throw new HttpsError("failed-precondition", "Firebase не смог сохранить пароль.");
    }
  },
  async adminBanUser(user, target, input) {
    if (!user.isAdmin || target === ops.ADMIN_UID) throw denied();
    const { reason, duration = 0, unit = "days", image = "", mode = "account" } = data(input);
    if (!["account", "radical"].includes(mode)) throw new HttpsError("invalid-argument", "Неизвестный тип бана.");
    const units = { minutes: 60_000, hours: 3_600_000, days: ops.DAY, years: 365.25 * ops.DAY };
    if (!Object.hasOwn(units, unit) || !Number.isSafeInteger(duration) || duration < 0
      || duration * units[unit] > 500 * units.years) {
      throw new HttpsError("invalid-argument", "Укажите срок от 0 до 500 лет");
    }
    if (typeof image !== "string" || image.length > 850_000 || (image &&
      !/^https:\/\/[^\s]+$/i.test(image) && !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image))) {
      throw new HttpsError("invalid-argument", "Загрузите фото JPEG, PNG или WebP либо укажите HTTPS-ссылку");
    }
    const banAt = Date.now();
    const ban = {
      banned: true,
      banType: mode === "radical" ? "radical" : "manual",
      banReason: String(reason || "").trim().slice(0, 600) || "Нарушение правил сообщества",
      banAt,
      banYears: unit === "years" ? duration : 0,
      banUntil: duration ? banAt + duration * units[unit] : 0,
      banImage: image || ops.BAN_IMAGE
    };
    await updatePlayerBan(id(target), ban, mode === "radical");
    return ban;
  },
  async adminBroadcast(user, text) {
    if (!user.isAdmin) throw denied();
    const chats = await db().collection("chats").where("isPublic", "==", true).get();
    await Promise.all(chats.docs.map((chat) => ops.sendMessage({ ...chat.data(), id: chat.id }, user, text)));
    return chats.size;
  },
  ensureMarket: () => ops.ensureMarket(),
  tickMarket: () => ops.tickMarket(),
  async ensureAdminProfile(user) {
    if (!user.isAdmin) throw denied();
    const ref = db().collection("users").doc(user.uid);
    await db().runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        tx.update(ref, { isAdmin: true, rank: 5, verified: true, uid: user.uid, nick: ops.ADMIN_LOGIN, nickLower: ops.ADMIN_LOGIN });
      } else {
        tx.create(ref, { uid: user.uid, nick: ops.ADMIN_LOGIN, nickLower: ops.ADMIN_LOGIN,
          isAdmin: true, rank: 5, verified: true, banned: false, coins: 100, chr: 0, chrCost: 0,
          bio: "", avatar: "./assets/logo.jpg", banner: "", msgCount: 0, createdAt: Date.now() });
      }
    });
  },
  async listChats(user) {
    const chats = db().collection("chats");
    const [publicChats, privateChats] = await Promise.all([
      chats.where("isPublic", "==", true).get(),
      chats.where("members", "array-contains", user.uid).get()
    ]);
    const result = new Map();
    for (const snap of [...publicChats.docs, ...privateChats.docs]) {
      const chat = { ...snap.data(), id: snap.id };
      if (chatAccess(chat, user)) {
        if (Number(chat.lastMessageAt) + ttlValue(Number(chat.ttl)) <= Date.now()) chat.lastMessage = "";
        result.set(snap.id, chat);
      }
    }
    return [...result.values()].sort((a, b) => (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0));
  },
  async listMessages(user, key, since) {
    await authorizedChat(key, user);
    const now = Date.now();
    const collection = db().collection("chats").doc(key).collection("messages");
    const messages = Number.isSafeInteger(since) && since > 0
      ? await collection.where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(50).get()
      : await collection.where("expiresAt", ">", now).orderBy("expiresAt", "desc").limit(50).get();
    return messages.docs.map((snap) => ({ ...snap.data(), id: snap.id }))
      .filter((message) => message.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  createPublicChat: (user, input) => ops.createPublicChat({ ...data(input), uid: user.uid, ttl: ttlValue(input.ttl) }),
  async openDM(user, peer) {
    if (!await read("users", peer)) throw new HttpsError("not-found", "Пользователь не найден");
    return ops.openDM(user.uid, peer);
  },
  async updateChatTtl(user, key, ttl) {
    await authorizedChat(key, user, true);
    return ops.updateChatTtl(key, ttlValue(ttl));
  },
  async deleteChat(user, key) {
    await authorizedChat(key, user, true);
    return db().recursiveDelete(db().collection("chats").doc(key));
  },
  async sendMessage(user, key, text) {
    const chat = await authorizedChat(key, user);
    const message = await ops.sendMessage(chat, user, text);
    await notifyDirectMessage(chat, user.uid).catch((error) => {
      console.warn("DM push lookup failed", error.code || "unknown");
    });
    return message;
  },
  async deleteMessage(user, key, messageId) {
    const chat = await authorizedChat(key, user);
    const message = await db().collection("chats").doc(key).collection("messages").doc(id(messageId)).get();
    if (message.exists && (user.isAdmin || chat.createdBy === user.uid || message.data().uid === user.uid)) {
      await message.ref.delete();
    } else throw denied();
  },
  async purgeExpiredMessages(user, key, max) {
    await authorizedChat(key, user);
    return ops.purgeExpiredMessages(key, Math.min(200, Math.max(1, Math.floor(Number(max) || 40))));
  },
  async listPastes(user) {
    const pastes = db().collection("pastes");
    const rank = Math.max(0, Math.min(5, Math.floor(Number(user.rank) || 0)));
    const owned = pastes.where("authorUid", "==", user.uid);
    const edited = pastes.where("editors", "array-contains", user.uid);
    const published = pastes.where("published", "==", true);
    const snapshots = await Promise.all((user.isAdmin ? [pastes] : [owned, edited, published]).map((q) => q.get()));
    const result = new Map();
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        const paste = { ...doc.data(), id: doc.id };
        if (pasteEditor(paste, user) || (paste.published === true && rank >= (Number(paste.minRank) || 0))) {
          result.set(doc.id, paste);
        }
      }
    }
    return [...result.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 120);
  },
  createPaste: (user, input) => ops.createPaste(user, data(input)),
  async savePaste(user, key, input) {
    await authorizedPaste(key, user);
    return ops.savePaste(key, user, data(input));
  },
  async setPastePublished(user, key, published) {
    await authorizedPaste(key, user, true);
    return ops.setPastePublished(key, published);
  },
  async setPasteEditors(user, key, editors) {
    await authorizedPaste(key, user, true);
    if (!Array.isArray(editors)) throw new HttpsError("invalid-argument", "Некорректный список редакторов");
    return ops.setPasteEditors(key, editors.slice(0, 30).map(id));
  },
  async deletePaste(user, key) {
    await authorizedPaste(key, user, true);
    return ops.deletePaste(key);
  },
  spinRoulette: (user, input) => ops.spinRoulette(user, data(input)),
  playUpgrade: (user, input) => {
    const upgrade = data(input);
    if (upgrade.stakeType === "nft") id(upgrade.stakeNftId);
    if (upgrade.targetType === "nft") id(upgrade.targetNftId);
    return ops.playUpgrade(user, upgrade);
  },
  async setFeaturedNft(user, key) {
    const profile = db().collection("users").doc(user.uid);
    if (key === null) return profile.update({ featuredNftId: null }).then(() => null);
    const ref = db().collection("nfts").doc(id(key));
    await db().runTransaction(async (tx) => {
      const nft = await tx.get(ref);
      if (nft.data()?.ownerUid !== user.uid) throw denied();
      tx.update(profile, { featuredNftId: key });
    });
  },
  releaseNfts: (user, input) => {
    if (!user.isAdmin) throw denied();
    return releaseNfts(user, data(input));
  },
  enhanceNft: (user, key) => enhanceNft(user.uid, id(key)),
  playChance: (user, input) => ops.playChance(user, data(input)),
  claimDailyReward: (user) => ops.claimDailyReward(user.uid),
  playClicker: (user, input) => ops.playClicker(user, data(input)),
  createNft: (user, input) => ops.createNft(user, data(input)),
  setNftSale: (user, key, price) => ops.setNftSale(id(key), user, price),
  giftNft: (user, key, nick) => ops.giftNft(id(key), user.uid, nick),
  buyNft: (user, key) => ops.buyNft(id(key), user),
  deleteNft: (user, key) => ops.deleteNft(id(key), user),
  trade: (user, side, amount) => {
    if (!["buy", "sell"].includes(side)) throw new HttpsError("invalid-argument", "Неизвестный тип сделки");
    return ops.trade(user.uid, side, amount);
  }
};

const withoutProfile = new Set(["checkAccess", "createProfile", "ensureAdminProfile", "ensureMarket", "listChats", "listPastes"]);
let quotaRetryAt = 0;
const quotaError = () => new HttpsError("resource-exhausted", "Временный лимит Firestore исчерпан. Попробуйте позже.");
export const charmsgAction = onCall({
  maxInstances: 8,
  cors: process.env.CHARMSG_WEB_ORIGIN || true
}, async ({ auth, data: request, rawRequest }) => {
  if (!auth) throw new HttpsError("unauthenticated", "Войдите в CharMsg");
  const { action, args } = data(request);
  if (typeof action !== "string" || !Object.hasOwn(actions, action) || !Array.isArray(args)) {
    throw new HttpsError("invalid-argument", "Неизвестное действие");
  }
  if (Date.now() < quotaRetryAt) throw quotaError();
  try {
    const profile = await read("users", auth.uid);
    if (!profile && !withoutProfile.has(action)) throw new HttpsError("failed-precondition", "Сначала создайте профиль");
    if (profile && action === "createProfile") throw new HttpsError("already-exists", "Профиль уже существует");
    if (profile?.banned && !["checkAccess", "expireBanIfNeeded"].includes(action)) throw denied();
    const signals = isAdmin(auth) ? [] : browserSignals(rawRequest, request.browserId);
    if (!profile?.banned) await checkNetworkBan(signals);
    const result = await actions[action](authenticatedProfile(auth, profile), ...args);
    if ((action === "checkAccess" && profile && !profile.banned) || action === "createProfile") {
      await rememberSignals(auth.uid, signals).catch((error) => console.warn("Moderation signal save failed", error.code || "unknown"));
    }
    return result ?? null;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error.code === 8) {
      quotaRetryAt = Date.now() + 60_000;
      throw quotaError();
    }
    if (typeof error.code === "number") {
      console.error(error);
      throw new HttpsError("internal", "Операция не выполнена");
    }
    throw new HttpsError("failed-precondition", error.message);
  }
});
