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

export function randomInt(max) {
  const limit = Math.max(1, Math.floor(max));
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return bytes[0] % limit;
}

export function randomFloat() {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return bytes[0] / 4294967296;
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

export function fmtDateLong(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

export function fmtDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ---------- ranks ----------
export const RANKS = [
  { level: 0, name: "Новичок", numeral: "I", color: "#9E7EB5", hint: "Стартовый ранг" },
  { level: 1, name: "Житель", numeral: "II", color: "#C4A4DA", hint: "Активный участник" },
  { level: 2, name: "Ветеран", numeral: "III", color: "#b98ee0", hint: "Проверенный временем" },
  { level: 3, name: "Элита", numeral: "IV", color: "#d9a7f0", hint: "Доступ к созданию NFT" },
  { level: 4, name: "Легенда", numeral: "V", color: "#e7d6f5", hint: "Особый статус сообщества" },
  { level: 5, name: "Архитектор", numeral: "VI", color: "#ffffff", hint: "Высший ранг CharMsg" }
];
export const MAX_RANK = RANKS.length - 1;
export const NFT_MIN_RANK = 3;

export function rankOf(user) {
  return clamp(Number(user?.rank) || 0, 0, MAX_RANK);
}

export function rankInfo(level) {
  return RANKS[clamp(Number(level) || 0, 0, MAX_RANK)];
}

export function rankBadge(level, { compact = false } = {}) {
  const info = rankInfo(level);
  if (compact) {
    return `<span class="rank-badge rank-compact" style="--rank-color:${info.color}" title="Ранг: ${escapeHtml(info.name)}">${escapeHtml(info.numeral)}</span>`;
  }
  return `<span class="rank-badge" style="--rank-color:${info.color}" title="Ранг: ${escapeHtml(info.name)}">${escapeHtml(info.name)}</span>`;
}

export function verifiedBadge(verified, { compact = false } = {}) {
  if (!verified) return "";
  return `<span class="verified-tag${compact ? " compact" : ""}" title="Верифицирован администратором">✓</span>`;
}

// ---------- image files ----------
export function imageFileToDataUrl(file, { maxW = 900, maxH = 900, quality = 0.8, crop = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("Выберите изображение"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("Файл больше 8 МБ"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не удалось открыть изображение"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (crop) {
          canvas.width = maxW;
          canvas.height = maxH;
          const scale = Math.max(maxW / img.width, maxH / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (maxW - w) / 2, (maxH - h) / 2, w, h);
        } else {
          const scale = Math.min(1, maxW / img.width, maxH / img.height);
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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

export const NICK_GRADIENTS = {
  "": "По умолчанию",
  sunset: "Закат",
  ocean: "Океан",
  aurora: "Северное сияние",
  gold: "Золото",
  candy: "Розовый лёд",
  rainbow: "Радуга"
};

export function nickClasses(isAdmin, gradient) {
  const custom = gradient && Object.hasOwn(NICK_GRADIENTS, gradient) ? ` nick-gradient nick-gradient-${gradient}` : "";
  return (isAdmin ? "nick-admin" : "") + custom;
}

export function nickHtml(nick = "", isAdmin = false, gradient) {
  const cls = `nick ${nickClasses(isAdmin, gradient)}`.trim();
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
