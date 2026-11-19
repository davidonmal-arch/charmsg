import { randomInt } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "./database.js";

const db = () => getFirestore();
const users = () => db().collection("users");
const round = (value) => Math.round(value * 100) / 100;
const cleanUsername = (value) => String(value || "").trim().toLowerCase().replace(/^@/, "");
const validUsername = (value) => /^[a-z0-9_]{3,24}$/.test(value);
const eventRef = () => db().doc("community/event");

export async function setUsername(uid, value) {
  const username = cleanUsername(value);
  if (!validUsername(username)) throw new Error("Юзернейм: 3–24 латинские буквы, цифры или подчёркивания");
  if (uid !== "admin_farnaz" && ["admin", "farnaz", "charmsg", "support", "system"].includes(username)) throw new Error("Юзернейм зарезервирован");
  const ref = users().doc(uid);
  const names = db().collection("usernames");
  await db().runTransaction(async (tx) => {
    const profile = (await tx.get(ref)).data();
    if (!profile || profile.banned) throw new Error("Профиль недоступен");
    if (profile.username === username) return;
    const next = names.doc(username);
    const claim = await tx.get(next);
    const previous = validUsername(profile.username || "") ? await tx.get(names.doc(profile.username)) : null;
    if (claim.exists && claim.data().uid !== uid) throw new Error("Этот юзернейм уже занят");
    if (previous?.data()?.uid === uid) tx.delete(previous.ref);
    tx.set(next, { uid });
    tx.update(ref, { username });
  });
  return { username };
}

export async function findPlayer(value) {
  const username = cleanUsername(value);
  if (validUsername(username)) {
    const lookup = (await db().collection("usernames").doc(username).get()).data();
    if (lookup) {
      const profile = await users().doc(lookup.uid).get();
      if (profile.exists) return [{ uid: profile.id, nick: profile.data().nick, username, clanTag: profile.data().clanTag || "" }];
    }
  }
  const nick = String(value || "").trim().toLowerCase();
  if (!nick || nick.length > 24 || nick.startsWith("@")) return [];
  const results = await users().where("nickLower", ">=", nick).where("nickLower", "<=", nick + "\uf8ff").limit(8).get();
  return results.docs.map((doc) => {
    const { nick, username, clanTag } = doc.data();
    return { uid: doc.id, nick, username: username || "", clanTag: clanTag || "" };
  });
}

export async function changeClan(uid, { action, tag, name }) {
  const key = String(tag || "").trim().toUpperCase();
  const title = String(name || "").trim();
  if (!["create", "join", "leave"].includes(action)) throw new Error("Выберите действие с кланом");
  if (action !== "leave" && !/^[A-Z0-9]{2,6}$/.test(key)) throw new Error("Тег клана: 2–6 латинских букв или цифр");
  if (action === "create" && (title.length < 2 || title.length > 40)) throw new Error("Название клана: 2–40 символов");
  const profile = users().doc(uid);
  return db().runTransaction(async (tx) => {
    const account = (await tx.get(profile)).data();
    if (!account || account.banned) throw new Error("Профиль недоступен");
    if (action === "leave") {
      tx.update(profile, { clanTag: "", clanName: "" });
      return { clanTag: "" };
    }
    if (account.clanTag) throw new Error("Сначала выйдите из текущего клана");
    const clan = db().collection("clans").doc(key);
    const existing = await tx.get(clan);
    if (action === "create") {
      if (existing.exists) throw new Error("Такой тег уже занят");
      tx.create(clan, { name: title, founderUid: uid, createdAt: Date.now() });
    } else if (!existing.exists) throw new Error("Клан с таким тегом не найден");
    tx.update(profile, { clanTag: key, clanName: existing.data()?.name || title });
    return { clanTag: key };
  });
}

