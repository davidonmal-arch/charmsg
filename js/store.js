import { clearQuota, reportQuota } from "./quota.js";
import { auth, adminAuth, EmailAuthProvider, linkWithCredential, signInAnonymously, signInWithEmailAndPassword, signOut, runAction } from "./db.js";
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
  runTransaction,
  getCountFromServer
} from "./db.js";
import {
  MAX_RANK,
  NFT_MIN_RANK,
  clamp,
  rankOf
} from "./util.js";

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

export function effectClass(key) {
  return NFT_EFFECTS.find((e) => e.key === key)?.css || "";
}

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

// ---------------- identity ----------------
let adminSession = false;

export function getAdminSession() {
  return adminSession;
}

export function currentUid() {
  return auth.currentUser?.uid;
}

export async function verifyAdminSession() {
  await auth.authStateReady();
  if (auth === adminAuth) {
    const token = await auth.currentUser?.getIdTokenResult();
    if (token?.claims.admin === true && auth.currentUser.uid === ADMIN_UID) {
      adminSession = true;
      return true;
    }
    localStorage.removeItem("charmsg_admin_mode");
    location.reload();
    throw new Error("Сессия администратора завершена");
  }
  if (!auth.currentUser) await signInAnonymously(auth);
  return false;
}

const PLAYER_LOGIN_DOMAIN = "@players.charmsg.invalid";

function playerEmail(login) {
  const value = login.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,24}$/.test(value)) {
    throw new Error("Логин должен содержать 3–24 латинские буквы, цифры, дефисы или подчёркивания");
  }
  return value + PLAYER_LOGIN_DOMAIN;
}

export function linkedPlayerLogin() {
  const email = auth.currentUser?.email;
  return email?.endsWith(PLAYER_LOGIN_DOMAIN) ? email.slice(0, -PLAYER_LOGIN_DOMAIN.length) : "";
}

export async function savePlayerLogin(login, password) {
  const email = playerEmail(login);
  if (password.length < 12) throw new Error("Пароль должен содержать не менее 12 символов");
  const user = auth.currentUser;
  if (auth === adminAuth || !user?.isAnonymous) throw new Error("Для этого профиля пароль уже задан");
  try {
    await linkWithCredential(user, EmailAuthProvider.credential(email, password));
  } catch (error) {
    if (error.code === "auth/email-already-in-use" || error.code === "auth/credential-already-in-use") {
      throw new Error("Логин занят. Выберите другой");
    }
    throw new Error("Не удалось сохранить логин и пароль. Проверьте подключение и попробуйте снова");
  }
}

export async function signInPlayer(login, password) {
  const email = playerEmail(login);
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (error.code === "auth/network-request-failed") throw new Error("Не удалось подключиться. Попробуйте снова");
    if (error.code === "auth/too-many-requests") throw new Error("Слишком много попыток. Попробуйте позже");
    throw new Error("Неверный логин или пароль");
  }
}

export async function signOutPlayer() {
  await signOut(auth);
}

export async function adminLogin(login, password) {
  if (String(login).trim().toLowerCase() !== ADMIN_LOGIN) throw new Error("Неверный логин или пароль");
  const { user } = await signInWithEmailAndPassword(adminAuth, "farnaz@charmsg.invalid", password);
  const token = await user.getIdTokenResult(true);
  if (user.uid !== ADMIN_UID || token.claims.admin !== true) {
    await signOut(adminAuth);
    throw new Error("У аккаунта нет прав администратора");
  }
  localStorage.setItem("charmsg_admin_mode", "1");
}

export async function adminLogout() {
  await signOut(adminAuth);
  localStorage.removeItem("charmsg_admin_mode");
}

export function ensureAdminProfile() {
  return runAction("ensureAdminProfile");
}

