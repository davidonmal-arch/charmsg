import { enableMessagePush, optOutMessagePush, setupDefaultMessagePush } from "./push.js";
import {
  banForScreenshot,
  checkAccess,
  currentUid,
  ensureMarket,
  ensureAdminProfile,
  expireBanIfNeeded,
  subscribeChats,
  subscribeCasino,
  subscribeMarket,
  subscribeNfts,
  subscribePastes,
  subscribeProfile,
  subscribeTrades,
  subscribeUsers,
  tickMarket,
  verifyAdminSession,
  createProfile
} from "./store.js";
import { state, notify, onChange } from "./state.js";
import { openAdminLoginModal, openModal, openPlayerLoginModal } from "./ui.js";
import { avatarData, escapeHtml, fmtNum, nickHtml, toast } from "./util.js";
import { mountChats } from "./views/chats.js";
import { mountCasino } from "./views/casino.js";
import { mountMarket } from "./views/market.js";
import { mountPastes } from "./views/pastes.js";
import { mountProfile } from "./views/profile.js";
import { mountAdmin } from "./views/admin.js";
import { mountBan } from "./views/ban.js";

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
  casino: mountCasino,
  market: mountMarket,
  pastes: mountPastes,
  profile: mountProfile,
  admin: mountAdmin,
  ban: mountBan
};

let cleanupView = null;
let onboardingOpen = false;

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, "").split("?")[0] || "chats";
  return Object.hasOwn(routes, raw) ? raw : "chats";
}

function updateNav() {
  const route = state.route;
  const banned = !!state.profile?.banned;
  document.body.classList.toggle("is-banned", banned);
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
  navAdmin.hidden = !state.admin || banned;
  tabAdmin.hidden = !state.admin || banned;
  adminEntryBtn.hidden = state.admin || banned;
}

