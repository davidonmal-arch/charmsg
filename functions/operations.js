import { createHash, randomInt } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";

const db = () => getFirestore();
const collection = (database, ...path) => {
  if (database !== db) throw new Error("Invalid database");
  return db().collection(path.join("/"));
};
const doc = (parent, ...path) => parent === db ? db().doc(path.join("/")) : parent.doc(...path);
const getDoc = async (ref) => snapshot(await ref.get());
const getDocs = async (ref) => ref.get();
const setDoc = (ref, data) => ref.set(data);
const updateDoc = (ref, data) => ref.update(data);
const deleteDoc = (ref) => ref.delete();
const where = (...args) => (ref) => ref.where(...args);
const limit = (value) => (ref) => ref.limit(value);
const query = (ref, ...constraints) => constraints.reduce((result, apply) => apply(result), ref);
const snapshot = (snap) => ({ exists: () => snap.exists, data: () => snap.data() });
const runTransaction = (_, callback) => db().runTransaction((tx) => callback({
  get: async (ref) => snapshot(await tx.get(ref)),
  set: (...args) => tx.set(...args),
  update: (...args) => tx.update(...args),
  delete: (...args) => tx.delete(...args)
}));

const randomFloat = () => randomInt(2 ** 32) / 2 ** 32;
const randomId = (prefix) => prefix + "_" + db().collection("pastes").doc().id;
const MAX_RANK = 5;
const NFT_MIN_RANK = 3;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rankOf = (user) => clamp(Math.floor(Number(user?.rank) || 0), 0, MAX_RANK);
export const DAY = 86_400_000;
export const ADMIN_UID = "admin_farnaz";
export const ADMIN_LOGIN = "farnaz";

export const BAN_IMAGE = "./assets/ban.jpg";
export const SCREENSHOT_BAN_REASON =
  "Обнаружена попытка сделать скриншот экрана. Правила CharMsg запрещают сохранять переписку, профили и закрытый контент: это нарушает анонимность участников.";

export const NFT_EFFECTS = [
  { key: "none", name: "Без эффекта", css: "" },
  { key: "glow", name: "Свечение", css: "fx-glow" },
  { key: "holo", name: "Голограмма", css: "fx-holo" },
  { key: "pulse", name: "Пульс", css: "fx-pulse" },
  { key: "fire", name: "Пламя", css: "fx-fire" },
  { key: "void", name: "Бездна", css: "fx-void" },
  { key: "rainbow", name: "Радуга", css: "fx-rainbow" },
  { key: "aurora", name: "Северное сияние", css: "fx-aurora" },
  { key: "ice", name: "Лёд", css: "fx-ice" },
  { key: "gold", name: "Золото", css: "fx-gold" },
  { key: "sparkle", name: "Искры", css: "fx-sparkle" },
  { key: "glitch", name: "Глитч", css: "fx-glitch" }
];

export function canAccessChat(chat, profile) {
  if (!chat?.verifiedOnly) return true;
  return !!profile?.verified || !!profile?.isAdmin;
}

export function canCreateNft(profile) {
  return !!profile && (!!profile.isAdmin || rankOf(profile) >= NFT_MIN_RANK);
}

// European roulette red pockets.
const ROULETTE_RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

export function rouletteColor(number) {
  const n = Number(number);
  if (n === 0) return "green";
  return ROULETTE_RED.has(n) ? "red" : "black";
}

export const CASINO_MIN_BET = 1;
export const CASINO_MAX_BET = 100_000;
export const UPGRADE_MIN_CHANCE = 0.02;
export const UPGRADE_MAX_CHANCE = 0.95;

export const RESERVED_NICKS = ["farnaz", "admin", "charmsg", "system", "support", "админ", "модератор"];

export function validateNick(nick) {
  const value = String(nick || "").trim();
  if (value.length < 2) return "Ник должен быть не короче 2 символов";
  if (value.length > 18) return "Ник должен быть не длиннее 18 символов";
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(value)) return "Можно использовать буквы, цифры, пробел, _ и -";
  if (RESERVED_NICKS.includes(value.toLowerCase())) return "Этот ник зарезервирован";
  return "";
}

const MARKET_REF = () => doc(db, "market", "state");
export const BOT_NAMES = ["Nova", "Kryptos", "Pixel", "Void", "Astra", "Neon", "Orion", "Lumen", "Echo", "Nyx"];

function pushHistory(history, price, now) {
  const list = Array.isArray(history) ? [...history] : [];
  const last = list[list.length - 1];
  if (last && now - last.t < 3500) list[list.length - 1] = { t: now, p: price };
  else list.push({ t: now, p: price });
  return list.slice(-90);
}

let tickBusy = false;
let lastTickAttempt = 0;
function cleanChapters(chapters) {
  return (Array.isArray(chapters) ? chapters : [])
    .slice(0, 24)
    .map((chapter) => ({
      id: String(chapter?.id || randomId("ch")),
      title: String(chapter?.title || "").slice(0, 120),
      text: String(chapter?.text || "").slice(0, 5000)
    }))
    .filter((chapter) => chapter.title.trim() || chapter.text.trim());
}

