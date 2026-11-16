import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  runTransaction,
  getCountFromServer
} from "./db.js";
import { randomId, sha256Hex, loadJSON, saveJSON } from "./util.js";

export const DAY = 86_400_000;
export const ADMIN_UID = "admin_farnaz";
export const ADMIN_LOGIN = "farnaz";
const ADMIN_SESSION_KEY = "charmsg_admin_session";
const UID_KEY = "charmsg_device_uid";

export const RESERVED_NICKS = ["farnaz", "admin", "charmsg", "system", "support", "админ", "модератор"];

// ---------------- identity ----------------
function loadDeviceUid() {
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) {
    uid = randomId("u");
    localStorage.setItem(UID_KEY, uid);
  }
  return uid;
}

export const deviceUid = loadDeviceUid();

export function getAdminSession() {
  const session = loadJSON(ADMIN_SESSION_KEY, null);
  if (!session || !session.hash || !session.exp || session.exp < Date.now()) return null;
  return session;
}

export function isAdminSession() {
  return !!getAdminSession();
}

export function currentUid() {
  return isAdminSession() ? ADMIN_UID : deviceUid;
}

export async function verifyAdminSession() {
  const session = getAdminSession();
  if (!session) return false;
  try {
    const snap = await getDoc(doc(db, "config", "admin"));
    if (!snap.exists() || snap.data().hash !== session.hash) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function adminLogin(login, password) {
  const cleanLogin = String(login || "").trim().toLowerCase();
  const snap = await getDoc(doc(db, "config", "admin"));
  if (!snap.exists()) throw new Error("Конфигурация админа не найдена в Firestore");
  const cfg = snap.data();
  if (cleanLogin !== String(cfg.login || "").toLowerCase()) throw new Error("Неверный логин или пароль");
  const hash = await sha256Hex(`${cfg.salt || "charmsg"}::${cleanLogin}::${password}`);
  if (hash !== cfg.hash) throw new Error("Неверный логин или пароль");
  const session = { hash, exp: Date.now() + 12 * 3600 * 1000 };
  saveJSON(ADMIN_SESSION_KEY, session);
  await ensureAdminProfile();
  return session;
}

export function adminLogout() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export async function ensureAdminProfile() {
  const ref = doc(db, "users", ADMIN_UID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: ADMIN_UID,
      nick: "farnaz",
      nickLower: "farnaz",
      bio: "Создатель CharMsg. Анонимность — это свобода.",
      avatar: "./assets/logo.jpg",
      isAdmin: true,
      coins: 100,
      chr: 0,
      chrCost: 0,
      banned: false,
      msgCount: 0,
      createdAt: Date.now(),
      lastSeen: Date.now()
    });
  } else {
    await setDoc(ref, { isAdmin: true, nick: "farnaz", nickLower: "farnaz", banned: false }, { merge: true });
  }
}

// ---------------- profiles ----------------
export function validateNick(nick) {
  const value = String(nick || "").trim();
  if (value.length < 2) return "Ник должен быть не короче 2 символов";
  if (value.length > 18) return "Ник должен быть не длиннее 18 символов";
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(value)) return "Можно использовать буквы, цифры, пробел, _ и -";
  if (RESERVED_NICKS.includes(value.toLowerCase())) return "Этот ник зарезервирован";
  return "";
}

export async function isNickTaken(nick, exceptUid = "") {
  const nickLower = String(nick || "").trim().toLowerCase();
  if (!nickLower) return false;
  const snap = await getDocs(query(collection(db, "users"), where("nickLower", "==", nickLower), limit(3)));
  return snap.docs.some((d) => d.id !== exceptUid);
}

export async function createProfile(uid, { nick, bio = "", avatar = "" }) {
  const error = validateNick(nick);
  if (error) throw new Error(error);
  if (await isNickTaken(nick, uid)) throw new Error("Этот ник уже занят");
  const cleanNick = String(nick).trim();
  const data = {
    uid,
    nick: cleanNick,
    nickLower: cleanNick.toLowerCase(),
    bio: String(bio || "").slice(0, 240),
    avatar: String(avatar || ""),
    isAdmin: uid === ADMIN_UID,
    coins: 100,
    chr: 0,
    chrCost: 0,
    banned: false,
    msgCount: 0,
    seen: {},
    createdAt: Date.now(),
    lastSeen: Date.now()
  };
  await setDoc(doc(db, "users", uid), data);
  return data;
}