function subscribeAction(load, cb, onError, interval, allowed) {
  let active = true;
  let timer;
  let previous;
  let failures = 0;
  let running = false;
  async function refresh() {
    if (!active || running) return;
    clearTimeout(timer);
    running = true;
    try {
      if (document.visibilityState === "hidden" || (allowed && !allowed())) return;
      const value = await load();
      failures = 0;
      if (!active) return;
      const snapshot = JSON.stringify(value);
      if (snapshot !== previous) {
        previous = snapshot;
        cb(value);
      }
    } catch (error) {
      if (active) {
        failures += 1;
        if (error.code === "functions/permission-denied" && previous !== undefined) {
          cb([]);
          previous = undefined;
        }
        if (failures === 1) onError?.(error);
      }
    } finally {
      running = false;
      if (active) timer = setTimeout(refresh, failures ? Math.min(120_000, interval * (2 ** Math.min(failures, 5))) : interval);
    }
  }
  const wake = () => {
    if (!failures && document.visibilityState !== "hidden" && (!allowed || allowed())) refresh();
  };
  document.addEventListener("visibilitychange", wake);
  if (allowed) window.addEventListener("hashchange", wake);
  refresh();
  return () => {
    active = false;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
    if (allowed) window.removeEventListener("hashchange", wake);
  };
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

export async function createProfile(uid, data) {
  return runAction("createProfile", data);
}

export async function updateProfile(uid, data) {
  return runAction("updateProfile", data);
}

export async function findUserByNick(nick) {
  const nickLower = String(nick || "").trim().toLowerCase();
  if (!nickLower) return null;
  const snap = await getDocs(query(collection(db, "users"), where("nickLower", "==", nickLower), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function fetchUser(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeProfile(uid, cb, onError) {
  let profile;
  let seen;
  const emit = () => {
    if (profile !== undefined) cb(profile ? { ...profile, seen: seen || {} } : null);
  };
  const unsubscribeProfile = onSnapshot(doc(db, "users", uid), (snap) => {
    if (!snap.metadata.fromCache) clearQuota();
    profile = snap.exists() ? { ...snap.data(), id: snap.id } : null;
    emit();
  }, (error) => { reportQuota(error); onError?.(error); });
  const unsubscribeSeen = onSnapshot(doc(db, "users", uid, "preferences", "seen"), (snap) => {
    seen = snap.data()?.chats;
    emit();
  }, () => {});
  return () => { unsubscribeProfile(); unsubscribeSeen(); };
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
  return subscribeAction(() => runAction("listChats"), cb, onError, 25_000);
}

export async function createPublicChat(data) {
  return runAction("createPublicChat", data);
}

export async function openDM(meUid, otherUid) {
  return runAction("openDM", otherUid);
}

export async function updateChatTtl(chatId, ttl) {
  return runAction("updateChatTtl", chatId, ttl);
}

export async function deleteChat(chatId) {
  return runAction("deleteChat", chatId);
}

export function subscribeMessages(chatId, cb, onError) {
  let messages = [];
  let lastFullRead = 0;
  let newest = 0;
  return subscribeAction(async () => {
    const now = Date.now();
    const full = now - lastFullRead >= 300_000;
    const incoming = await runAction("listMessages", chatId, full ? null : Math.max(0, newest - 5000));
    const merged = new Map((full ? [] : messages).map((message) => [message.id, message]));
    for (const message of incoming) merged.set(message.id, message);
    messages = [...merged.values()].filter((message) => message.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt).slice(-50);
    if (full) lastFullRead = now;
    if (incoming.length) newest = Math.max(newest, incoming.at(-1).createdAt);
    return messages;
  }, cb, onError, 8000);
}

export async function sendMessage(chat, profile, text) {
  return runAction("sendMessage", chat.id, text);
}

export async function deleteMessage(chatId, messageId) {
  return runAction("deleteMessage", chatId, messageId);
}

export async function purgeExpiredMessages(chatId, max = 40) {
  return runAction("purgeExpiredMessages", chatId, max);
}

export async function markSeen(uid, chatId) {
  try {
    await setDoc(doc(db, "users", uid, "preferences", "seen"), { chats: { [chatId]: Date.now() } }, { merge: true });
  } catch {
    /* non critical */
  }
}

// ---------------- market ----------------
const MARKET_REF = () => doc(db, "market", "state");
export const BOT_NAMES = ["Nova", "Kryptos", "Pixel", "Void", "Astra", "Neon", "Orion", "Lumen", "Echo", "Nyx"];

export async function ensureMarket() {
  return runAction("ensureMarket");
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

export async function trade(uid, side, amount) {
  return runAction("trade", side, amount);
}

export async function tickMarket() {
  return runAction("tickMarket");
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

export function checkAccess() {
  return runAction("checkAccess");
}

export function adminUnbanUser(uid) {
  return runAction("adminUnbanUser", uid);
}

export function adminSetPlayerPassword(uid, options) {
  return runAction("adminSetPlayerPassword", uid, options);
}

export async function adminBanUser(uid, options) {
  return runAction("adminBanUser", uid, options);
}

export async function adminSetRank(uid, rank) {
  await updateDoc(doc(db, "users", uid), { rank: clamp(Math.floor(Number(rank) || 0), 0, MAX_RANK) });
}

export async function adminSetVerified(uid, verified) {
  await updateDoc(doc(db, "users", uid), { verified: !!verified });
}

export async function banForScreenshot(uid) {
  return runAction("banForScreenshot");
}

export async function expireBanIfNeeded(uid, profile) {
  return runAction("expireBanIfNeeded");
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
  return runAction("adminBroadcast", text);
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

// ---------------- pastes ----------------
export function subscribePastes(cb, onError, allowed) {
  return subscribeAction(() => runAction("listPastes"), cb, onError, 45_000, allowed);
}

export function canEditPaste(paste, profile) {
  if (!paste || !profile) return false;
  if (profile.isAdmin) return true;
  if (paste.authorUid === profile.uid) return true;
  return (Array.isArray(paste.editors) ? paste.editors : []).includes(profile.uid);
}

export function pasteMinRank(paste) {
  return clamp(Number(paste?.minRank) || 0, 0, MAX_RANK);
}

export function canViewPaste(paste, profile) {
  if (!paste) return false;
  if (profile?.isAdmin) return true;
  if (canEditPaste(paste, profile)) return true;
  return rankOf(profile) >= pasteMinRank(paste);
}

export async function createPaste(profile, data) {
  return runAction("createPaste", data);
}

export async function savePaste(pasteId, profile, data) {
  return runAction("savePaste", pasteId, data);
}

export async function setPastePublished(pasteId, published) {
  return runAction("setPastePublished", pasteId, published);
}

export async function setPasteEditors(pasteId, editors) {
  return runAction("setPasteEditors", pasteId, editors);
}

export async function deletePaste(pasteId) {
  return runAction("deletePaste", pasteId);
}

// ---------------- nft ----------------
export function setFeaturedNft(id) {
  return runAction("setFeaturedNft", id);
}

export function subscribeNft(id, cb) {
  return onSnapshot(doc(db, "nfts", id), (snap) => cb(snap.exists() ? { ...snap.data(), id: snap.id } : null), () => cb(null));
}

export function nftTitle(nft) {
  return [nft.name || "NFT", Number.isInteger(nft.number) && nft.number > 0 ? "#" + nft.number : ""].filter(Boolean).join(" ");
}

export function subscribeNfts(cb, onError) {
  return onSnapshot(
    query(collection(db, "nfts"), orderBy("createdAt", "desc"), limit(200)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// ---------------- casino ----------------
export function subscribeCasino(cb, onError) {
  return onSnapshot(
    query(collection(db, "casino"), orderBy("createdAt", "desc"), limit(50)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export async function spinRoulette(profile, data) {
  return runAction("spinRoulette", data);
}

export async function playUpgrade(profile, data) {
  return runAction("playUpgrade", data);
}

export function releaseNfts(data) {
  return runAction("releaseNfts", data);
}

export function enhanceNft(id) {
  return runAction("enhanceNft", id);
}

export function playChance(data) {
  return runAction("playChance", data);
}

export function playClicker(taps) {
  return runAction("playClicker", { taps });
}

export async function createNft(profile, data) {
  return runAction("createNft", data);
}

export function nftResaleLimit(nft) {
  const paid = Number(nft?.lastPrice);
  return Number.isFinite(paid) && paid > 0 ? Math.min(1_000_000_000, Math.round(paid * 300) / 100) : 1_000_000_000;
}

export async function setNftSale(nftId, profile, price) {
  return runAction("setNftSale", nftId, price);
}

export function giftNft(nftId, recipientNick) {
  return runAction("giftNft", nftId, recipientNick);
}

export async function buyNft(nftId, profile) {
  return runAction("buyNft", nftId);
}

export async function deleteNft(nftId, profile) {
  return runAction("deleteNft", nftId);
}