function casinoBet(value) {
  const bet = Math.floor(Number(value) || 0);
  if (!Number.isFinite(bet) || bet < CASINO_MIN_BET) throw new Error("Минимальная ставка — 1 CR");
  if (bet > CASINO_MAX_BET) throw new Error(`Максимальная ставка — ${CASINO_MAX_BET.toLocaleString("ru-RU")} CR`);
  return bet;
}

function nftValue(nft) {
  return Math.max(1, Number(nft?.price) || Number(nft?.lastPrice) || 100);
}


export async function createProfile(uid, { nick, bio = "", avatar = "" }) {
  const error = validateNick(nick);
  if (error) throw new Error(error);
  const cleanNick = String(nick).trim();
  const data = {
    uid,
    nick: cleanNick,
    nickLower: cleanNick.toLowerCase(),
    bio: String(bio || "").slice(0, 240),
    avatar: String(avatar || ""),
    banner: "",
    isAdmin: uid === ADMIN_UID,
    verified: false,
    rank: uid === ADMIN_UID ? MAX_RANK : 0,
    coins: 100,
    chr: 0,
    chrCost: 0,
    banned: false,
    msgCount: 0,
    createdAt: Date.now(),
    lastSeen: Date.now()
  };
  await db().runTransaction(async (tx) => {
    const users = db().collection("users");
    const existing = await tx.get(users.where("nickLower", "==", data.nickLower).limit(1));
    if (!existing.empty) throw new Error("Этот ник уже занят");
    tx.create(users.doc(uid), data);
  });
  return data;
}

export async function updateProfile(uid, { nick, bio, avatar, banner }) {
  const error = validateNick(nick);
  if (error) throw new Error(error);
  const cleanNick = String(nick).trim();
  const patch = {
    nick: cleanNick,
    nickLower: cleanNick.toLowerCase(),
    bio: String(bio || "").slice(0, 240),
    avatar: String(avatar || ""),
    banner: String(banner || ""),
    lastSeen: Date.now()
  };
  await db().runTransaction(async (tx) => {
    const users = db().collection("users");
    const existing = await tx.get(users.where("nickLower", "==", patch.nickLower).limit(3));
    if (existing.docs.some((snap) => snap.id !== uid)) throw new Error("Этот ник уже занят");
    tx.update(users.doc(uid), patch);
  });
  return patch;
}

export async function createPublicChat({ name, desc = "", emoji = "💬", ttl = DAY, uid }) {
  const cleanName = String(name || "").trim().slice(0, 40);
  if (cleanName.length < 2) throw new Error("Название чата слишком короткое");
  const ref = doc(collection(db, "chats"));
  await setDoc(ref, {
    name: cleanName,
    desc: String(desc || "").slice(0, 160),
    emoji: String(emoji || "💬").slice(0, 8),
    ttl: Number(ttl) || DAY,
    isPublic: true,
    isDM: false,
    members: [],
    createdBy: uid,
    createdAt: Date.now(),
    lastMessage: "",
    lastMessageAt: 0,
    lastSender: ""
  });
  return ref.id;
}

export async function openDM(meUid, otherUid) {
  if (!meUid || !otherUid) throw new Error("Не удалось открыть личный чат");
  if (meUid === otherUid) throw new Error("Нельзя написать самому себе");
  const members = [meUid, otherUid].sort();
  const chatId = `dm_${members.join("_")}`;
  const ref = doc(db, "chats", chatId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return;
    tx.create(ref, {
      name: "Личный чат",
      desc: "",
      emoji: "✉️",
      ttl: 7 * DAY,
      isPublic: false,
      isDM: true,
      members,
      createdBy: meUid,
      createdAt: Date.now(),
      lastMessage: "",
      lastMessageAt: 0,
      lastSender: ""
    });
  });
  return chatId;
}

export async function updateChatTtl(chatId, ttl) {
  await updateDoc(doc(db, "chats", chatId), { ttl: Number(ttl) || DAY });
}

const SPAM_TERMS = [10 * 60_000, 60 * 60_000, DAY, 3 * DAY, 500 * 365.25 * DAY];