export async function updateProfile(uid, { nick, bio, avatar }) {
  const error = validateNick(nick);
  if (error) throw new Error(error);
  if (await isNickTaken(nick, uid)) throw new Error("Этот ник уже занят");
  const cleanNick = String(nick).trim();
  const patch = {
    nick: cleanNick,
    nickLower: cleanNick.toLowerCase(),
    bio: String(bio || "").slice(0, 240),
    avatar: String(avatar || ""),
    lastSeen: Date.now()
  };
  await updateDoc(doc(db, "users", uid), patch);
  return patch;
}

export async function fetchUser(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeProfile(uid, cb, onError) {
  return onSnapshot(
    doc(db, "users", uid),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError
  );
}

export function subscribeUsers(cb, onError, max = 400) {
  return onSnapshot(
    query(collection(db, "users"), limit(max)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// ---------------- chats ----------------
export function subscribeChats(uid, cb, onError) {
  let publicChats = [];
  let memberChats = [];
  const emit = () => {
    const map = new Map();
    for (const chat of [...publicChats, ...memberChats]) map.set(chat.id, chat);
    const all = [...map.values()].sort(
      (a, b) => (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0)
    );
    cb(all);
  };
  const unsubPublic = onSnapshot(
    query(collection(db, "chats"), where("isPublic", "==", true)),
    (snap) => {
      publicChats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    },
    onError
  );
  const unsubDm = onSnapshot(
    query(collection(db, "chats"), where("members", "array-contains", uid)),
    (snap) => {
      memberChats = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => !c.isPublic);
      emit();
    },
    onError
  );
  return () => {
    unsubPublic();
    unsubDm();
  };
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
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
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
  }
  return chatId;
}

export async function updateChatTtl(chatId, ttl) {
  await updateDoc(doc(db, "chats", chatId), { ttl: Number(ttl) || DAY });
}

export async function deleteChat(chatId) {
  const msgs = await getDocs(query(collection(db, "chats", chatId, "messages"), limit(300)));
  await Promise.all(msgs.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "chats", chatId));
}

export function subscribeMessages(chatId, cb, onError) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("createdAt", "asc"),
    limitToLast(300)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export async function sendMessage(chat, profile, text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("Сообщение пустое");
  if (value.length > 1500) throw new Error("Максимум 1500 символов");
  if (profile?.banned) throw new Error("Ваш аккаунт заблокирован");
  const now = Date.now();
  const ttl = Number(chat.ttl) || DAY;
  const msgRef = doc(collection(db, "chats", chat.id, "messages"));
  const batch = [];
  batch.push(
    setDoc(msgRef, {
      uid: profile.uid,
      nick: profile.nick,
      isAdmin: !!profile.isAdmin,
      text: value,
      createdAt: now,
      expiresAt: now + ttl
    })
  );
  batch.push(
    updateDoc(doc(db, "chats", chat.id), {
      lastMessage: value.slice(0, 140),
      lastMessageAt: now,
      lastSender: profile.uid
    })
  );
  batch.push(
    updateDoc(doc(db, "users", profile.uid), {
      msgCount: (Number(profile.msgCount) || 0) + 1,
      lastSeen: now
    }).catch(() => {})
  );
  await Promise.all(batch);
  return { id: msgRef.id, createdAt: now, expiresAt: now + ttl };
}

export async function deleteMessage(chatId, messageId) {
  await deleteDoc(doc(db, "chats", chatId, "messages", messageId));
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

export async function markSeen(uid, chatId) {
  try {
    await setDoc(doc(db, "users", uid), { seen: { [chatId]: Date.now() } }, { merge: true });
  } catch {
    /* non critical */
  }
}

// ---------------- market ----------------
const MARKET_REF = () => doc(db, "market", "state");
export const BOT_NAMES = ["Nova", "Kryptos", "Pixel", "Void", "Astra", "Neon", "Orion", "Lumen", "Echo", "Nyx"];

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

export function subscribeMarket(cb, onError) {
  return onSnapshot(MARKET_REF(), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

export function subscribeTrades(cb, onError) {
  return onSnapshot(
    query(collection(db, "trades"), orderBy("ts", "desc"), limit(35)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

function pushHistory(history, price, now) {
  const list = Array.isArray(history) ? [...history] : [];
  const last = list[list.length - 1];
  if (last && now - last.t < 3500) list[list.length - 1] = { t: now, p: price };
  else list.push({ t: now, p: price });
  return list.slice(-90);
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

let tickBusy = false;
export async function tickMarket() {
  if (tickBusy) return;
  tickBusy = true;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(MARKET_REF());
      if (!snap.exists()) return;
      const market = snap.data();
      if (market.bots === false) return;
      const now = Date.now();
      if (now - (Number(market.lastTick) || 0) < 9000) return;
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

// ---------------- admin ----------------
export async function adminSetPrice(price) {
  const value = Math.max(1, Number(price) || 0);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(MARKET_REF());
    const market = snap.data() || {};
    tx.set(
      MARKET_REF(),
      {
        ...market,
        price: value,
        lastTick: Date.now(),
        history: pushHistory(market.history, value, Date.now())
      },
      { merge: true }
    );
  });
}

export async function adminSetLiquidity(liq) {
  const value = Math.max(1000, Number(liq) || 12000);
  await setDoc(MARKET_REF(), { liq: value }, { merge: true });
}

export async function adminSetBots(enabled) {
  await setDoc(MARKET_REF(), { bots: !!enabled, lastTick: 0 }, { merge: true });
}

export async function adminResetMarket() {
  await setDoc(MARKET_REF(), {
    price: 100,
    history: [{ t: Date.now(), p: 100 }],
    volume: 0,
    lastTick: 0,
    bots: true,
    liq: 12000,
    floor: 1
  });
}

export async function adminGrantCoins(uid, amount) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) throw new Error("Пользователь не найден");
  const current = Number(snap.data().coins) || 0;
  await updateDoc(userRef, { coins: Math.max(0, Math.round((current + Number(amount)) * 100) / 100) });
}

export async function adminSetBanned(uid, banned) {
  await updateDoc(doc(db, "users", uid), { banned: !!banned });
}

export async function adminDeleteUser(uid) {
  await deleteDoc(doc(db, "users", uid));
}

export async function adminListUsers(max = 200) {
  const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function adminStats(chats) {
  const [users, trades] = await Promise.all([
    getCountFromServer(collection(db, "users")),
    getCountFromServer(collection(db, "trades"))
  ]);
  let messages = 0;
  const publicChats = chats.filter((c) => c.isPublic).slice(0, 25);
  const counts = await Promise.all(
    publicChats.map((c) =>
      getCountFromServer(collection(db, "chats", c.id, "messages")).then((s) => s.data().count).catch(() => 0)
    )
  );
  messages = counts.reduce((a, b) => a + b, 0);
  return {
    users: users.data().count,
    trades: trades.data().count,
    messages,
    chats: chats.length
  };
}

export async function adminBroadcast(chats, profile, text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("Текст рассылки пуст");
  const publicChats = chats.filter((c) => c.isPublic);
  await Promise.all(
    publicChats.map((chat) => {
      const now = Date.now();
      const ttl = Number(chat.ttl) || DAY;
      const msgRef = doc(collection(db, "chats", chat.id, "messages"));
      return Promise.all([
        setDoc(msgRef, {
          uid: profile.uid,
          nick: profile.nick,
          isAdmin: true,
          text: value,
          createdAt: now,
          expiresAt: now + ttl
        }),
        updateDoc(doc(db, "chats", chat.id), {
          lastMessage: value.slice(0, 140),
          lastMessageAt: now,
          lastSender: profile.uid
        })
      ]);
    })
  );
  return publicChats.length;
}

export async function adminPurgeExpired(chats) {
  let total = 0;
  for (const chat of chats) {
    total += await purgeExpiredMessages(chat.id, 80);
  }
  return total;
}

export async function adminPurgeChat(chatId, max = 200) {
  const snap = await getDocs(query(collection(db, "chats", chatId, "messages"), limit(max)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  return snap.size;
}
