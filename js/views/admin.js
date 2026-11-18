import { runAction } from "../db.js";
import { state, onChange } from "../state.js";
import { confirmDialog, openModal } from "../ui.js";
import {
  ADMIN_LOGIN,
  BAN_IMAGE,
  adminBanUser,
  adminSetPlayerPassword,
  adminBroadcast,
  adminDeleteUser,
  adminGrantCoins,
  adminListUsers,
  adminLogin,
  adminLogout,
  adminPurgeChat,
  adminPurgeExpired,
  adminResetMarket,
  adminUnbanUser,
  adminSetBots,
  adminSetLiquidity,
  adminSetPrice,
  adminSetRank,
  adminSetNickGradient,
  adminSetVerified,
  adminStats,
  deleteChat
} from "../store.js";
import {
  RANKS,
  avatarData,
  escapeHtml,
  fmtNum,
  fmtRelative,
  imageFileToDataUrl,
  nickHtml,
  NICK_GRADIENTS,
  plural,
  rankBadge,
  rankOf,
  ttlShort,
  toast,
  verifiedBadge
} from "../util.js";

function loginHtml() {
  return `
    <div class="card admin-lock">
      <div class="lock-icon">
        <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </div>
      <h2>Админ-панель</h2>
      <p>Введите логин и пароль администратора CharMsg. После входа ник <b>farnaz</b> начнёт переливаться фиолетовым на всех страницах.</p>
      <form class="admin-form" id="adminForm">
        <div class="field">
          <label for="adminLoginInput">Логин</label>
          <input class="input" id="adminLoginInput" autocomplete="username" placeholder="Логин" />
        </div>
        <div class="field">
          <label for="adminPasswordInput">Пароль</label>
          <input class="input" id="adminPasswordInput" type="password" autocomplete="current-password" placeholder="Пароль" />
        </div>
        <div class="error-text" id="adminError"></div>
        <button class="btn btn-primary btn-block" id="adminSubmit" type="submit">Войти</button>
      </form>
      <p class="admin-note">Доступ проверяется по хешу пароля, сохранённому в Firestore. Сессия живёт 12 часов.</p>
    </div>`;
}