export async function sendMessage(chat, profile, text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("Сообщение пустое");
  if (value.length > 1500) throw new Error("Максимум 1500 символов");
  if (profile?.banned) throw new Error("Ваш аккаунт заблокирован");
  if (!canAccessChat(chat, profile)) {
    throw new Error("Этот чат доступен только верифицированным пользователям");
  }
  const now = Date.now();
  const ttl = Number(chat.ttl) || DAY;
  const msgRef = doc(collection(db, "chats", chat.id, "messages"));
  const chatRef = db().collection("chats").doc(chat.id);
  const userRef = db().collection("users").doc(profile.uid);
  const spamRef = userRef.collection("private").doc("spam");
  const fingerprint = createHash("sha256").update(value.toLowerCase().replace(/\s+/g, " ")).digest("hex");
  const result = await db().runTransaction(async (tx) => {
    const chatSnap = await tx.get(chatRef);
    const userSnap = await tx.get(userRef);
    const latest = chatSnap.data();
    const user = userSnap.data();
    if (!latest || !user || user.banned || (latest.isPublic
      ? latest.verifiedOnly && !user.verified && !profile.isAdmin
      : !latest.members?.includes(profile.uid))) throw new Error("Нет доступа к чату");

    if (!profile.isAdmin) {
      const spam = (await tx.get(spamRef)).data() ?? {};
      const recent = (spam.recent ?? []).filter((entry) => entry.at > now - 30_000);
      recent.push({ at: now, fingerprint });
      if (recent.filter((entry) => entry.fingerprint === fingerprint).length >= 4
          || recent.filter((entry) => entry.at > now - 10_000).length >= 8) {
        const step = Math.min(spam.strikes ?? 0, SPAM_TERMS.length - 1);
        tx.set(spamRef, { strikes: step + 1, recent: [] });
        tx.update(userRef, {
          banned: true, banType: "spam", banReason: "Обнаружен спам в чате.",
          banAt: now, banUntil: now + SPAM_TERMS[step], banYears: step === 4 ? 500 : 0,
          banImage: "./assets/ban-spam.jpg"
        });
        return null;
      }
      tx.set(spamRef, { recent }, { merge: true });
    }
    const createdAt = Math.max(now, (Number(latest.lastMessageAt) || 0) + 1);
    const expiresAt = createdAt + ttl;
    tx.create(msgRef, {
      uid: profile.uid, nick: user.nick, isAdmin: profile.isAdmin,
      text: value, createdAt, expiresAt
    });
    tx.update(chatRef, { lastMessage: value.slice(0, 140), lastMessageAt: createdAt, lastSender: profile.uid });
    tx.update(userRef, { msgCount: (Number(user.msgCount) || 0) + 1, lastSeen: now });
    return { id: msgRef.id, createdAt, expiresAt };
  });
  if (!result) throw new Error("Аккаунт временно заблокирован за спам");
  return result;
}

export async function purgeExpiredMessages(chatId, max = 40) {
  const now = Date.now();
  const snap = await getDocs(
    query(
      collection(db, "chats", chatId, "messages"),
      where("expiresAt", "<", now),
      limit(max)
    )
  );
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  return snap.size;
}

export async function ensureMarket() {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(MARKET_REF());
    if (!snap.exists()) {
      tx.set(MARKET_REF(), {
        price: 100,
        history: [{ t: Date.now(), p: 100 }],
        volume: 0,
        lastTick: 0,
        bots: true,
        liq: 12000,
        floor: 1
      });
    }
  });
}

export async function trade(uid, side, rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Введите сумму больше нуля");
  return runTransaction(db, async (tx) => {
    const marketSnap = await tx.get(MARKET_REF());
    if (!marketSnap.exists()) throw new Error("Рынок ещё не создан");
    const userRef = doc(db, "users", uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("Профиль не найден");
    const market = marketSnap.data();
    const user = userSnap.data();
    if (user.banned) throw new Error("Аккаунт заблокирован");
    const now = Date.now();
    const price = Math.max(1, Number(market.price) || 100);
    const liq = Math.max(1000, Number(market.liq) || 12000);
    let nextPrice;
    let amountChr;
    let amountCr;
    let nextCoins;
    let nextChr;
    let nextCost;

    if (side === "buy") {
      amountCr = Math.min(amount, Number(user.coins) || 0);
      if (amountCr < 1) throw new Error("Недостаточно CharCoin на балансе");
      const impact = Math.min(amountCr / liq, 0.4);
      amountChr = amountCr / (price * (1 + impact / 2));
      nextPrice = price * (1 + impact);
      nextCoins = (Number(user.coins) || 0) - amountCr;
      nextChr = (Number(user.chr) || 0) + amountChr;
      nextCost = (Number(user.chrCost) || 0) + amountCr;
    } else {
      amountChr = Math.min(amount, Number(user.chr) || 0);
      if (amountChr <= 0) throw new Error("У вас нет CharCoin (CHR) для продажи");
      amountCr = amountChr * price;
      const impact = Math.min(amountCr / liq, 0.4);
      amountCr = amountChr * price * (1 - impact / 2);
      nextPrice = price * (1 - impact);
      nextCoins = (Number(user.coins) || 0) + amountCr;
      nextChr = (Number(user.chr) || 0) - amountChr;
      const avg = Number(user.chr) > 0 ? (Number(user.chrCost) || 0) / Number(user.chr) : 0;
      nextCost = Math.max(0, (Number(user.chrCost) || 0) - avg * amountChr);
    }

    nextPrice = Math.max(Number(market.floor) || 1, nextPrice);
    const history = pushHistory(market.history, nextPrice, now);
    const tradeRef = doc(collection(db, "trades"));

    tx.update(userRef, {
      coins: Math.round(nextCoins * 100) / 100,
      chr: Math.round(nextChr * 1e6) / 1e6,
      chrCost: Math.round(nextCost * 100) / 100,
      lastTrade: now,
      lastSeen: now
    });
    tx.update(MARKET_REF(), {
      price: Math.round(nextPrice * 1000) / 1000,
      volume: Math.round(((Number(market.volume) || 0) + amountCr) * 100) / 100,
      lastTick: now,
      history
    });
    tx.set(tradeRef, {
      uid,
      nick: user.nick || "Аноним",
      isAdmin: !!user.isAdmin,
      isBot: false,
      side,
      amountCr: Math.round(amountCr * 100) / 100,
      amountChr: Math.round(amountChr * 1e6) / 1e6,
      price: Math.round(nextPrice * 1000) / 1000,
      ts: now
    });

    return {
      side,
      amountCr,
      amountChr,
      price: nextPrice,
      coins: nextCoins,
      chr: nextChr
    };
  });
}

export async function tickMarket() {
  if (tickBusy || Date.now() - lastTickAttempt < 60_000) return;
  tickBusy = true;
  lastTickAttempt = Date.now();
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(MARKET_REF());
      if (!snap.exists()) return;
      const market = snap.data();
      if (market.bots === false) return;
      const now = Date.now();
      if (now - (Number(market.lastTick) || 0) < 60_000) return;
      const price = Math.max(1, Number(market.price) || 100);
      const liq = Math.max(1000, Number(market.liq) || 12000);
      const bot = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      const side = Math.random() < 0.52 ? "buy" : "sell";
      const amountCr = 12 + Math.random() * 95;
      const impact = Math.min(amountCr / liq, 0.25);
      let nextPrice = side === "buy" ? price * (1 + impact * 0.8) : price * (1 - impact * 0.8);
      nextPrice = Math.max(Number(market.floor) || 1, nextPrice * (1 + (Math.random() - 0.5) * 0.006));
      const amountChr = amountCr / Math.max(price, 1);
      const history = pushHistory(market.history, nextPrice, now);
      const tradeRef = doc(collection(db, "trades"));
      tx.update(MARKET_REF(), {
        price: Math.round(nextPrice * 1000) / 1000,
        volume: Math.round(((Number(market.volume) || 0) + amountCr) * 100) / 100,
        lastTick: now,
        history
      });
      tx.set(tradeRef, {
        uid: `bot_${bot.toLowerCase()}`,
        nick: bot,
        isAdmin: false,
        isBot: true,
        side,
        amountCr: Math.round(amountCr * 100) / 100,
        amountChr: Math.round(amountChr * 1e6) / 1e6,
        price: Math.round(nextPrice * 1000) / 1000,
        ts: now
      });
    });
  } catch (err) {
    console.warn("market tick skipped:", err?.message || err);
  } finally {
    tickBusy = false;
  }
}

