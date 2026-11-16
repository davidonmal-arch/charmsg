import {
  currentUid,
  ensureMarket,
  subscribeChats,
  subscribeMarket,
  subscribeProfile,
  subscribeTrades,
  subscribeUsers,
  tickMarket,
  verifyAdminSession,
  createProfile,
  deviceUid
} from "./store.js";
import { state, notify, onChange } from "./state.js";
import { openAdminLoginModal, openModal } from "./ui.js";
import { avatarData, escapeHtml, fmtNum, nickHtml, toast } from "./util.js";
import { mountChats } from "./views/chats.js";
import { mountMarket } from "./views/market.js";
import { mountProfile } from "./views/profile.js";
import { mountAdmin } from "./views/admin.js";

const viewEl = document.getElementById("view");
const bootEl = document.getElementById("boot");
const meAvatar = document.getElementById("meAvatar");
const meName = document.getElementById("meName");
const balanceValue = document.getElementById("balanceValue");
const navAdmin = document.getElementById("navAdmin");
const tabAdmin = document.getElementById("tabAdmin");
const adminEntryBtn = document.getElementById("adminEntryBtn");

// Debug handle (also handy for support)
window.__charmsg = state;

const routes = {
  chats: mountChats,
  market: mountMarket,
  profile: mountProfile,
  admin: mountAdmin
};

let cleanupView = null;
let onboardingOpen = false;

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, "").split("?")[0] || "chats";
  return routes[raw] ? raw : "chats";
}

function updateNav() {
  const route = state.route;
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
  navAdmin.hidden = !state.admin;
  tabAdmin.hidden = !state.admin;
  adminEntryBtn.hidden = state.admin;
}

