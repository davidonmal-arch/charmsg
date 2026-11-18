import { runAction } from "../db.js";
import { state } from "../state.js";
import { openModal, openProfileModal } from "../ui.js";
import { escapeHtml, nickWithClan, toast } from "../util.js";

const themes = { plum: "Слива", ocean: "Океан", emerald: "Изумруд", amber: "Янтарь" };
const businessNames = { shop: "Магазин", factory: "Завод", company: "Компания" };

export function setTheme(value) {
  document.documentElement.dataset.theme = Object.hasOwn(themes, value) ? value : "plum";
  localStorage.setItem("charmsg_theme", document.documentElement.dataset.theme);
}

export const communityProfileHtml = `
  <div class="card card-pad stack">
    <h2 class="section-title">Юзернейм и клан</h2>
    <form class="row wrap" id="usernameForm">
      <label class="field grow">Юзернейм для поиска<input class="input" name="username" placeholder="@username" maxlength="25" required></label>
      <button class="btn btn-sm" type="submit">Сохранить</button>
    </form>
    <p class="hint" id="clanStatus">Клан не выбран</p>
    <div class="row wrap">
      <button class="btn btn-sm" id="createClan" type="button">Создать клан</button>
      <button class="btn btn-sm" id="joinClan" type="button">Вступить по тегу</button>
      <button class="btn btn-sm" id="leaveClan" type="button" hidden>Выйти из клана</button>
    </div>
    <button class="btn btn-sm" id="findPlayer" type="button">Найти игрока</button>
  </div>
  <div class="card card-pad stack">
    <h2 class="section-title">Бизнесы и настройки</h2>
    <button class="btn btn-sm" id="openBusinesses" type="button">Магазин, завод и компания</button>
    <label class="field">Тема<select class="input" id="profileTheme">${Object.entries(themes).map(([id, label]) =>
      `<option value="${id}">${label}</option>`).join("")}</select></label>
    <button class="btn btn-sm" id="claimSetupRewards" type="button">Забрать бонусы настройки</button>
    <p class="hint">По 20 CR один раз за пароль и за уведомления.</p>
  </div>`;

export function openPlayerSearch() {
  const modal = openModal(`
    <button class="modal-close" data-close aria-label="Закрыть">×</button>
    <h3 class="modal-title">Найти игрока</h3>
    <form class="stack">
      <label class="field">Ник или @юзернейм<input class="input" name="search" maxlength="25" required autofocus></label>
      <button class="btn btn-primary" type="submit">Найти</button>
    </form>
    <div class="stack" style="margin-top:12px" data-results aria-live="polite"></div>`);
  const form = modal.body.querySelector("form");
  const list = modal.body.querySelector("[data-results]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const results = await runAction("findPlayer", form.elements.search.value);
      list.innerHTML = results.length ? results.map(({ uid, nick, username, clanTag }) => `<button
        class="btn btn-sm" type="button" data-player="${escapeHtml(uid)}">${escapeHtml(nickWithClan(nick, clanTag))}
        ${username ? `(@${escapeHtml(username)})` : ""}</button>`).join("") : '<p class="hint">Игроки не найдены.</p>';
    } catch (error) {
      list.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  list.addEventListener("click", (event) => {
    const player = event.target.closest("[data-player]");
    if (!player) return;
    modal.close();
    openProfileModal(player.dataset.player);
  });
}

function openClan(action) {
  const create = action === "create";
  const modal = openModal(`
    <button class="modal-close" data-close aria-label="Закрыть">×</button>
    <h3 class="modal-title">${create ? "Создать клан" : "Вступить в клан"}</h3>
    <form class="stack">
      ${create ? '<label class="field">Название<input class="input" name="title" minlength="2" maxlength="40" required></label>' : ""}
      <label class="field">Тег клана<input class="input" name="tag" minlength="2" maxlength="6" pattern="[A-Za-z0-9]{2,6}" required></label>
      <button class="btn btn-primary" type="submit">${create ? "Создать" : "Вступить"}</button>
      <p class="error-text" role="alert"></p>
    </form>`);
  const form = modal.body.querySelector("form");
  const button = form.querySelector("button");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const { clanTag } = await runAction("changeClan", {
        action, tag: form.elements.tag.value, name: form.elements.title?.value
      });
      toast(`Ваш клан: [${clanTag}]`, "success");
      modal.close();
    } catch (error) {
      form.querySelector('[role="alert"]').textContent = error.message;
      button.disabled = false;
    }
  });
}