export async function banForScreenshot(uid) {
  const years = 80 + Math.floor(Math.random() * 421);
  const now = Date.now();
  const banUntil = now + Math.round(years * 365.25 * DAY);
  await updateDoc(doc(db, "users", uid), {
    banned: true,
    banType: "screenshot",
    banReason: SCREENSHOT_BAN_REASON,
    banAt: now,
    banYears: years,
    banUntil,
    banImage: BAN_IMAGE
  });
  return { years, banUntil, banAt: now };
}

export async function expireBanIfNeeded(uid) {
  return db().runTransaction(async (tx) => {
    const ref = db().collection("users").doc(uid);
    const snap = await tx.get(ref);
    const user = snap.data();
    if (!user?.banned || !(user.banUntil > 0 && user.banUntil <= Date.now())) return false;
    tx.update(ref, { banned: false, banType: "", banReason: "", banAt: 0, banYears: 0, banUntil: 0, banImage: "" });
    return true;
  });
}

export async function createPaste(profile, { title, subject, subjectUid = "", photo = "", chapters = [], published = false, minRank = 0 }) {
  const cleanTitle = String(title || "").trim().slice(0, 80);
  if (cleanTitle.length < 2) throw new Error("Название пасты слишком короткое");
  const now = Date.now();
  const ref = doc(collection(db, "pastes"));
  const data = {
    title: cleanTitle,
    subject: String(subject || "").trim().slice(0, 60),
    subjectUid: String(subjectUid || ""),
    photo: String(photo || ""),
    chapters: cleanChapters(chapters),
    minRank: profile.isAdmin
      ? clamp(Math.floor(Number(minRank) || 0), 0, MAX_RANK)
      : clamp(Math.floor(Number(minRank) || 0), 0, rankOf(profile)),
    authorUid: profile.uid,
    authorNick: profile.nick || "Аноним",
    editors: [],
    published: !!published,
    publishedAt: published ? now : 0,
    createdAt: now,
    updatedAt: now
  };
  await setDoc(ref, data);
  return ref.id;
}