function renderRoute() {
  const route = currentRoute();
  if (state.route === route && cleanupView) {
    updateNav();
    return;
  }
  if (cleanupView) {
    try {
      cleanupView();
    } catch (err) {
      console.warn("view cleanup failed", err);
    }
  }
  cleanupView = null;
  state.route = route;
  viewEl.innerHTML = "";
  try {
    cleanupView = routes[route](viewEl) || null;
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="empty"><h3>Что-то пошло не так</h3><p>${escapeHtml(err.message || "Ошибка отображения")}</p></div>`;
  }
  updateNav();
  window.scrollTo({ top: 0, behavior: "auto" });
}

let headerSignature = "";
function updateHeader() {
  const p = state.profile;
  const signature = `${state.admin}|${p?.nick || ""}|${p?.avatar || ""}|${!!p?.isAdmin}|${p?.coins || 0}`;
  if (signature === headerSignature) {
    updateNav();
    return;
  }
  headerSignature = signature;
  meAvatar.innerHTML = avatarData(p?.nick || "Гость", p?.avatar || "", "");
  meName.innerHTML = p ? nickHtml(p.nick || "Гость", p.isAdmin) : "Гость";
  balanceValue.textContent = fmtNum(p?.coins || 0);
  updateNav();
}

function hideBoot() {
  if (!bootEl || bootEl.classList.contains("done")) return;
  setTimeout(() => bootEl.classList.add("done"), 260);
}

function randomNick() {
  const base = ["Тень", "Неон", "Крипто", "Луна", "Вихрь", "Пиксель", "Кобальт", "Нимбус", "Фантом", "Астра", "Шифр", "Бархат"];
  const word = base[Math.floor(Math.random() * base.length)];
  return `${word}-${Math.floor(100 + Math.random() * 900)}`;
}

function cropAvatarSmall(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Выберите изображение"));
    if (file.size > 6 * 1024 * 1024) return reject(new Error("Файл больше 6 МБ"));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("Не удалось открыть изображение"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function showOnboarding() {
  if (onboardingOpen || state.admin) return;
  onboardingOpen = true;
  let avatarValue = "";
  const modal = openModal(
    `<div class="onboard-head">
       <div class="onboard-logo"><img src="./assets/logo.jpg" alt="CharMsg" /></div>
       <div>
         <h2 class="onboard-title">Добро пожаловать<br/>в CharMsg</h2>
         <p class="onboard-sub">Анонимный мессенджер. Без email. Без номера.</p>
       </div>
     </div>
     <form id="onboardForm">
       <div class="field" style="margin-bottom:13px">
         <label for="onboardNick">Ваш ник</label>
         <div class="row" style="gap:7px">
           <input class="input" id="onboardNick" maxlength="18" placeholder="Как вас называть?" autocomplete="off" />
           <button class="btn btn-sm" type="button" id="randomNickBtn" title="Случайный ник">🎲</button>
         </div>
       </div>
       <div class="field" style="margin-bottom:13px">
         <label for="onboardBio">Описание <span class="muted">(необязательно)</span></label>
         <textarea class="textarea" id="onboardBio" maxlength="240" placeholder="Пара слов о себе"></textarea>
       </div>
       <div class="avatar-picker" style="margin-bottom:14px">
         <div class="avatar-preview" id="onboardAvatar"></div>
         <div class="grow">
           <div class="row wrap" style="gap:7px">
             <span class="btn btn-sm file-btn">Загрузить аватар<input type="file" id="onboardFile" accept="image/*" /></span>
             <button class="btn btn-sm btn-ghost" type="button" id="onboardClear">Убрать</button>
           </div>
           <div class="hint" style="margin-top:6px">Можно пропустить — будет фиолетовый градиент с инициалами.</div>
         </div>
       </div>
       <div class="error-text" id="onboardError"></div>
       <button class="btn btn-primary btn-block" type="submit" id="onboardSubmit">Войти анонимно</button>
     </form>
     <div class="onboard-note">
       <svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>
       <span>Личность привязана только к этому браузеру. Мы не собираем почту, телефон и соцсети. Сообщения хранятся в Google Firestore и исчезают по таймеру.</span>
     </div>`,
    {
      onClose: () => {
        onboardingOpen = false;
        if (!state.profile) setTimeout(showOnboarding, 1200);
      }
    }
  );

  const nickEl = modal.body.querySelector("#onboardNick");
  const bioEl = modal.body.querySelector("#onboardBio");
  const avatarPreview = modal.body.querySelector("#onboardAvatar");
  const errorEl = modal.body.querySelector("#onboardError");
  const submit = modal.body.querySelector("#onboardSubmit");

  const paint = () => {
    avatarPreview.innerHTML = avatarData(nickEl.value || "?", avatarValue, "");
  };
  nickEl.value = randomNick();
  paint();
  nickEl.addEventListener("input", paint);
  modal.body.querySelector("#randomNickBtn").addEventListener("click", () => {
    nickEl.value = randomNick();
    paint();
  });
  modal.body.querySelector("#onboardFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      avatarValue = await cropAvatarSmall(file);
      paint();
    } catch (err) {
      toast(err.message || "Не удалось обработать изображение", "error");
    } finally {
      e.target.value = "";
    }
  });
  modal.body.querySelector("#onboardClear").addEventListener("click", () => {
    avatarValue = "";
    paint();
  });

  modal.body.querySelector("#onboardForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    submit.disabled = true;
    submit.textContent = "Создаём профиль…";
    try {
      await createProfile(deviceUid, { nick: nickEl.value, bio: bioEl.value, avatar: avatarValue });
      toast("Профиль создан. Добро пожаловать!", "success");
      onboardingOpen = false;
      modal.close();
      hideBoot();
      setTimeout(renderRoute, 120);
    } catch (err) {
      errorEl.textContent = err.message || "Не удалось создать профиль";
      submit.disabled = false;
      submit.textContent = "Войти анонимно";
    }
  });
  setTimeout(() => nickEl.focus(), 80);
}

function wireHeader() {
  document.getElementById("meBtn").addEventListener("click", () => {
    location.hash = "#/profile";
  });
  adminEntryBtn.addEventListener("click", () => {
    if (state.admin) location.hash = "#/admin";
    else openAdminLoginModal();
  });
}

function startMarketLoop() {
  ensureMarket().catch((err) => console.warn("ensureMarket failed", err));
  const tick = () => {
    if (document.visibilityState === "visible") tickMarket();
  };
  setTimeout(tick, 2200);
  setInterval(tick, 11_000);
}

let firstProfile = true;

async function boot() {
  try {
    state.admin = await verifyAdminSession();
  } catch {
    state.admin = false;
  }
  state.uid = currentUid();

  wireHeader();
  updateHeader();
  startMarketLoop();

  subscribeProfile(
    state.uid,
    (profile) => {
      state.profile = profile;
      if (firstProfile) {
        firstProfile = false;
        hideBoot();
        if (!profile) showOnboarding();
      }
      if (!profile) showOnboarding();
      updateHeader();
      notify();
    },
    (err) => {
      console.error("profile subscription", err);
      toast("Нет доступа к профилю в Firestore", "error");
      hideBoot();
    }
  );

  subscribeUsers(
    (users) => {
      state.users = new Map(users.map((u) => [u.uid || u.id, u]));
      notify();
    },
    (err) => console.warn("users subscription", err)
  );

  subscribeChats(
    state.uid,
    (chats) => {
      state.chats = chats;
      notify();
    },
    (err) => {
      console.error("chats subscription", err);
      toast("Не удалось загрузить чаты", "error");
    }
  );

  subscribeMarket(
    (market) => {
      state.market = market;
      notify();
    },
    (err) => console.warn("market subscription", err)
  );

  subscribeTrades(
    (trades) => {
      state.trades = trades;
      notify();
    },
    (err) => console.warn("trades subscription", err)
  );

  if (!location.hash) {
    history.replaceState(null, "", "#/chats");
  }
  renderRoute();
  hideBoot();
  setTimeout(hideBoot, 3500);
}

window.addEventListener("hashchange", renderRoute);
onChange(updateHeader);

window.addEventListener("online", () => toast("Соединение восстановлено", "success"));
window.addEventListener("offline", () => toast("Нет сети — Firestore переподключится", "error"));

window.addEventListener("unhandledrejection", (e) => {
  if (e.reason?.code === "permission-denied") {
    toast("Firestore отклонил запрос. Проверьте правила доступа.", "error");
  }
  console.error("unhandled", e.reason);
});

boot();