function openBusinesses() {
  const modal = openModal(`
    <button class="modal-close" data-close aria-label="Закрыть">×</button>
    <h3 class="modal-title">Пассивный доход</h3>
    <p class="modal-sub">Бизнесы работают и офлайн. После поломки доход останавливается до ремонта.</p>
    <div class="stack" data-business-list></div>
    <p class="error-text" role="alert"></p>
    <button class="btn btn-sm" data-business-action="status" type="button">Обновить</button>`);
  const list = modal.body.querySelector("[data-business-list]");
  const errorLine = modal.body.querySelector('[role="alert"]');
  let busy = false;
  async function load(action, type) {
    if (busy) return;
    busy = true;
    errorLine.textContent = "";
    try {
      const items = await runAction("manageBusiness", { action, type });
      list.innerHTML = Object.entries(items).map(([key, item]) => `
        <div class="card card-pad stack">
          <strong>${businessNames[key]}</strong>
          <span class="hint">${item.hourly} CR/час · ${item.owned ? (item.broken ? "сломан" : "работает") : "не куплен"}</span>
          <div class="row wrap">
          ${item.owned ? `<button class="btn btn-sm" data-type="${key}" data-business-action="collect" ${item.accrued ? "" : "disabled"}>Забрать ${item.accrued} CR</button>
            ${item.broken ? `<button class="btn btn-sm" data-type="${key}" data-business-action="repair">Починить за ${item.repair} CR</button>` : ""}`
            : `<button class="btn btn-sm btn-primary" data-type="${key}" data-business-action="buy">Купить за ${item.buy} CR</button>`}
          </div>
        </div>`).join("");
    } catch (error) {
      errorLine.textContent = error.message;
    } finally {
      busy = false;
    }
  }
  modal.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-business-action]");
    if (button) load(button.dataset.businessAction, button.dataset.type);
  });
  load("status");
}

export function wireCommunityProfile(container) {
  const $ = (id) => container.querySelector("#" + id);
  $("profileTheme").value = document.documentElement.dataset.theme || "plum";
  $("profileTheme").onchange = (event) => setTheme(event.target.value);
  $("findPlayer").onclick = openPlayerSearch;
  $("openBusinesses").onclick = openBusinesses;
  $("createClan").onclick = () => openClan("create");
  $("joinClan").onclick = () => openClan("join");
  $("leaveClan").onclick = async () => {
    try {
      await runAction("changeClan", { action: "leave" });
      toast("Вы вышли из клана", "success");
    } catch (error) { toast(error.message, "error"); }
  };
  $("usernameForm").onsubmit = async (event) => {
    event.preventDefault();
    try {
      const { username } = await runAction("setUsername", event.currentTarget.elements.username.value);
      toast(`Юзернейм @${username} сохранён`, "success");
    } catch (error) { toast(error.message, "error"); }
  };
  $("claimSetupRewards").onclick = async () => {
    try {
      const { reward } = await runAction("claimSetupRewards");
      toast(reward ? `Бонус за настройку: +${reward} CR` : "Новых бонусов пока нет", reward ? "success" : "info");
    } catch (error) { toast(error.message, "error"); }
  };
  let username;
  return () => {
    const profile = state.profile;
    if (!profile) return;
    if (username !== profile.username) {
      username = profile.username;
      $("usernameForm").elements.username.value = username ? "@" + username : "";
    }
    $("clanStatus").textContent = profile.clanTag ? `[${profile.clanTag}] ${profile.clanName || ""}` : "Клан не выбран";
    $("createClan").hidden = $("joinClan").hidden = !!profile.clanTag;
    $("leaveClan").hidden = !profile.clanTag;
  };
}