export async function savePaste(pasteId, profile, { title, subject, subjectUid = "", photo = "", chapters = [], published, minRank }) {
  const cleanTitle = String(title || "").trim().slice(0, 80);
  if (cleanTitle.length < 2) throw new Error("Название пасты слишком короткое");
  const ref = doc(db, "pastes", pasteId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Паста не найдена");
  const existing = snap.data();
  const canChangeRank = profile.isAdmin || existing.authorUid === profile.uid;
  const patch = {
    title: cleanTitle,
    subject: String(subject || "").trim().slice(0, 60),
    subjectUid: String(subjectUid || ""),
    photo: String(photo || ""),
    chapters: cleanChapters(chapters),
    updatedAt: Date.now()
  };
  if (canChangeRank) {
    patch.minRank = profile.isAdmin
      ? clamp(Math.floor(Number(minRank) || 0), 0, MAX_RANK)
      : clamp(Math.floor(Number(minRank) || 0), 0, rankOf(profile));
  }
  if (canChangeRank && typeof published === "boolean") {
    patch.published = published;
    patch.publishedAt = published ? Date.now() : 0;
  }
  await updateDoc(doc(db, "pastes", pasteId), patch);
  return patch;
}

export async function setPastePublished(pasteId, published) {
  await updateDoc(doc(db, "pastes", pasteId), {
    published: !!published,
    publishedAt: published ? Date.now() : 0,
    updatedAt: Date.now()
  });
}

export async function setPasteEditors(pasteId, editors) {
  const list = Array.from(new Set((Array.isArray(editors) ? editors : []).filter(Boolean))).slice(0, 30);
  await updateDoc(doc(db, "pastes", pasteId), { editors: list, updatedAt: Date.now() });
  return list;
}

export async function deletePaste(pasteId) {
  await deleteDoc(doc(db, "pastes", pasteId));
}

export async function spinRoulette(profile, { betType, betValue = null, amount }) {
  if (!profile) throw new Error("Сначала создайте профиль");
  if (profile.banned) throw new Error("Аккаунт заблокирован");
  const bet = casinoBet(amount);
  const type = String(betType || "");
  if (!["red", "black", "number"].includes(type)) throw new Error("Выберите красное, чёрное или число");
  const number = type === "number" ? Number(betValue) : null;
  if (type === "number" && (!Number.isInteger(number) || number < 0 || number > 36)) {
    throw new Error("Выберите число от 0 до 36");
  }

  const result = randomInt(37);
  const color = rouletteColor(result);
  const win = type === "number" ? result === number : color === type;
  const multiplier = type === "number" ? 36 : 2;
  return settleChance(profile, bet, multiplier, win, {
    game: "roulette", betType: type, betValue: number, result, color
  });
}

export async function playChance(profile, { game, guess, amount }) {
  if (game !== "coin" && game !== "dice") throw new Error("Выберите игру");
  const sides = game === "coin" ? 2 : 6;
  if (!Number.isInteger(guess) || guess < 1 || guess > sides) throw new Error("Выберите результат ставки");
  const result = randomInt(1, sides + 1);
  return settleChance(profile, casinoBet(amount), game === "coin" ? 2 : 5, result === guess, { game, guess, result });
}

async function settleChance(profile, bet, multiplier, win, round) {
  const payout = win ? bet * multiplier : 0;
  const now = Date.now();
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, "users", profile.uid);
    const user = (await tx.get(userRef)).data();
    if (!user || user.banned) throw new Error("Профиль недоступен");
    const coins = Number(user.coins) || 0;
    if (coins < bet) throw new Error("Недостаточно CR для ставки");
    tx.update(userRef, { coins: Math.round((coins - bet + payout) * 100) / 100, lastSeen: now });
    tx.set(doc(collection(db, "casino")), {
      uid: profile.uid, nick: user.nick, isAdmin: profile.isAdmin,
      ...round, amount: bet, win, payout, createdAt: now
    });
  });
  return { ...round, win, payout, amount: bet, net: payout - bet, multiplier };
}

const dailyRewardDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Yekaterinburg" });

export async function claimDailyReward(uid) {
  const day = dailyRewardDate.format(new Date());
  const ref = db().collection("users").doc(uid);
  return db().runTransaction(async (tx) => {
    const account = (await tx.get(ref)).data();
    if (!account || account.banned) throw new Error("Профиль недоступен");
    if (account.lastDailyReward === day) return { reward: 0 };
    const reward = 10;
    tx.update(ref, { coins: Math.round(((Number(account.coins) || 0) + reward) * 100) / 100, lastDailyReward: day });
    return { reward };
  });
}

