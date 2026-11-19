import { runAction } from "../db.js?v=instant-20261119";
import { state } from "../state.js?v=instant-20261119";
import { effectClass } from "../store.js?v=instant-20261119";
import { openModal, confirmDialog } from "../ui.js?v=instant-20261119";
import { escapeHtml as esc, fmtNum, safeUrl, toast } from "../util.js?v=instant-20261119";

const tabs = { offers: "Обмены", collections: "Коллекции", quests: "Квесты", history: "История операций", logs: "Логи администрации" };
const statuses = { open: "Ждёт ответа", accepted: "Обмен завершён", cancelled: "Отменён", declined: "Отклонён" };
const names = { createOffer: "Создание оффера", acceptOffer: "Обмен", cancelOffer: "Отмена оффера", claimQuest: "Квест", buyNft: "Покупка NFT", giftNft: "Передача NFT", enhanceNft: "Улучшение NFT", trade: "Сделка CHR", spinRoulette: "Рулетка", playUpgrade: "Апгрейдер", playClicker: "Кликер", claimDailyReward: "Ежедневная награда", clientData: "Изменение данных", manageBusiness: "Бизнес" };
const fieldNames = { coins: "Баланс CR", chr: "CHR", ownerUid: "Владелец", ownerNick: "Ник владельца", rank: "Ранг", banned: "Блокировка", banReason: "Причина", banUntil: "Бан до", forSale: "На продаже", price: "Цена", status: "Статус", name: "Название", title: "Название" };
const date = value => new Date(Number(value)).toLocaleString("ru-RU");
const side = (items, coins) => [coins ? fmtNum(coins) + " CR" : "", ...items.map(nft => nft.name + (nft.number ? " #" + nft.number : ""))].filter(Boolean).join(", ");