export function mountAdmin(container) {
  if (!state.admin) {
    container.innerHTML = `<div class="page-head"><div><div class="eyebrow">закрытый раздел</div><h1 class="page-title">Админ</h1><p class="page-sub">Управление сайтом доступно только администратору.</p></div></div>${loginHtml()}`;
    const form = container.querySelector("#adminForm");
    const errorEl = container.querySelector("#adminError");
    const submit = container.querySelector("#adminSubmit");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";
      submit.disabled = true;
      submit.textContent = "Проверяем…";
      try {
        await adminLogin(container.querySelector("#adminLoginInput").value, container.querySelector("#adminPasswordInput").value);
        toast("Вход выполнен. Перезагружаем…", "success");
        setTimeout(() => location.reload(), 400);
      } catch (err) {
        errorEl.textContent = err.message || "Ошибка входа";
        submit.disabled = false;
        submit.textContent = "Войти";
      }
    });
    return () => {};
  }

  let activeTab = "users";
  let users = [];
  let usersPromise = null;
  let statsKey = "";

  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">root · ${escapeHtml(state.profile?.nick || ADMIN_LOGIN)}</div>
        <h1 class="page-title">Админ-панель</h1>
        <p class="page-sub">Пользователи, исчезающие чаты, экономика CharCoin и рассылки. Всё меняется в Firestore в реальном времени.</p>
      </div>
      <div class="row wrap">
        <span class="badge solid">${nickHtml("farnaz", true)}</span>
        <button class="btn btn-sm" id="adminRefresh">Обновить</button>
        <button class="btn btn-sm btn-danger" id="adminLogout">Выйти</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Пользователи</div><div class="stat-value" id="statUsers">—</div></div>
      <div class="stat-card"><div class="stat-label">Чаты</div><div class="stat-value" id="statChats">—</div></div>
      <div class="stat-card"><div class="stat-label">Сообщения</div><div class="stat-value" id="statMessages">—</div></div>
      <div class="stat-card"><div class="stat-label">Сделки</div><div class="stat-value" id="statTrades">—</div></div>
    </div>

    <div class="admin-tabs" id="adminTabs">
      <button class="admin-tab active" data-tab="users">Пользователи</button>
      <button class="admin-tab" data-tab="content">Контент и чаты</button>
      <button class="admin-tab" data-tab="market">Рынок</button>
      <button class="admin-tab" data-tab="broadcast">Рассылка</button>
      <button class="admin-tab" data-tab="events">Ивенты</button>
    </div>

    <div class="admin-panel card" data-panel="users">
      <div class="row-between" style="margin-bottom:10px">
        <div>
          <h3>Пользователи</h3>
          <p class="sub">Бан, начисление CR и удаление профилей. Ник администратора подсвечен.</p>
        </div>
        <span class="badge" id="usersCount">0</span>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>Пользователь</th><th>Ранг</th><th>Верификация</th><th>CR</th><th>CHR</th><th>Сообщений</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody id="usersBody"><tr><td colspan="8" class="muted">Загрузка…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="admin-panel card hidden" data-panel="content">
      <div class="row-between" style="margin-bottom:10px">
        <div>
          <h3>Контент и чаты</h3>
          <p class="sub">Публичные комнаты, таймеры исчезновения и очистка сообщений.</p>
        </div>
        <button class="btn btn-sm" id="purgeAllBtn">Очистить просроченные</button>
      </div>
      <div id="roomsList"></div>
      <div class="divider"></div>
      <div class="row wrap" style="justify-content:space-between">
        <div class="hint">Личные чаты не отображаются в списке, но администратор может удалять сообщения прямо в переписке.</div>
        <span class="badge">${state.chats.length} ${plural(state.chats.length, "чат", "чата", "чатов")} всего</span>
      </div>
    </div>

    <div class="admin-panel card hidden" data-panel="market">
      <h3>Управление рынком CharCoin</h3>
      <p class="sub">Цена общая для всех игроков. Изменения сразу видны на бирже.</p>
      <div class="row wrap" style="margin-bottom:16px">
        <span class="badge solid">Цена: <b id="adminPrice">—</b> CR</span>
        <span class="badge">Ликвидность: <b id="adminLiq">—</b></span>
        <span class="badge">Объём: <b id="adminVolume">—</b></span>
        <span class="badge" id="adminBotsBadge">—</span>
      </div>
      <div class="form-grid" style="max-width:620px">
        <div class="field">
          <label for="setPriceInput">Новая цена CHR</label>
          <input class="input" id="setPriceInput" type="number" min="1" step="0.01" placeholder="100" />
        </div>
        <div class="field">
          <label for="setLiqInput">Ликвидность (CR)</label>
          <input class="input" id="setLiqInput" type="number" min="1000" step="100" placeholder="12000" />
        </div>
      </div>
      <div class="row wrap" style="margin-top:13px">
        <button class="btn btn-primary btn-sm" id="setPriceBtn">Установить цену</button>
        <button class="btn btn-sm" id="setLiqBtn">Установить ликвидность</button>
        <button class="btn btn-sm" id="toggleBotsBtn">Переключить ботов</button>
        <button class="btn btn-sm btn-danger" id="resetMarketBtn">Сбросить рынок к 100</button>
      </div>
      <p class="impact-note" style="margin-top:14px">Совет: большая ликвидность делает влияние отдельных сделок мягче. Малая ликвидность — рынок становится волатильным.</p>
    </div>

    <div class="admin-panel card hidden" data-panel="events">
      <h3>Ивенты</h3>
      <p class="sub">Новый ивент заменит текущий. Объявление появится у всех вошедших игроков.</p>
      <form class="stack" id="adminEventForm">
        <label class="field">Название<input class="input" name="title" maxlength="60" minlength="2" required></label>
        <label class="field">Объявление<textarea class="textarea" name="message" maxlength="400"></textarea></label>
        <label class="field">Длительность в часах<input class="input" name="hours" type="number" min="1" max="168" value="24" required></label>
        <label class="field">Награда каждому игроку, CR<input class="input" name="bonus" type="number" min="0" max="1000" value="0" required></label>
        <div class="row wrap">
          <button class="btn btn-primary btn-sm" type="submit">Запустить ивент</button>
          <button class="btn btn-sm" id="stopEventBtn" type="button">Завершить ивент</button>
        </div>
      </form>
    </div>

    <div class="admin-panel card hidden" data-panel="broadcast">
      <h3>Рассылка от администратора</h3>
      <p class="sub">Сообщение отправится во все публичные чаты от ника farnaz с переливающимся фиолетовым.</p>
      <div class="field">
        <label for="broadcastText">Текст</label>
        <textarea class="textarea" id="broadcastText" maxlength="1500" placeholder="Например: сегодня в 21:00 рынок открывает новый сезон…"></textarea>
      </div>
      <div class="row-between" style="margin-top:10px">
        <span class="hint" id="broadcastCount">0 / 1500</span>
        <button class="btn btn-primary btn-sm" id="broadcastBtn">Отправить во все чаты</button>
      </div>
    </div>`;

  const $ = (id) => container.querySelector(`#${id}`);

  async function loadStats() {
    try {
      const stats = await adminStats(state.chats);
      $("statUsers").textContent = fmtNum(stats.users);
      $("statChats").textContent = fmtNum(stats.chats);
      $("statMessages").textContent = fmtNum(stats.messages);
      $("statTrades").textContent = fmtNum(stats.trades);
    } catch (err) {
      console.warn("stats failed", err);
    }
  }

  async function loadUsers() {
    if (usersPromise) return usersPromise;
    usersPromise = (async () => {
      try {
        users = await adminListUsers(200);
        renderUsers();
      } catch (err) {
        toast("Не удалось загрузить пользователей", "error");
        console.error(err);
      } finally {
        usersPromise = null;
      }
    })();
    return usersPromise;
  }

  function renderUsers() {
    const body = $("usersBody");
    if (!users.length) {
      body.innerHTML = `<tr><td colspan="8" class="muted">Пользователей пока нет.</td></tr>`;
      $("usersCount").textContent = "0";
      return;
    }
    $("usersCount").textContent = String(users.length);
    body.innerHTML = users
      .map((u) => {
        const uid = u.uid || u.id;
        const rank = rankOf(u);
        return `<tr>
          <td><div class="user-cell">${avatarData(u.nick, u.avatar, 28)}<div><div>${nickHtml(u.nick || "Аноним", u.isAdmin, u.nickGradient, u.clanTag)}</div><div class="hint" style="font-size:9px">${escapeHtml(uid)}</div></div></div></td>
          <td>
            <div class="row" style="gap:6px;flex-wrap:nowrap">${rankBadge(rank, { compact: true })}
              <select class="select select-sm rank-select" data-rank="${escapeHtml(uid)}" title="Выдать ранг">
                ${RANKS.map((r) => `<option value="${r.level}" ${r.level === rank ? "selected" : ""}>${r.name}</option>`).join("")}
              </select>
            </div>
          </td>
          <td><button class="btn btn-sm ${u.verified ? "" : "btn-ghost"}" data-action="verify" data-uid="${escapeHtml(uid)}" data-verified="${u.verified ? "1" : "0"}">${u.verified ? "✓ верифицирован" : "Верифицировать"}</button></td>
          <td class="mono">${fmtNum(u.coins || 0, 1)}</td>
          <td class="mono">${fmtNum(u.chr || 0, 3)}</td>
          <td class="mono">${fmtNum(u.msgCount || 0)}</td>
          <td>${u.banned ? `<span class="badge" style="color:#e0a6bf" title="${escapeHtml(u.banReason || "")}">${u.banType === "clicker" ? "бан: автокликер" : u.banType === "radical" ? "усиленный бан" : u.banType === "spam" ? "бан: спам" : u.banType === "screenshot" ? "бан: скриншот" : "ручной бан"}${Number(u.banUntil) > 0 ? " · временно" : " · бессрочно"}</span>` : '<span class="badge">активен</span>'}</td>
          <td><div class="table-actions">
            <select class="select select-sm" data-gradient="${escapeHtml(uid)}" aria-label="Градиент ника">
              ${Object.entries(NICK_GRADIENTS).map(([value, label]) =>
                `<option value="${value}" ${value === (u.nickGradient || "") ? "selected" : ""}>${label}</option>`).join("")}
            </select>
            <button class="btn btn-sm" data-action="ban" data-uid="${escapeHtml(uid)}" data-banned="${u.banned ? "1" : "0"}">${u.banned ? "Разбан" : "Бан"}</button>
            ${uid !== state.uid ? `<button class="btn btn-sm btn-ghost" data-action="password" data-uid="${escapeHtml(uid)}">Пароль</button>` : ""}
            <button class="btn btn-sm" data-action="coins" data-uid="${escapeHtml(uid)}">+100 CR</button>
            <button class="btn btn-sm btn-danger" data-action="delete" data-uid="${escapeHtml(uid)}">Удалить</button>
          </div></td>
        </tr>`;
      })
      .join("");
  }

  function renderRooms() {
    const list = $("roomsList");
    const publicChats = state.chats.filter((c) => c.isPublic);
    if (!publicChats.length) {
      list.innerHTML = `<div class="empty" style="min-height:130px"><p>Публичных чатов нет.</p></div>`;
      return;
    }
    list.innerHTML = publicChats
      .map(
        (c) => `<div class="room-row">
          <div class="room-emoji">${escapeHtml(c.emoji || "💬")}</div>
          <div class="grow">
            <div class="room-name">${escapeHtml(c.name || "Чат")}</div>
            <div class="room-meta">${escapeHtml(c.desc || "без описания")} · ⏳ ${ttlShort(c.ttl)} · последнее ${c.lastMessageAt ? escapeHtml(fmtRelative(c.lastMessageAt)) : "—"}</div>
          </div>
          <div class="row" style="gap:5px">
            <button class="btn btn-sm" data-room-clear="${c.id}">Очистить</button>
            <button class="btn btn-sm btn-danger" data-room-delete="${c.id}">Удалить</button>
          </div>
        </div>`
      )
      .join("");
  }

  function refreshMarketPanel() {
    const m = state.market || {};
    $("adminPrice").textContent = fmtNum(m.price || 100, 2);
    $("adminLiq").textContent = fmtNum(m.liq || 12000);
    $("adminVolume").textContent = fmtNum(m.volume || 0);
    $("adminBotsBadge").textContent = m.bots === false ? "боты выключены" : "боты включены";
  }

  function refreshAll() {
    if (!state.admin) return;
    renderRooms();
    refreshMarketPanel();
    const key = `${state.chats.length}`;
    if (key !== statsKey) {
      statsKey = key;
      void loadStats();
    }
  }

  container.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      container.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== activeTab));
      if (activeTab === "users") loadUsers();
      if (activeTab === "content") renderRooms();
      if (activeTab === "market") refreshMarketPanel();
    });
  });

  function openBanModal(user) {
    const uid = user.uid || user.id;
    let banImage = "";
    const modal = openModal(
      `<button class="modal-close" data-close aria-label="Закрыть">×</button>
       <h3 class="modal-title">Забанить пользователя</h3>
       <p class="modal-sub">${escapeHtml(user.nick || "Аноним")} · <span class="mono">${escapeHtml(uid)}</span>. Укажите причину, срок и фото, которое увидит пользователь на странице бана.</p>

       <div class="field">
         <label for="banMode">Тип бана</label>
         <select class="input" id="banMode">
           <option value="account">Обычный — только аккаунт</option>
           <option value="radical">Усиленный — аккаунт, IP и браузер</option>
         </select>
         <p class="hint">Усиленный бан использует последний вход игрока и может затронуть других людей с общим IP.</p>
       </div>

       <div class="field">
         <label for="banReason">Причина бана</label>
         <textarea class="textarea" id="banReason" maxlength="600" rows="3" placeholder="Например: оскорбления, спам, обход правил…">${escapeHtml(user.banReason || "")}</textarea>
       </div>

       <div class="field" style="margin-top:14px">
         <label for="banYears">Срок блокировки</label>
         <div class="row" style="gap:8px">
           <input class="input" id="banYears" type="number" min="0" step="1" value="0" style="max-width:140px" />
           <select class="input" id="banUnit" aria-label="Единица срока">
             <option value="minutes">Минуты</option>
             <option value="hours">Часы</option>
             <option value="days" selected>Дни</option>
             <option value="years">Годы</option>
           </select>
           <span class="hint" style="align-self:center">0 — бессрочно</span>
         </div>
         <div class="quick-row" id="banQuick">
           <button type="button" class="quick-btn" data-ban-years="0">Бессрочно</button>
           <button type="button" class="quick-btn" data-ban-years="1">1 год</button>
           <button type="button" class="quick-btn" data-ban-years="10">10 лет</button>
           <button type="button" class="quick-btn" data-ban-years="80">80 лет</button>
           <button type="button" class="quick-btn" data-ban-years="500">500 лет</button>
         </div>
       </div>

       <div class="field" style="margin-top:14px">
         <label>Фото на странице бана</label>
         <div class="ban-photo-editor">
           <div class="ban-photo-preview" id="banPhotoPreview"><img src="${escapeHtml(BAN_IMAGE)}" alt="" /></div>
           <div class="grow">
             <div class="row wrap" style="gap:7px">
               <span class="btn btn-sm file-btn">Загрузить своё фото<input type="file" id="banPhotoFile" accept="image/*" /></span>
               <button class="btn btn-sm btn-ghost" id="banPhotoReset" type="button">Стандартное</button>
             </div>
             <input class="input" id="banPhotoUrl" placeholder="или ссылка https://…" style="margin-top:8px" autocomplete="off" />
             <div class="hint" style="margin-top:6px">Пусто — используется стандартная картинка CharMsg.</div>
           </div>
         </div>
       </div>

       <div class="error-text" id="banError"></div>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-close type="button">Отмена</button>
         <button class="btn btn-danger" id="banSubmit" type="button">Забанить</button>
       </div>`,
      { className: "ban-modal" }
    );

    const body = modal.body;
    const preview = body.querySelector("#banPhotoPreview");
    const urlInput = body.querySelector("#banPhotoUrl");
    const durationInput = body.querySelector("#banYears");
    const unitInput = body.querySelector("#banUnit");

    const paintPreview = () => {
      const src = banImage || BAN_IMAGE;
      preview.innerHTML = `<img src="${escapeHtml(src)}" alt="" />`;
    };
    paintPreview();

    body.querySelector("#banQuick").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ban-years]");
      if (!btn) return;
      durationInput.value = btn.dataset.banYears;
      unitInput.value = "years";
    });

    body.querySelector("#banPhotoFile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        banImage = await imageFileToDataUrl(file, { maxW: 1200, maxH: 800, quality: 0.82 });
        urlInput.value = "";
        paintPreview();
      } catch (err) {
        toast(err.message || "Не удалось обработать фото", "error");
      } finally {
        e.target.value = "";
      }
    });

    urlInput.addEventListener("input", () => {
      const value = urlInput.value.trim();
      if (!value) {
        banImage = "";
        paintPreview();
        return;
      }
      if (/^https:\/\//i.test(value)) {
        banImage = value;
        paintPreview();
      }
    });

    body.querySelector("#banPhotoReset").addEventListener("click", () => {
      banImage = "";
      urlInput.value = "";
      paintPreview();
    });

    body.querySelector("#banSubmit").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errorEl = body.querySelector("#banError");
      errorEl.textContent = "";
      btn.disabled = true;
      btn.textContent = "Баним…";
      try {
        await adminBanUser(uid, {
          mode: body.querySelector("#banMode").value,
          reason: body.querySelector("#banReason").value,
          duration: Number(durationInput.value),
          unit: unitInput.value,
          image: urlInput.value.trim() || banImage
        });
        modal.close();
        toast("Пользователь забанен", "success");
        await loadUsers();
        void loadStats();
      } catch (err) {
        errorEl.textContent = err.message || "Не удалось забанить пользователя";
        btn.disabled = false;
        btn.textContent = "Забанить";
      }
    });
  }

  function openPasswordModal(uid, nick) {
    const modal = openModal(`
      <button class="modal-close" data-close aria-label="Закрыть">×</button>
      <h3 class="modal-title">Пароль игрока ${escapeHtml(nick)}</h3>
      <p class="modal-sub">Если у игрока уже есть логин, он сохранится. Для анонимного игрока укажите новый логин.</p>
      <form>
        <div class="field"><label for="adminPlayerLogin">Логин для анонимного игрока</label>
          <input class="input" id="adminPlayerLogin" name="login" maxlength="24" autocomplete="off" /></div>
        <div class="field"><label for="adminPlayerPassword">Новый пароль</label>
          <input class="input" id="adminPlayerPassword" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required /></div>
        <p class="error-text" role="alert"></p>
        <button class="btn btn-primary btn-block" type="submit">Сохранить пароль</button>
      </form>`);
    const form = modal.body.querySelector("form");
    const submit = form.querySelector("button");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const { login } = await adminSetPlayerPassword(uid, {
          login: form.elements.login.value, password: form.elements.password.value
        });
        form.reset();
        modal.close();
        toast(`Пароль сохранён. Логин игрока: ${login}`, "success", 9000);
      } catch (error) {
        form.querySelector('[role="alert"]').textContent = error.message;
        submit.disabled = false;
      }
    });
  }

  $("usersBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const uid = btn.dataset.uid;
    const action = btn.dataset.action;
    const user = users.find((u) => (u.uid || u.id) === uid);
    if (uid === state.uid && (action === "delete" || action === "ban")) {
      toast("Нельзя применить это действие к самому себе", "error");
      return;
    }
    if (action === "password") {
      openPasswordModal(uid, user?.nick || uid);
      return;
    }
    try {
      if (action === "ban") {
        if (btn.dataset.banned === "1") {
          const ok = await confirmDialog("Разблокировать?", `Пользователь ${user?.nick || uid} снова получит доступ к CharMsg.`, "Разблокировать");
          if (!ok) return;
          await adminUnbanUser(uid);
          toast("Пользователь разблокирован", "success");
        } else {
          openBanModal(user || { uid, nick: uid });
          return;
        }
      } else if (action === "verify") {
        const next = btn.dataset.verified !== "1";
        await adminSetVerified(uid, next);
        toast(next ? "Пользователь верифицирован — закрытый чат открыт" : "Верификация снята", "success");
      } else if (action === "coins") {
        await adminGrantCoins(uid, 100);
        toast("Начислено 100 CR", "success");
      } else if (action === "delete") {
        const ok = await confirmDialog("Удалить профиль?", `Профиль ${user?.nick || uid} будет удалён. Сообщения в чатах останутся.`, "Удалить", true);
        if (!ok) return;
        await adminDeleteUser(uid);
        toast("Профиль удалён", "success");
      }
      await loadUsers();
      void loadStats();
    } catch (err) {
      toast(err.message || "Действие не выполнено", "error");
    }
  });

  $("usersBody").addEventListener("change", async (e) => {
    const gradient = e.target.closest("[data-gradient]");
    if (gradient) {
      gradient.disabled = true;
      try {
        await adminSetNickGradient(gradient.dataset.gradient, gradient.value);
        toast("Градиент ника обновлён", "success");
        await loadUsers();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        gradient.disabled = false;
      }
      return;
    }
    const select = e.target.closest("[data-rank]");
    if (!select) return;
    const uid = select.dataset.rank;
    try {
      await adminSetRank(uid, Number(select.value));
      toast("Ранг обновлён", "success");
      await loadUsers();
    } catch (err) {
      toast(err.message || "Не удалось выдать ранг", "error");
    }
  });

  $("roomsList").addEventListener("click", async (e) => {
    const clearBtn = e.target.closest("[data-room-clear]");
    const deleteBtn = e.target.closest("[data-room-delete]");
    if (clearBtn) {
      const id = clearBtn.dataset.roomClear;
      const ok = await confirmDialog("Очистить чат?", "Все сообщения комнаты будут удалены, сам чат останется.", "Очистить", true);
      if (!ok) return;
      try {
        const n = await adminPurgeChat(id);
        toast(`Удалено сообщений: ${n}`, "success");
        void loadStats();
      } catch (err) {
        toast(err.message || "Не удалось очистить", "error");
      }
    }
    if (deleteBtn) {
      const id = deleteBtn.dataset.roomDelete;
      const ok = await confirmDialog("Удалить чат?", "Чат и все его сообщения исчезнут для всех пользователей.", "Удалить чат", true);
      if (!ok) return;
      try {
        await deleteChat(id);
        toast("Чат удалён", "success");
        void loadStats();
      } catch (err) {
        toast(err.message || "Не удалось удалить чат", "error");
      }
    }
  });

  $("purgeAllBtn").addEventListener("click", async () => {
    const ok = await confirmDialog("Очистить просроченные?", "Будут удалены все сообщения, срок жизни которых уже истёк.", "Очистить");
    if (!ok) return;
    try {
      const n = await adminPurgeExpired(state.chats);
      toast(`Удалено просроченных сообщений: ${n}`, "success");
      void loadStats();
    } catch (err) {
      toast(err.message || "Ошибка очистки", "error");
    }
  });

  $("setPriceBtn").addEventListener("click", async () => {
    const value = Number($("setPriceInput").value);
    if (!(value > 0)) return toast("Введите цену больше нуля", "error");
    try {
      await adminSetPrice(value);
      toast("Цена обновлена", "success");
      $("setPriceInput").value = "";
    } catch (err) {
      toast(err.message || "Не удалось обновить цену", "error");
    }
  });

  $("setLiqBtn").addEventListener("click", async () => {
    const value = Number($("setLiqInput").value);
    if (!(value >= 1000)) return toast("Ликвидность не меньше 1000", "error");
    try {
      await adminSetLiquidity(value);
      toast("Ликвидность обновлена", "success");
      $("setLiqInput").value = "";
    } catch (err) {
      toast(err.message || "Не удалось обновить ликвидность", "error");
    }
  });

  $("toggleBotsBtn").addEventListener("click", async () => {
    try {
      const next = state.market?.bots === false;
      await adminSetBots(next);
      toast(next ? "Боты включены" : "Боты выключены", "success");
    } catch (err) {
      toast(err.message || "Не удалось переключить ботов", "error");
    }
  });

  $("resetMarketBtn").addEventListener("click", async () => {
    const ok = await confirmDialog("Сбросить рынок?", "Цена вернётся к 100 CR, история графика очистится. Балансы пользователей не изменятся.", "Сбросить", true);
    if (!ok) return;
    try {
      await adminResetMarket();
      toast("Рынок сброшен к 100", "success");
    } catch (err) {
      toast(err.message || "Не удалось сбросить рынок", "error");
    }
  });

  $("broadcastText").addEventListener("input", (e) => {
    $("broadcastCount").textContent = `${e.target.value.length} / 1500`;
  });

  $("adminEventForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { title, message, hours, bonus } = form.elements;
      await runAction("startEvent", { title: title.value, message: message.value, hours: Number(hours.value), bonus: Number(bonus.value) });
      toast("Ивент запущен", "success");
    } catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; }
  };
  $("stopEventBtn").onclick = async () => {
    if (!await confirmDialog("Завершить ивент?", "Игроки больше не смогут забрать его награду.", "Завершить")) return;
    try {
      await runAction("stopEvent");
      toast("Ивент завершён", "success");
    } catch (error) { toast(error.message, "error"); }
  };

  $("broadcastBtn").addEventListener("click", async () => {
    const text = $("broadcastText").value.trim();
    if (!text) return toast("Введите текст рассылки", "error");
    const ok = await confirmDialog("Отправить рассылку?", `Сообщение уйдёт во все публичные чаты (${state.chats.filter((c) => c.isPublic).length}).`, "Отправить");
    if (!ok) return;
    try {
      const n = await adminBroadcast(state.chats, state.profile, text);
      $("broadcastText").value = "";
      $("broadcastCount").textContent = "0 / 1500";
      toast(`Отправлено в ${n} ${plural(n, "чат", "чата", "чатов")}`, "success");
    } catch (err) {
      toast(err.message || "Не удалось отправить", "error");
    }
  });

  $("adminRefresh").addEventListener("click", async () => {
    await Promise.allSettled([loadUsers(), loadStats()]);
    renderRooms();
    refreshMarketPanel();
    toast("Обновлено", "success");
  });

  $("adminLogout").addEventListener("click", async () => {
    const ok = await confirmDialog("Выйти из админки?", "Вы вернётесь к анонимной личности на этом устройстве.", "Выйти");
    if (!ok) return;
    await adminLogout();
    location.reload();
  });

  // seed admin profile on server if missing (ensures shimmer identity exists)
  loadUsers();
  loadStats();
  refreshAll();

  const unsub = onChange(refreshAll);
  return () => unsub();
}
