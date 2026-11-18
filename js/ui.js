import {
  avatarData,
  escapeHtml,
  fmtNum,
  fmtRelative,
  nickHtml,
  rankBadge,
  rankOf,
  safeUrl,
  toast,
  verifiedBadge
} from "./util.js";
import { state, userOf } from "./state.js";
import { adminLogin, effectClass, fetchUser, nftTitle, openDM, subscribeNft, savePlayerLogin, signInPlayer } from "./store.js";

const root = () => document.getElementById("modalRoot");

export function openModal(contentHtml, { className = "", onClose = null, closeOnBackdrop = true } = {}) {
  const overlay = document.createElement("div");
  overlay.className = `modal-overlay ${className}`.trim();
  overlay.innerHTML = `<div class="modal">${contentHtml}</div>`;
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && closeOnBackdrop) close();
  });
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", onKey);
  root().append(overlay);
  return { overlay, close, body: overlay.querySelector(".modal") };
}

export function confirmDialog(title, text, confirmLabel = "Подтвердить", danger = false) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal(
      `<h3 class="modal-title">${escapeHtml(title)}</h3>
       <p class="modal-sub">${escapeHtml(text)}</p>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-cancel>Отмена</button>
         <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${escapeHtml(confirmLabel)}</button>
       </div>`,
      { onClose: () => done(false) }
    );
    modal.body.querySelector("[data-cancel]").addEventListener("click", () => {
      done(false);
      modal.close();
    });
    modal.body.querySelector("[data-ok]").addEventListener("click", () => {
      done(true);
      modal.close();
    });
  });
}

export function profileNftHtml(nft, uid) {
  if (!nft || nft.ownerUid !== uid) return "";
  const image = safeUrl(nft.image || "");
  return `<figure class="profile-nft">
    <div class="nft-art ${effectClass(nft.effect)}">
      ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : '<span class="nft-noimg">◈</span>'}
    </div>
    <figcaption>${escapeHtml(nftTitle(nft))}</figcaption>
  </figure>`;
}

export function userCardHtml(user, { own = false } = {}) {
  const u = user || { nick: "Аноним", bio: "", avatar: "", isAdmin: false };
  const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "неизвестно";
  const banner = safeUrl(u.banner || "");
  return `
    <div class="user-modal-banner ${banner ? "has-image" : ""}"${banner ? ` style="background-image:url('${escapeHtml(banner)}')"` : ""}></div>
    <div class="user-modal-body">
      <div class="user-modal-avatar">${avatarData(u.nick, u.avatar, 84)}</div>
      <div class="user-modal-name">
        ${nickHtml(u.nick || "Аноним", u.isAdmin)}
        ${rankBadge(rankOf(u))}
        ${verifiedBadge(u.verified)}
        ${u.isAdmin ? '<span class="admin-tag">admin</span>' : ""}
        ${u.banned ? '<span class="badge">заблокирован</span>' : ""}
      </div>
      <div class="user-modal-meta">В CharMsg с ${escapeHtml(joined)}${own ? " · это вы" : ""}</div>
      <p class="user-modal-bio">${u.bio ? escapeHtml(u.bio) : '<span class="muted">Без описания — загадочная личность.</span>'}</p>
      <div class="user-modal-stats">
        <span class="badge solid">◈ ${fmtNum(u.coins || 0)} CR</span>
        <span class="badge">${fmtNum(u.chr || 0, 2)} CHR</span>
        <span class="badge">${fmtNum(u.msgCount || 0)} сообщений</span>
        ${u.verified ? '<span class="badge" style="color:var(--p4)">верифицирован</span>' : ""}
      </div>
      <div data-featured-nft></div>
      <div class="modal-actions">
        ${own
          ? `<button class="btn btn-primary btn-block" data-edit>Редактировать профиль</button>`
          : `<button class="btn btn-primary btn-block" data-dm>Написать в личные сообщения</button>`}
      </div>
    </div>`;
}

