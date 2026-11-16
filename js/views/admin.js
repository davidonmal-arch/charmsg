import { state, onChange } from "../state.js";
import { confirmDialog } from "../ui.js";
import {
  ADMIN_LOGIN,
  adminBroadcast,
  adminDeleteUser,
  adminGrantCoins,
  adminListUsers,
  adminLogin,
  adminLogout,
  adminPurgeChat,
  adminPurgeExpired,
  adminResetMarket,
  adminSetBanned,
  adminSetBots,
  adminSetLiquidity,
  adminSetPrice,
  adminStats,
  deleteChat
} from "../store.js";
import {
  avatarData,
  escapeHtml,
  fmtNum,
  fmtRelative,
  nickHtml,
  plural,
  ttlShort,
  toast
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
          <thead><tr><th>Пользователь</th><th>CR</th><th>CHR</th><th>Сообщений</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody id="usersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
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
  const panelFor = (name) => container.querySelector(`[data-panel="${name}"]`);

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
      body.innerHTML = `<tr><td colspan="6" class="muted">Пользователей пока нет.</td></tr>`;
      $("usersCount").textContent = "0";
      return;
    }
    $("usersCount").textContent = String(users.length);
    body.innerHTML = users
      .map((u) => {
        const uid = u.uid || u.id;
        return `<tr>
          <td><div class="user-cell">${avatarData(u.nick, u.avatar, 28)}<div><div class="${u.isAdmin ? "nick-admin" : "nick"}">${escapeHtml(u.nick || "Аноним")}</div><div class="hint" style="font-size:9px">${escapeHtml(uid)}</div></div></div></td>
          <td class="mono">${fmtNum(u.coins || 0, 1)}</td>
          <td class="mono">${fmtNum(u.chr || 0, 3)}</td>
          <td class="mono">${fmtNum(u.msgCount || 0)}</td>
          <td>${u.banned ? '<span class="badge" style="color:#e0a6bf">забанен</span>' : '<span class="badge">активен</span>'}</td>
          <td><div class="table-actions">
            <button class="btn btn-sm" data-action="ban" data-uid="${escapeHtml(uid)}" data-banned="${u.banned ? "1" : "0"}">${u.banned ? "Разбан" : "Бан"}</button>
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
      ["users", "content", "market", "broadcast"].forEach((name) => panelFor(name).classList.toggle("hidden", name !== activeTab));
      if (activeTab === "users") loadUsers();
      if (activeTab === "content") renderRooms();
      if (activeTab === "market") refreshMarketPanel();
    });
  });

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
    try {
      if (action === "ban") {
        const next = btn.dataset.banned !== "1";
        await adminSetBanned(uid, next);
        toast(next ? "Пользователь заблокирован" : "Пользователь разблокирован", "success");
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
    adminLogout();
    location.reload();
  });

  // seed admin profile on server if missing (ensures shimmer identity exists)
  loadUsers();
  loadStats();
  refreshAll();

  const unsub = onChange(refreshAll);
  return () => unsub();
}