export async function claimSetupRewards(user) {
  const eligible = {};
  if (!user.passwordRewardAt) {
    const account = await getAuth().getUser(user.uid);
    if (account.providerData.some((provider) => provider.providerId === "password")) eligible.passwordRewardAt = true;
  }
  if (!user.pushRewardAt) {
    const subscriptions = await db().collection("pushSubscriptions").where("uid", "==", user.uid).limit(1).get();
    if (!subscriptions.empty) eligible.pushRewardAt = true;
  }
  if (!Object.keys(eligible).length) return { reward: 0 };
  const ref = users().doc(user.uid);
  return db().runTransaction(async (tx) => {
    const profile = (await tx.get(ref)).data();
    if (!profile || profile.banned) throw new Error("Профиль недоступен");
    const patch = Object.fromEntries(Object.keys(eligible).filter((field) => !profile[field]).map((field) => [field, Date.now()]));
    const reward = Object.keys(patch).length * 20;
    if (reward) tx.update(ref, { ...patch, coins: round((Number(profile.coins) || 0) + reward) });
    return { reward };
  });
}

const businesses = {
  shop: { buy: 25, hourly: 5, repair: 3 },
  factory: { buy: 60, hourly: 13, repair: 8 },
  company: { buy: 120, hourly: 28, repair: 16 }
};
const HOUR = 3_600_000;

function businessView(items, now) {
  return Object.fromEntries(Object.entries(businesses).map(([type, config]) => {
    const item = items[type];
    const accrued = item ? Math.floor(Math.max(0, Math.min(now, item.breakAt) - item.paidThrough) * config.hourly / HOUR) : 0;
    return [type, { ...config, owned: !!item, broken: !!item && now >= item.breakAt, accrued }];
  }));
}

export async function manageBusiness(uid, { action, type }) {
  const ref = users().doc(uid);
  const inventory = ref.collection("private").doc("business");
  const now = Date.now();
  if (action === "status") return businessView((await inventory.get()).data() || {}, now);
  if (!Object.hasOwn(businesses, type) || !["buy", "collect", "repair"].includes(action)) throw new Error("Неизвестное действие");
  const config = businesses[type];
  return db().runTransaction(async (tx) => {
    const profile = (await tx.get(ref)).data();
    const items = (await tx.get(inventory)).data() || {};
    const status = businessView(items, now)[type];
    if (!profile || profile.banned) throw new Error("Профиль недоступен");
    let delta;
    if (action === "buy") {
      if (status.owned) throw new Error("Этот бизнес уже куплен");
      delta = -config.buy;
    } else if (action === "repair") {
      if (!status.broken) throw new Error("Бизнес не сломан");
      if (status.accrued) throw new Error("Сначала заберите накопленный доход");
      delta = -config.repair;
    } else {
      if (!status.accrued) throw new Error("Доход ещё не накопился");
      delta = status.accrued;
    }
    const balance = Number(profile.coins) || 0;
    if (balance + delta < 0) throw new Error("Недостаточно CR");
    if (action === "collect") {
      items[type].paidThrough += Math.ceil(delta * HOUR / config.hourly);
    } else {
      items[type] = { paidThrough: now, breakAt: now + randomInt(2 * HOUR, 6 * HOUR + 1) };
    }
    tx.set(inventory, items);
    tx.update(ref, { coins: round(balance + delta) });
    return businessView(items, now);
  });
}

export async function startEvent({ title, message, hours, bonus }) {
  const name = String(title || "").trim();
  const text = String(message || "").trim();
  if (name.length < 2 || name.length > 60 || text.length > 400 ||
      !Number.isInteger(hours) || hours < 1 || hours > 168 ||
      !Number.isInteger(bonus) || bonus < 0 || bonus > 1000) throw new Error("Проверьте название, срок и награду ивента");
  const now = Date.now();
  await eventRef().set({ id: db().collection("community").doc().id, title: name, message: text, endsAt: now + hours * HOUR, bonus });
}

export async function stopEvent() {
  await eventRef().delete();
}

export async function claimEvent(uid) {
  return db().runTransaction(async (tx) => {
    const event = (await tx.get(eventRef())).data();
    const ref = users().doc(uid);
    const profile = (await tx.get(ref)).data();
    if (!profile || profile.banned || !event?.bonus || event.endsAt <= Date.now()) throw new Error("Награда ивента недоступна");
    if (profile.claimedEvent === event.id) throw new Error("Награда уже получена");
    tx.update(ref, { claimedEvent: event.id, coins: round((Number(profile.coins) || 0) + event.bonus) });
    return { reward: event.bonus };
  });
}