export async function playClicker(profile, { taps }) {
  if (!Array.isArray(taps) || taps.length < 5 || taps.length > 30 ||
      taps.some((time, index) => !Number.isInteger(time) || time < 0 || time > 10_000 || (index > 0 && time < taps[index - 1]))) {
    throw new Error("Нужно от 5 до 30 нажатий за 10 секунд");
  }
  const gaps = taps.slice(1).map((time, index) => time - taps[index]);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  // shortcut: browser timing detects a repeated pattern, not the presence of automation software.
  const suspicious = taps.length >= 14 && median < 85 &&
    gaps.filter((gap) => Math.abs(gap - median) <= 2).length >= 0.9 * gaps.length;
  const now = Date.now();
  const day = Math.floor(now / DAY);
  const ref = db().collection("users").doc(profile.uid);
  const stats = ref.collection("private").doc("clicker");
  return db().runTransaction(async (tx) => {
    const user = (await tx.get(ref)).data();
    const saved = (await tx.get(stats)).data() || {};
    if (!user || user.banned) throw new Error("Профиль недоступен");
    if (now - (saved.lastAt || 0) < 10_000) throw new Error("Между раундами нужно подождать 10 секунд");
    const earned = saved.day === day ? saved.earned : 0;
    const strikes = suspicious ? (saved.day === day ? saved.strikes : 0) + 1 : 0;
    const reward = suspicious ? 0 : Math.max(0, Math.min(60 - earned, Math.floor(taps.length / 5)));
    tx.set(stats, { day, earned: earned + reward, lastAt: now, strikes: strikes >= 3 ? 0 : strikes });
    if (strikes >= 3) {
      tx.update(ref, {
        banned: true, banType: "clicker", banReason: "Обнаружены быстрые нажатия с почти одинаковыми интервалами в трёх раундах подряд.",
        banAt: now, banUntil: now + 600_000, banYears: 0, banImage: BAN_IMAGE
      });
    } else if (reward) {
      tx.update(ref, { coins: Math.round(((Number(user.coins) || 0) + reward) * 100) / 100 });
    }
    return { reward, remaining: 60 - earned - reward, suspicious, banned: strikes >= 3 };
  });
}