export async function openProfileModal(uid, { onDM } = {}) {
  let user = userOf(uid);
  if (!user) user = await fetchUser(uid).catch(() => null);
  if (!user) {
    toast("Профиль не найден", "error");
    return;
  }
  const own = uid === state.uid;
  let stopNft;
  const modal = openModal(userCardHtml(user, { own }), { className: "user-modal", onClose: () => stopNft?.() });
  if (user.featuredNftId) {
    const showcase = modal.body.querySelector("[data-featured-nft]");
    stopNft = subscribeNft(user.featuredNftId, (nft) => { showcase.innerHTML = profileNftHtml(nft, uid); });
  }

  modal.body.querySelector("[data-edit]")?.addEventListener("click", () => {
    modal.close();
    location.hash = "#/profile";
  });

  modal.body.querySelector("[data-dm]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Открываем чат…";
    try {
      const chatId = await openDM(state.uid, uid);
      modal.close();
      state.activeChatId = chatId;
      if (onDM) onDM(chatId);
      if (location.hash !== "#/chats") location.hash = "#/chats";
      window.dispatchEvent(new CustomEvent("charmsg:open-chat", { detail: { chatId } }));
    } catch (err) {
      toast(err.message || "Не удалось открыть чат", "error");
      btn.disabled = false;
      btn.textContent = "Написать в личные сообщения";
    }
  });
}

export function openPlayerLoginModal({ link = false, onLinked } = {}) {
  const modal = openModal(
    `<button class="modal-close" data-close aria-label="Закрыть">×</button>
     <h3 class="modal-title">${link ? "Сохранить вход в профиль" : "Войти в существующий профиль"}</h3>
     <form id="playerCredentials">
       <div class="field">
         <label for="playerLogin">Логин</label>
         <input class="input" id="playerLogin" name="login" maxlength="24" autocomplete="username" required />
       </div>
       <div class="field" style="margin-top:12px">
         <label for="playerPassword">Пароль</label>
         <input class="input" id="playerPassword" name="password" type="password"
           autocomplete="${link ? "new-password" : "current-password"}" ${link ? 'minlength="12"' : ""} required />
       </div>
       ${link ? '<p class="hint">Логин для входа можно выбрать отдельно от ника. Запишите пароль, поскольку восстановление по почте недоступно.</p>' : ""}
       <p class="error-text" role="alert"></p>
       <button class="btn btn-primary btn-block" type="submit">${link ? "Сохранить" : "Войти"}</button>
     </form>`
  );
  const form = modal.body.querySelector("form");
  const submit = form.querySelector("button");
  const errorLine = form.querySelector('[role="alert"]');
  form.elements.login.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorLine.textContent = "";
    submit.disabled = true;
    try {
      const { login, password } = form.elements;
      if (link) {
        await savePlayerLogin(login.value, password.value);
        modal.close();
        onLinked?.();
        toast("Логин и пароль сохранены", "success");
      } else {
        await signInPlayer(login.value, password.value);
        location.reload();
      }
    } catch (error) {
      errorLine.textContent = error.message;
      submit.disabled = false;
    }
  });
}

export function openAdminLoginModal() {
  const modal = openModal(
    `<button class="modal-close" data-close aria-label="Закрыть">×</button>
     <div class="onboard-head">
       <div class="onboard-logo"><img src="./assets/logo.jpg" alt="" /></div>
       <div>
         <h2 class="onboard-title">Вход администратора</h2>
         <p class="onboard-sub">Панель управления CharMsg</p>
       </div>
     </div>
     <form class="admin-form" id="adminLoginForm">
       <div class="field">
         <label for="adminLogin">Логин</label>
         <input class="input" id="adminLogin" name="login" autocomplete="username" placeholder="Введите логин" required />
       </div>
       <div class="field">
         <label for="adminPassword">Пароль</label>
         <input class="input" id="adminPassword" name="password" type="password" autocomplete="current-password" placeholder="Введите пароль" required />
       </div>
       <div class="error-text" id="adminLoginError"></div>
       <button class="btn btn-primary btn-block" type="submit" id="adminLoginSubmit">Войти в админ-панель</button>
     </form>
     <p class="admin-note">Доступ только для владельца CharMsg. После входа ник выделяется переливающимся фиолетовым.</p>`,
    { className: "admin-login-modal" }
  );
  const form = modal.body.querySelector("#adminLoginForm");
  const error = modal.body.querySelector("#adminLoginError");
  const submit = modal.body.querySelector("#adminLoginSubmit");
  modal.body.querySelector("#adminLogin").focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    submit.textContent = "Проверяем…";
    try {
      await adminLogin(form.login.value, form.password.value);
      modal.close();
      toast("Добро пожаловать, farnaz ✦", "success");
      setTimeout(() => location.reload(), 450);
    } catch (err) {
      error.textContent = err.message || "Ошибка входа";
      submit.disabled = false;
      submit.textContent = "Войти в админ-панель";
    }
  });
}