function renderRoute() {
  let route = currentRoute();
  if (state.profile?.banned && route !== "ban") {
    if (location.hash !== "#/ban") {
      location.hash = "#/ban";
      return;
    }
    route = "ban";
  } else if (!state.profile?.banned && route === "ban") {
    if (location.hash !== "#/chats") {
      location.hash = "#/chats";
      return;
    }
    route = "chats";
  }
  if (route === "chats") {
    const chat = new URLSearchParams(location.hash.split("?")[1]).get("chat");
    if (chat && state.activeChatId !== chat) {
      state.activeChatId = chat;
      notify();
    }
  }
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
       <button class="btn btn-primary btn-block" type="submit" id="onboardSubmit">Создать анонимный профиль</button>
       <button class="btn btn-ghost btn-block" id="existingPlayerLogin" type="button" style="margin-top:8px">Войти по логину и паролю</button>
     </form>
     <div class="onboard-note">
       <svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>
       <span>Для входа с другого устройства сохраните логин и пароль в профиле. Мы не собираем почту и телефон. Сообщения хранятся в Google Firestore и исчезают по таймеру.</span>
     </div>`,
    {
      onClose: () => {
        onboardingOpen = false;
        if (!state.profile) setTimeout(showOnboarding, 1200);
      }
    }
  );

  modal.body.querySelector("#existingPlayerLogin").addEventListener("click", () => {
    openPlayerLoginModal();
  });
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
      await createProfile(state.uid, { nick: nickEl.value, bio: bioEl.value, avatar: avatarValue });
      toast("Профиль создан. Добро пожаловать!", "success");
      onboardingOpen = false;
      modal.close();
      hideBoot();
      setTimeout(renderRoute, 120);
    } catch (err) {
      errorEl.textContent = err.message || "Не удалось создать профиль";
      submit.disabled = false;
      submit.textContent = "Создать анонимный профиль";
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
    if (document.visibilityState === "visible" && state.route === "market" && state.profile && !state.profile.banned) {
      tickMarket().catch((err) => console.warn("market tick failed", err));
    }
  };
  setTimeout(tick, 2200);
  setInterval(tick, 60_000);
}

let firstProfile = true;

async function startDefaultPush(uid) {
  const promptKey = "charmsg_push_prompted_" + uid;
  const options = await setupDefaultMessagePush(uid);
  if (!options || state.uid !== uid || state.profile?.banned || localStorage.getItem(promptKey)) return;
  localStorage.setItem(promptKey, "1");
  const modal = openModal(`
    <button class="modal-close" data-close aria-label="Закрыть">×</button>
    <h3 class="modal-title">Уведомления о личных сообщениях</h3>
    <p class="modal-sub">Разреши уведомления, чтобы получать их, даже когда CharMsg закрыт.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" data-skip-push>Не сейчас</button>
      <button class="btn btn-primary" type="button" data-enable-push>Разрешить</button>
    </div>`);
  modal.body.querySelector("[data-skip-push]").onclick = () => {
    optOutMessagePush(uid);
    modal.close();
  };
  const button = modal.body.querySelector("[data-enable-push]");
  button.onclick = async () => {
    button.disabled = true;
    try {
      await enableMessagePush(options);
      toast("Уведомления включены", "success");
    } catch (error) {
      toast(error.message || "Не удалось включить уведомления", "error");
    } finally {
      modal.close();
    }
  };
}

async function boot() {
  try {
    state.admin = await verifyAdminSession();
  } catch (error) {
    console.error("Firebase authentication failed", error);
    toast("Не удалось войти в CharMsg. Проверьте подключение и обновите страницу.", "error");
    hideBoot();
    return;
  }
  state.uid = currentUid();
  try {
    await checkAccess();
  } catch (error) {
    if (error.details?.kind === "network-ban") {
      state.profile = {
        uid: state.uid, banned: true, banType: "radical", banReason: "Доступ заблокирован усиленным баном.",
        banAt: error.details.since, banUntil: error.details.until
      };
      location.hash = "#/ban";
      renderRoute();
      hideBoot();
      return;
    }
    console.warn("Access check unavailable", error.code || error.name);
  }

  window.addEventListener("charmsg:network-ban", () => location.reload(), { once: true });
  wireHeader();
  updateHeader();
  startMarketLoop();

  let loaded = false;
  let banTimer;
  function watchBan(profile) {
    clearTimeout(banTimer);
    if (!profile?.banned || !(profile.banUntil > 0)) return;
    const remaining = profile.banUntil - Date.now();
    if (remaining > 0) {
      banTimer = setTimeout(() => watchBan(profile), Math.min(remaining, 2_147_483_647));
      return;
    }
    expireBanIfNeeded(state.uid, profile)
      .then((expired) => {
        if (expired) toast("Срок блокировки истёк. Доступ восстановлен.", "success");
        else if (state.profile === profile) banTimer = setTimeout(() => watchBan(profile), 30_000);
      })
      .catch((error) => {
        console.warn("ban expiry failed", error);
        if (state.profile === profile) banTimer = setTimeout(() => watchBan(profile), 30_000);
      });
  }
  let subscriptions = [];
  function subscribeData() {
    subscriptions.push(subscribeUsers(
      (users) => {
        state.users = new Map(users.map((u) => [u.uid || u.id, u]));
        notify();
      },
      (err) => console.warn("users subscription", err)
    ));

    subscriptions.push(subscribeChats(
      state.uid,
      (chats) => {
        state.chats = chats;
        notify();
      },
      (err) => {
        console.error("chats subscription", err);
        if (err.code !== "functions/resource-exhausted") toast("Не удалось загрузить чаты", "error");
      }
    ));

    subscriptions.push(subscribeMarket(
      (market) => {
        state.market = market;
        notify();
      },
      (err) => console.warn("market subscription", err)
    ));

    subscriptions.push(subscribeTrades(
      (trades) => {
        state.trades = trades;
        notify();
      },
      (err) => console.warn("trades subscription", err)
    ));

    subscriptions.push(subscribeCasino(
      (plays) => {
        state.casino = plays;
        notify();
      },
      (err) => console.warn("casino subscription", err)
    ));

    subscriptions.push(subscribePastes(
      (pastes) => {
        state.pastes = pastes;
        notify();
      },
      (err) => console.warn("pastes subscription", err),
      () => state.route === "pastes"
    ));

    subscriptions.push(subscribeNfts(
      (nfts) => {
        state.nfts = nfts;
        notify();
      },
      (err) => console.warn("nfts subscription", err)
    ));
  }

  subscribeProfile(
    state.uid,
    (profile) => {
      state.profile = profile;
      const active = !!profile && !profile.banned;
      if (active !== loaded) {
        for (const unsubscribe of subscriptions) unsubscribe();
        subscriptions = [];
        loaded = active;
        if (active) {
          subscribeData();
          startDefaultPush(state.uid).catch((error) => console.warn("Push setup failed", error.code || error.name));
        }
        else {
          state.users = new Map();
          for (const name of ["chats", "pastes", "nfts", "trades", "casino"]) state[name] = [];
          state.market = null;
        }
      }
      watchBan(profile);
      if (firstProfile) {
        firstProfile = false;
        hideBoot();
        if (!profile && state.admin) {
          ensureAdminProfile().catch((error) => toast(error.message, "error", 7500));
        }
      }
      if (!profile && !state.admin) showOnboarding();
      updateHeader();
      notify();
      if (profile?.banned && currentRoute() !== "ban") {
        location.hash = "#/ban";
      } else if (profile && !profile.banned && currentRoute() === "ban") {
        location.hash = "#/chats";
      }
    },
    (err) => {
      console.error("profile subscription", err);
      if (err.code !== "resource-exhausted") toast("Нет доступа к профилю в Firestore", "error");
      hideBoot();
    }
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

// Best-effort screenshot guard: browsers cannot see OS-level screenshots, so we
// intercept the keys that are observable (PrintScreen and desktop shortcuts).
let screenshotFired = false;
async function onScreenshotDetected(source) {
  if (screenshotFired) return;
  const profile = state.profile;
  if (!profile || profile.isAdmin || state.admin || profile.banned) return;
  screenshotFired = true;
  try {
    await banForScreenshot(state.uid);
    toast("Скриншот обнаружен. Аккаунт заблокирован навсегда.", "error", 6500);
    location.hash = "#/ban";
  } catch (err) {
    screenshotFired = false;
    console.warn("screenshot ban failed", source, err);
  }
}

function initScreenshotGuard() {
  const isPrintScreen = (e) => e.key === "PrintScreen" || e.code === "PrintScreen";
  window.addEventListener(
    "keydown",
    (e) => {
      if (isPrintScreen(e)) {
        e.preventDefault();
        void onScreenshotDetected("printscreen");
        return;
      }
      const macShot = e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key);
      const desktopShot = e.ctrlKey && e.shiftKey && String(e.key).toLowerCase() === "s";
      if (macShot || desktopShot) {
        e.preventDefault();
        void onScreenshotDetected("shortcut");
      }
    },
    true
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (isPrintScreen(e)) {
        e.preventDefault();
        void onScreenshotDetected("printscreen");
      }
    },
    true
  );
}

initScreenshotGuard();
boot();