export async function playUpgrade(profile, {
  stakeType,
  stakeNftId = "",
  stakeAmount = 0,
  targetType,
  targetNftId = "",
  targetAmount = 0
}) {
  if (!profile) throw new Error("Сначала создайте профиль");
  if (profile.banned) throw new Error("Аккаунт заблокирован");
  const stakeKind = String(stakeType || "");
  const targetKind = String(targetType || "");
  if (!["cr", "nft"].includes(stakeKind) || !["cr", "nft"].includes(targetKind)) {
    throw new Error("Выберите, что вы ставите и на что апгрейдите");
  }
  if (stakeKind === "nft" && !stakeNftId) throw new Error("Выберите свой NFT");
  if (targetKind === "nft" && !targetNftId) throw new Error("Выберите NFT-цель");
  if (stakeKind === "nft" && targetKind === "nft" && stakeNftId === targetNftId) {
    throw new Error("Нельзя апгрейдить NFT на него самого");
  }

  const stakeCr = stakeKind === "cr" ? casinoBet(stakeAmount) : 0;
  const targetCr = targetKind === "cr" ? Math.floor(Number(targetAmount) || 0) : 0;
  if (targetKind === "cr" && (!Number.isSafeInteger(targetCr) || targetCr < 1 || targetCr > 5_000_000)) throw new Error("Укажите сумму цели");

  const now = Date.now();
  return runTransaction(db, async (tx) => {
    const userRef = doc(db, "users", profile.uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("Профиль не найден");
    const user = userSnap.data();
    if (user.banned) throw new Error("Аккаунт заблокирован");

    const stakeNftRef = stakeKind === "nft" ? doc(db, "nfts", stakeNftId) : null;
    const stakeNftSnap = stakeNftRef ? await tx.get(stakeNftRef) : null;
    if (stakeNftRef && !stakeNftSnap.exists()) throw new Error("Ваш NFT не найден");
    const stakeNft = stakeNftSnap?.data();
    if (stakeNftRef && stakeNft.ownerUid !== profile.uid) throw new Error("Этот NFT вам не принадлежит");

    const targetNftRef = targetKind === "nft" ? doc(db, "nfts", targetNftId) : null;
    const targetNftSnap = targetNftRef ? await tx.get(targetNftRef) : null;
    if (targetNftRef && !targetNftSnap.exists()) throw new Error("NFT-цель не найден");
    const targetNft = targetNftSnap?.data();
    if (targetNftRef) {
      if (!targetNft.forSale || targetNft.price > nftResaleLimit(targetNft)) throw new Error("NFT-цель недоступна по этой цене");
      if (targetNft.ownerUid === profile.uid) throw new Error("Нельзя апгрейдить на свой NFT");
    }
    const targetOwnerRef = targetNftRef && targetNft.ownerUid ? doc(db, "users", targetNft.ownerUid) : null;
    const targetOwnerSnap = targetOwnerRef ? await tx.get(targetOwnerRef) : null;

    const adminValue = Number(stakeNft?.adminStakeCr);
    const stakeValue = stakeKind === "cr" ? stakeCr
      : profile.isAdmin && stakeNft?.createdBy === ADMIN_UID && Number.isInteger(adminValue)
        && adminValue >= 1 && adminValue <= CASINO_MAX_BET ? adminValue : 1;
    const targetValue = targetKind === "cr" ? targetCr : nftValue(targetNft);
    if (targetValue <= stakeValue) throw new Error("Цель должна быть дороже вашей ставки");
    if (stakeValue / targetValue < UPGRADE_MIN_CHANCE) throw new Error("Шанс апгрейда ниже 2%. Увеличьте ставку или выберите более дешёвую цель");
    const chance = Math.min(stakeValue / targetValue, UPGRADE_MAX_CHANCE);
    const win = randomFloat() < chance;

    let coins = Number(user.coins) || 0;
    if (stakeKind === "cr") {
      if (coins < stakeCr) throw new Error("Недостаточно CR для апгрейда");
      coins -= stakeCr;
    } else {
      tx.update(stakeNftRef, {
        ownerUid: "system_charmsg",
        ownerNick: "CharMsg",
        forSale: false,
        price: 0,
        updatedAt: now
      });
    }

    if (win) {
      if (targetKind === "cr") {
        coins += targetCr;
      } else {
        const history = Array.isArray(targetNft.history) ? [...targetNft.history] : [];
        history.push({ uid: profile.uid, nick: profile.nick || "Аноним", price: targetValue, ts: now, via: "upgrade" });
        tx.update(targetNftRef, {
          ownerUid: profile.uid,
          ownerNick: profile.nick || "Аноним",
          forSale: false,
          price: 0,
          lastPrice: targetValue,
          soldAt: now,
          updatedAt: now,
          history
        });
        if (targetOwnerRef && targetOwnerSnap?.exists()) {
          const sellerCoins = Number(targetOwnerSnap.data().coins) || 0;
          tx.update(targetOwnerRef, { coins: Math.round((sellerCoins + targetValue) * 100) / 100 });
        }
      }
    }

    if (stakeKind === "cr" || (win && targetKind === "cr")) {
      tx.update(userRef, {
        coins: Math.round(coins * 100) / 100,
        lastSeen: now
      });
    } else {
      tx.update(userRef, { lastSeen: now });
    }

    tx.set(doc(collection(db, "casino")), {
      uid: profile.uid,
      nick: profile.nick || "Аноним",
      isAdmin: !!profile.isAdmin,
      game: "upgrade",
      stakeType: stakeKind,
      stakeNftId: stakeNftId || "",
      stakeNftName: stakeNft?.name || "",
      stakeValue,
      targetType: targetKind,
      targetNftId: targetNftId || "",
      targetNftName: targetNft?.name || "",
      targetValue,
      chance,
      win,
      createdAt: now
    });

    return {
      win,
      chance,
      stakeValue,
      targetValue,
      stakeType: stakeKind,
      targetType: targetKind,
      targetNftName: targetNft?.name || "",
      stakeNftName: stakeNft?.name || ""
    };
  });
}

export async function createNft(profile, { name, description = "", image = "", effect = "none", price = 0, adminStakeCr = 1, number = null }) {
  if (!canCreateNft(profile)) {
    throw new Error(`Создавать NFT можно с ранга «Элита» (${NFT_MIN_RANK + 1}-й уровень) или админу`);
  }
  const cleanName = String(name || "").trim().slice(0, 60);
  if (cleanName.length < 2) throw new Error("Название NFT слишком короткое");
  if (!String(image || "").trim()) throw new Error("Добавьте картинку NFT");
  const now = Date.now();
  const ref = doc(collection(db, "nfts"));
  const value = clamp(Number(price) || 0, 0, 1_000_000_000);
  if (profile.isAdmin && (!Number.isInteger(adminStakeCr) || adminStakeCr < 1 || adminStakeCr > CASINO_MAX_BET)) {
    throw new Error("Оценка NFT должна быть целым числом от 1 до 100 000 CR");
  }
  if (number !== null && (!Number.isInteger(number) || number < 1 || number > 999_999_999)) {
    throw new Error("Номер NFT должен быть целым числом от 1 до 999 999 999");
  }
  const data = {
    ...(number === null ? {} : { number }),
    ...(profile.isAdmin ? { adminStakeCr } : {}),
    name: cleanName,
    description: String(description || "").slice(0, 500),
    image: String(image || ""),
    effect: NFT_EFFECTS.some((e) => e.key === effect) ? effect : "none",
    ownerUid: profile.uid,
    ownerNick: profile.nick || "Аноним",
    createdBy: profile.uid,
    createdByNick: profile.nick || "Аноним",
    forSale: value > 0,
    price: value,
    createdAt: now,
    updatedAt: now,
    soldAt: 0,
    lastPrice: 0,
    history: []
  };
  if (number === null) {
    await setDoc(ref, data);
  } else {
    await db().runTransaction(async (tx) => {
      const reservation = db().collection("nftNumbers").doc(String(number));
      if ((await tx.get(reservation)).exists) throw new Error("Этот номер NFT уже занят");
      tx.create(reservation, { nftId: ref.id });
      tx.create(ref, data);
    });
  }
  return ref.id;
}

export function nftResaleLimit(nft) {
  const paid = Number(nft?.lastPrice);
  return Number.isFinite(paid) && paid > 0 ? Math.min(1_000_000_000, Math.round(paid * 300) / 100) : 1_000_000_000;
}

export async function setNftSale(nftId, profile, price) {
  const value = clamp(Number(price) || 0, 0, 1_000_000_000);
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "nfts", nftId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("NFT не найден");
    const nft = snap.data();
    if (nft.ownerUid !== profile.uid && !profile.isAdmin) throw new Error("Это не ваш NFT");
    const cap = nftResaleLimit(nft);
    if (value > cap) throw new Error(`Максимальная цена перепродажи — ${cap} CR (3× от покупки)`);
    tx.update(ref, {
      forSale: value > 0,
      price: value,
      updatedAt: Date.now()
    });
    return { forSale: value > 0, price: value };
  });
}

