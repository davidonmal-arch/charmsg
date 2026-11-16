// ---------- DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safeUrl(url = "") {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^(https?:\/\/|\.\/|\/|data:image\/)/i.test(value)) return value;
  return "";
}

// ---------- identity ----------
export function randomId(prefix = "u") {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- formatting ----------
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `вчера, ${hm}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hm}`;
}

export function fmtDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Сегодня";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtRelative(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 45_000) return "только что";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return "вчера";
  if (days < 30) return `${days} дн назад`;
  return fmtTime(ts).split(",")[0];
}

export function fmtDuration(ms) {
  if (ms <= 0) return "истёк";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 2) return `${days} дн ${hours} ч`;
  if (days === 1) return `1 дн ${hours} ч`;
  if (hours >= 1) return `${hours} ч ${minutes} мин`;
  return `${Math.max(1, minutes)} мин`;
}

export function ttlLabel(ttl) {
  const day = 86_400_000;
  if (ttl >= 30 * day) return "через месяц";
  if (ttl >= 7 * day) return "через неделю";
  if (ttl >= 2 * day) return "через 2 дня";
  return "через день";
}

export function ttlShort(ttl) {
  const day = 86_400_000;
  if (ttl >= 30 * day) return "30 дней";
  if (ttl >= 7 * day) return "7 дней";
  if (ttl >= 2 * day) return "2 дня";
  return "1 день";
}

export function fmtNum(n, digits = 0) {
  const value = Number(n) || 0;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function fmtMoney(n) {
  const value = Number(n) || 0;
  if (Math.abs(value) >= 1000) return fmtNum(value);
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export function fmtPct(n) {
  const v = Number(n) || 0;
  const text = v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v > 0 ? "+" : ""}${text}%`;
}

// ---------- avatars ----------
const GRADIENTS = [
  ["#4C2365", "#C4A4DA"],
  ["#2b0f3d", "#9E7EB5"],
  ["#5b2d78", "#7F5D99"],
  ["#3a1a4f", "#d9c2ec"],
  ["#6b3f85", "#C4A4DA"],
  ["#1c0d27", "#9E7EB5"]
];

export function hashString(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarData(nick = "", avatar = "", size = "") {
  const url = safeUrl(avatar);
  const label = (nick || "?").trim().slice(0, 2).toUpperCase() || "?";
  const g = GRADIENTS[hashString(nick || "?") % GRADIENTS.length];
  const sizeAttr = size ? ` style="--av-size:${size}px"` : "";
  if (url) {
    return `<span class="avatar"${sizeAttr}><img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.style.display='none'"></span>`;
  }
  return `<span class="avatar avatar-initials"${sizeAttr} style="background:linear-gradient(135deg,${g[0]},${g[1]})">${escapeHtml(label)}</span>`;
}

export function nickHtml(nick = "", isAdmin = false, extraClass = "") {
  const cls = `nick ${isAdmin ? "nick-admin" : ""} ${extraClass}`.trim();
  return `<span class="${cls}">${escapeHtml(nick || "Аноним")}</span>`;
}

// ---------- toasts ----------
export function toast(message, type = "info", timeout = 3600) {
  const root = document.getElementById("toastRoot");
  if (!root) return;
  const node = el("div", { class: `toast toast-${type}`, html: `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>` });
  root.append(node);
  requestAnimationFrame(() => node.classList.add("show"));
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 260);
  }, timeout);
}

// ---------- misc ----------
export function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function isMobile() {
  return window.matchMedia("(max-width: 860px)").matches;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function plural(n, one, few, many) {
  const value = Math.abs(Number(n) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function scrollToBottom(node, smooth = false) {
  if (!node) return;
  node.scrollTo({ top: node.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

export function loadJSON(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