export function mountEconomy(container) {
  const route = state.route;
  const pendingOffers = new Set();
  let alive = true, next = null, mode = "inbox", offers = [], entries = [], generation = 0, timer;
  container.innerHTML = '<div class="page-head"><h1 class="page-title">' + tabs[route] + '</h1><button class="btn btn-sm" id="refreshEconomy">Обновить</button></div>'
    + '<nav class="section-links" aria-label="Раздел">'
    + Object.entries(route === "offers" || route === "collections" ? { nfts: "Магазин", offers: "Обмены", collections: "Коллекции" }
      : route === "quests" ? { games: "Игры", quests: "Задания" }
        : route === "logs" ? { admin: "Админка", logs: "Журнал" } : { profile: "Профиль", history: "История" }).map(([key, label]) =>
      '<a href="#/' + key + '"' + (key === route ? ' aria-current="page"' : "") + '>' + label + '</a>').join("")
    + '</nav>'
    + (route === "offers" ? '<div class="row wrap economy-tools"><button class="btn btn-primary" id="newOffer">Предложить обмен</button><label class="field">Показать<select class="input" id="offerMode"><option value="inbox">Мне предложили</option><option value="mine">Мои обмены</option><option value="open">Общий рынок</option></select></label><p class="hint">Выбери игрока и предметы. До подтверждения обмена всё остаётся в резерве.</p></div>' : "")
    + '<p id="economyError" class="error-text" role="alert"></p><div id="economyContent" class="stack" aria-live="polite">Загрузка…</div><button class="btn economy-more" id="moreEconomy" hidden>Показать ещё</button>';
  const content = container.querySelector("#economyContent"), error = container.querySelector("#economyError"), more = container.querySelector("#moreEconomy");
  function renderOffers() {
    const cards = (items, coins) => '<div class="offer-items">'
      + (coins ? '<div class="offer-money"><b>' + fmtNum(coins) + '</b><span>CR</span></div>' : "")
      + items.map(nft => '<div class="offer-item"><div class="offer-art ' + effectClass(nft.effect) + '">'
        + (safeUrl(nft.image || "") ? '<img src="' + esc(safeUrl(nft.image)) + '" alt="" loading="lazy">' : '<span aria-hidden="true">◈</span>')
        + '</div><span>' + esc(nft.name) + (nft.number ? ' #' + nft.number : "") + '</span></div>').join("") + '</div>';
    content.innerHTML = offers.length ? offers.map(offer => {
      const mine = offer.creatorUid === state.uid;
      const incoming = offer.recipientUid === state.uid;
      return '<article class="card card-pad stack trade-offer" id="offer-' + esc(offer.id) + '"><div class="row-between"><div><b>'
        + (mine ? "Твоё предложение" : esc(offer.creatorNick) + " предлагает обмен")
        + '</b><p class="hint">' + (mine ? esc(offer.recipientNick || "Общий рынок") + " · " : "") + esc(date(offer.createdAt)) + '</p></div><span class="badge">' + (pendingOffers.has(offer.id) ? "Подтверждаем…" : statuses[offer.status] || "Закрыт") + '</span></div>'
        + '<div class="offer-sides"><section><h2 class="offer-side-title">' + (mine ? "Ты отдаёшь" : "Ты получишь") + '</h2>' + cards(offer.give, offer.giveCr)
        + '</section><section><h2 class="offer-side-title">' + (mine ? "Хочешь получить" : "Ты отдашь") + '</h2>' + cards(offer.take, offer.takeCr) + '</section></div>'
        + (offer.status === "open" && !pendingOffers.has(offer.id) ? '<div class="row wrap">'
          + (!mine ? '<button class="btn btn-primary" data-accept="' + esc(offer.id) + '">Принять обмен</button>' : "")
          + (mine || incoming || state.admin ? '<button class="btn" data-cancel="' + esc(offer.id) + '">' + (incoming && !mine ? "Отклонить" : "Отменить предложение") + '</button>' : "") + '</div>' : "")
        + '</article>';
    }).join("") : '<div class="card card-pad stack"><h2 class="section-title">' + (mode === "inbox" ? "Новых предложений нет" : "Обменов пока нет")
      + '</h2><p class="hint">Нажми «Предложить обмен», выбери игрока и нужные NFT.</p></div>';
    const highlighted = new URLSearchParams(location.hash.split("?")[1]).get("offer");
    if (highlighted) document.getElementById("offer-" + highlighted)?.classList.add("offer-highlight");
  }
  function renderActivity() {
    content.innerHTML = entries.length ? entries.map(entry => {
      const before = entry.old_value || {}, after = entry.new_value || {};
      const delta = entry.document_path === "users/" + state.uid && typeof after.coins === "number" && typeof before.coins === "number" ? after.coins - before.coins : null;
      const details = Object.keys({ ...before, ...after }).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .filter(key => key !== "ownerUid" || !after.ownerNick)
        .map(key => (fieldNames[key] || key) + " · " + (typeof before[key] === "boolean" ? (before[key] ? "Да" : "Нет") : before[key] ?? "—") + " → " + (typeof after[key] === "boolean" ? (after[key] ? "Да" : "Нет") : after[key] ?? "—")).join(" · ");
      return '<article class="card card-pad stack"><div class="row-between"><b>' + esc(names[entry.action] || entry.action) + '</b>'
        + (delta !== null ? '<span>' + (delta > 0 ? "+" : "") + fmtNum(delta) + ' CR</span>' : "") + '</div>'
        + '<span class="hint">' + esc(date(entry.ts)) + ' · ' + esc(entry.document_path.startsWith("nfts/") ? "NFT" : entry.document_path.startsWith("users/") ? "Баланс и профиль" : entry.document_path.startsWith("offers/") ? "Обмен" : "Операция") + '</span>'
        + (route === "logs" ? '<span class="hint">Участник ' + esc(state.users.get(entry.actor_uid)?.nick || "Игрок") + '</span>' : "")
        + '<p class="operation-details">' + esc(details) + '</p></article>';
    }).join("") : '<p class="hint">Операций пока нет. История записывается с момента этого обновления.</p>';
  }
  async function load(append = false) {
    const version = ++generation;
    error.textContent = "";
    try {
      if (route === "offers") {
        const result = await runAction("listOffers", mode, append ? next : null);
        if (!alive || generation !== version) return;
        const highlighted = new URLSearchParams(location.hash.split("?")[1]).get("offer");
        if (!append && highlighted && !result.offers.some(offer => offer.id === highlighted)) {
          const selected = await runAction("getOffer", highlighted);
          if (!alive || generation !== version) return;
          result.offers.unshift(selected);
        }
        offers = append ? [...offers, ...result.offers.filter(item => !offers.some(existing => existing.id === item.id))] : result.offers;
        next = result.next;
        renderOffers();
      } else if (route === "history" || route === "logs") {
        const result = await runAction("listActivity", route === "logs", append ? next : null);
        if (!alive || generation !== version) return;
        entries = append ? [...entries, ...result.entries] : result.entries;
        next = result.next;
        renderActivity();
      } else if (route === "quests") {
        const quests = await runAction("questStatus");
        if (!alive || generation !== version) return;
        content.innerHTML = quests.map(quest => '<article class="card card-pad stack"><h2 class="section-title">' + esc(quest.title)
          + '</h2><p>' + esc(quest.description) + '</p><div class="row-between"><b>' + fmtNum(quest.reward) + ' CR</b>'
          + '<button class="btn" data-claim="' + quest.id + '"' + (!quest.ready || quest.claimed ? " disabled" : "") + '>'
          + (quest.claimed ? "Получено" : quest.ready ? "Забрать награду" : "Не выполнено") + '</button></div></article>').join("");
      } else {
        const collections = await runAction("collectionStatus");
        if (!alive || generation !== version) return;
        content.innerHTML = collections.length ? collections.map(collection => {
          const total = collection.variants.length, owned = collection.variants.filter(variant => variant.owned).length;
          return '<article class="card card-pad stack"><h2 class="section-title">' + esc(collection.name) + '</h2><p>'
            + owned + ' из ' + total + ' улучшенных вариантов · NFT в инвентаре ' + collection.copies + '</p>'
            + '<progress max="' + Math.max(1, total) + '" value="' + owned + '" aria-label="Прогресс коллекции"></progress><div class="collection-variants">'
            + collection.variants.map(variant => '<div class="collection-variant ' + (variant.owned ? "owned" : "") + '"><img src="' + esc(safeUrl(variant.image) || "")
              + '" alt="Вариант ' + variant.index + '" loading="lazy"><span>Вариант ' + variant.index + ' · ' + (variant.owned ? "Есть" : "Не собран") + '</span></div>').join("") + '</div></article>';
        }).join("") : '<p class="hint">Коллекции появятся после выпуска серии NFT администратором.</p>';
      }
      more.hidden = !next;
    } catch (failure) { if (alive && generation === version) error.textContent = failure.message || "Не удалось загрузить данные"; }
  }
  async function openOffer() {
    const catalog = await runAction("tradeCatalog");
    if (!alive) return;
    const query = new URLSearchParams(location.hash.split("?")[1]);
    const giveIds = new Set(), takeIds = new Set(), requestId = crypto.randomUUID();
    const { body, close } = openModal('<h2 class="modal-title">Предложить обмен</h2><form class="stack" id="offerForm">'
      + '<label class="field">1. Кому предлагаешь обмен<select class="input" name="recipientUid" required><option value="" disabled selected>Выбери игрока</option>'
      + catalog.players.map(player => '<option value="' + esc(player.uid) + '">' + esc(player.nick) + (player.username ? ' · @' + esc(player.username) : "") + '</option>').join("")
      + '<option value="public">Всем — на общий рынок</option></select></label>'
      + '<div class="offer-builder-sides"><section class="stack"><h3>2. Ты отдаёшь</h3>'
      + '<label class="field">CR · у тебя ' + fmtNum(state.profile?.coins || 0) + '<input class="input" name="giveCr" type="number" min="0" max="100000" step="0.01" value="0" required></label>'
      + '<label class="field">Найти свой NFT<input class="input" name="giveSearch" type="search" placeholder="Название NFT"></label><div class="nft-picker" id="givePicker"></div></section>'
      + '<section class="stack"><h3>3. Хочешь получить</h3><label class="field">CR<input class="input" name="takeCr" type="number" min="0" max="100000" step="0.01" value="0" required></label>'
      + '<label class="field">Найти NFT игрока<input class="input" name="takeSearch" type="search" placeholder="Название NFT"></label><div class="nft-picker" id="takePicker"></div></section></div>'
      + '<p class="hint">Нажми на картинки, чтобы выбрать до 5 NFT с каждой стороны. Твои предметы и CR будут в резерве, пока игрок не ответит или ты не отменишь обмен.</p>'
      + '<p class="error-text" id="offerError" role="alert"></p><button class="btn btn-primary" type="submit">Отправить предложение</button></form>', { className: "trade-builder-modal" });
    const form = body.querySelector("#offerForm");
    function renderPicker(kind) {
      const selected = kind === "give" ? giveIds : takeIds;
      const recipient = form.elements.recipientUid.value;
      const search = form.elements[kind + "Search"].value.trim().toLowerCase();
      const items = catalog.nfts.filter(nft => (kind === "give" ? nft.ownerUid === state.uid
        : nft.ownerUid !== state.uid && (recipient === "public" || nft.ownerUid === recipient))
        && (!search || nft.name.toLowerCase().includes(search)));
      body.querySelector("#" + kind + "Picker").innerHTML = items.length ? items.map(nft =>
        '<label class="nft-choice ' + (selected.has(nft.id) ? "selected" : "") + '"><input type="checkbox" data-kind="' + kind + '" value="' + esc(nft.id) + '"' + (selected.has(nft.id) ? " checked" : "") + '>'
        + '<div class="offer-art ' + effectClass(nft.effect) + '">' + (safeUrl(nft.image || "") ? '<img src="' + esc(safeUrl(nft.image)) + '" alt="" loading="lazy">' : '<span>◈</span>')
        + '</div><span>' + esc(nft.name) + (nft.number ? ' #' + nft.number : "") + '</span>'
        + (kind === "take" && recipient === "public" ? '<small>' + esc(nft.ownerNick || "Игрок") + '</small>' : "") + '</label>').join("")
        : '<p class="hint">' + (kind === "take" && !recipient ? "Сначала выбери игрока." : search ? "Ничего не найдено." : "Свободных NFT пока нет.") + '</p>';
    }
    form.addEventListener("input", event => {
      if (event.target.name === "giveSearch") renderPicker("give");
      if (event.target.name === "takeSearch") renderPicker("take");
    });
    form.addEventListener("change", event => {
      const input = event.target;
      if (input.name === "recipientUid") { takeIds.clear(); renderPicker("take"); return; }
      if (!input.dataset.kind) return;
      const selected = input.dataset.kind === "give" ? giveIds : takeIds;
      if (input.checked && selected.size >= 5) { input.checked = false; toast("Можно выбрать до 5 NFT", "error"); return; }
      if (input.checked) selected.add(input.value); else selected.delete(input.value);
      if (input.dataset.kind === "take" && form.elements.recipientUid.value === "public" && input.checked) {
        form.elements.recipientUid.value = catalog.nfts.find(nft => nft.id === input.value).ownerUid;
        renderPicker("take");
      }
      input.closest(".nft-choice")?.classList.toggle("selected", input.checked);
    });
    if (catalog.players.some(player => player.uid === query.get("to"))) {
      form.elements.recipientUid.value = query.get("to");
      const wanted = catalog.nfts.find(nft => nft.id === query.get("nft") && nft.ownerUid === query.get("to"));
      if (wanted) takeIds.add(wanted.id);
    }
    renderPicker("give"); renderPicker("take");
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        await runAction("createOffer", {
          requestId, recipientUid: form.elements.recipientUid.value === "public" ? null : form.elements.recipientUid.value,
          giveIds: [...giveIds], takeIds: [...takeIds], giveCr: Number(form.elements.giveCr.value), takeCr: Number(form.elements.takeCr.value)
        });
        close(); mode = "mine"; container.querySelector("#offerMode").value = mode;
        toast("Предложение отправлено", "success"); await load();
        window.dispatchEvent(new Event("charmsg:offers-changed"));
      } catch (failure) { body.querySelector("#offerError").textContent = failure.message; }
      finally { button.disabled = false; }
    });
  }
  const click = async event => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    let pendingId;
    try {
      if (button.id === "newOffer") return await openOffer();
      if (button.id === "refreshEconomy") return await load();
      if (button.id === "moreEconomy") return await load(true);
      if (button.dataset.accept) {
        const offer = offers.find(offer => offer.id === button.dataset.accept);
        if (!offer || !await confirmDialog("Подтвердить обмен?", "Ты отдаёшь " + side(offer.take, offer.takeCr) + ". Получаешь " + side(offer.give, offer.giveCr) + ".", "Обменять")) return;
        button.disabled = true; pendingId = offer.id; pendingOffers.add(pendingId); renderOffers(); await runAction("acceptOffer", offer.id); toast("Обмен завершён", "success");
      } else if (button.dataset.cancel) {
        const target = offers.find(offer => offer.id === button.dataset.cancel);
        const decline = target?.recipientUid === state.uid;
        if (!await confirmDialog(decline ? "Отклонить обмен?" : "Отменить предложение?", "Предметы и CR вернутся автору.", decline ? "Отклонить" : "Отменить")) return;
        button.disabled = true; pendingId = button.dataset.cancel; pendingOffers.add(pendingId); renderOffers(); await runAction("cancelOffer", pendingId);
      } else if (button.dataset.claim) {
        button.disabled = true; button.textContent = "Забираем…"; await runAction("claimQuest", button.dataset.claim); toast("Награда получена", "success");
      } else return;
      await load();
      window.dispatchEvent(new Event("charmsg:offers-changed"));
    } catch (failure) { if (alive) { toast(failure.message, "error"); if (pendingId) await load(); } }
    finally {
      if (pendingId) { pendingOffers.delete(pendingId); if (alive) renderOffers(); }
      button.disabled = false;
      if (button.dataset.claim && button.isConnected) button.textContent = "Забрать награду";
    }
  };
  container.addEventListener("click", click);
  container.querySelector("#offerMode")?.addEventListener("change", event => { mode = event.target.value; load(); });
  load();
  if (route === "offers" && new URLSearchParams(location.hash.split("?")[1]).has("to")) openOffer().catch(failure => { if (alive) error.textContent = failure.message; });
  const poll = async () => {
    if (alive && !document.hidden && route === "offers") await load();
    if (alive) timer = setTimeout(poll, 30_000);
  };
  timer = setTimeout(poll, 30_000);
  return () => { alive = false; clearTimeout(timer); container.removeEventListener("click", click); };
}