export async function buyNft(nftId, profile) {
  return runTransaction(db, async (tx) => {
    const nftRef = doc(db, "nfts", nftId);
    const buyerRef = doc(db, "users", profile.uid);
    const nftSnap = await tx.get(nftRef);
    if (!nftSnap.exists()) throw new Error("NFT не найден");
    const nft = nftSnap.data();
    if (!nft.forSale) throw new Error("NFT не выставлен на продажу");
    if (nft.ownerUid === profile.uid) throw new Error("Это уже ваш NFT");
    const price = Math.max(0, Number(nft.price) || 0);
    if (price <= 0) throw new Error("У NFT не указана цена");
    if (price > nftResaleLimit(nft)) throw new Error("Владелец должен снизить цену NFT до лимита перепродажи");
    const buyerSnap = await tx.get(buyerRef);
    if (!buyerSnap.exists()) throw new Error("Профиль покупателя не найден");
    const buyer = buyerSnap.data();
    if (buyer.banned) throw new Error("Ваш аккаунт заблокирован");
    if ((Number(buyer.coins) || 0) < price) throw new Error("Недостаточно CR для покупки");
    const sellerRef = nft.ownerUid ? doc(db, "users", nft.ownerUid) : null;
    const sellerSnap = sellerRef ? await tx.get(sellerRef) : null;
    const now = Date.now();
    const history = Array.isArray(nft.history) ? [...nft.history] : [];
    history.push({ uid: profile.uid, nick: profile.nick || "Аноним", price, ts: now });

    tx.update(buyerRef, {
      coins: Math.round(((Number(buyer.coins) || 0) - price) * 100) / 100,
      lastSeen: now
    });
    if (sellerRef && sellerSnap?.exists()) {
      tx.update(sellerRef, {
        coins: Math.round(((Number(sellerSnap.data().coins) || 0) + price) * 100) / 100
      });
    }
    tx.update(nftRef, {
      ownerUid: profile.uid,
      ownerNick: profile.nick || "Аноним",
      forSale: false,
      price: 0,
      lastPrice: price,
      soldAt: now,
      updatedAt: now,
      history
    });
    tx.set(doc(collection(db, "trades")), {
      uid: profile.uid,
      nick: profile.nick || "Аноним",
      isAdmin: !!profile.isAdmin,
      isBot: false,
      isNft: true,
      nftId,
      nftName: nft.name || "NFT",
      side: "buy",
      amountCr: price,
      amountChr: 0,
      price,
      ts: now
    });
    return { price, name: nft.name, sellerUid: nft.ownerUid };
  });
}

export async function deleteNft(nftId, profile) {
  const ref = doc(db, "nfts", nftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const nft = snap.data();
  if (nft.ownerUid !== profile.uid && !profile.isAdmin) throw new Error("Удалять NFT может только владелец или админ");
  await deleteDoc(ref);
}

export async function giftNft(nftId, senderUid, recipientNick) {
  const nick = typeof recipientNick === "string" ? recipientNick.trim().toLowerCase() : "";
  if (nick.length < 2 || nick.length > 18) throw new Error("Укажите ник получателя");
  const fee = 1;
  return db().runTransaction(async (tx) => {
    const users = db().collection("users");
    const nftRef = db().collection("nfts").doc(nftId);
    const senderRef = users.doc(senderUid);
    const [nftSnap, senderSnap, recipients] = await Promise.all([
      tx.get(nftRef),
      tx.get(senderRef),
      tx.get(users.where("nickLower", "==", nick).limit(2))
    ]);
    const nft = nftSnap.data();
    const sender = senderSnap.data();
    if (!nft || nft.ownerUid !== senderUid) throw new Error("Передать NFT может только его владелец");
    if (!sender || sender.banned) throw new Error("Профиль недоступен");
    if (recipients.size !== 1) throw new Error("Не удалось найти получателя по этому нику");
    const [recipientSnap] = recipients.docs;
    const recipient = recipientSnap.data();
    if (recipientSnap.id === senderUid) throw new Error("Нельзя подарить NFT себе");
    if (recipient.banned || recipientSnap.id === "system_charmsg") throw new Error("Получатель недоступен");
    const coins = Number(sender.coins) || 0;
    if (coins < fee) throw new Error("Для передачи нужен 1 CR на балансе");
    const now = Date.now();
    const history = Array.isArray(nft.history) ? nft.history.slice(-99) : [];
    history.push({ uid: recipientSnap.id, nick: recipient.nick, price: 0, fee, ts: now, via: "gift" });
    tx.update(senderRef, {
      coins: Math.round((coins - fee) * 100) / 100,
      ...(sender.featuredNftId === nftId ? { featuredNftId: null } : {})
    });
    tx.update(nftRef, {
      ownerUid: recipientSnap.id, ownerNick: recipient.nick,
      forSale: false, price: 0, updatedAt: now, history
    });
    return { fee, recipientNick: recipient.nick };
  });
}
