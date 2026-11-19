import { runAction } from "../db.js";
import { state } from "../state.js";
import { openModal, confirmDialog } from "../ui.js";
import { escapeHtml as esc, fmtNum, safeUrl, toast } from "../util.js";

const tabs = { offers: "Офферы", collections: "Коллекции", quests: "Квесты", history: "История операций", logs: "Логи администрации" };
const statuses = { open: "Открыт", accepted: "Обмен завершён", cancelled: "Отменён" };
const names = { createOffer: "Создание оффера", acceptOffer: "Обмен", cancelOffer: "Отмена оффера", claimQuest: "Квест", buyNft: "Покупка NFT", giftNft: "Передача NFT", enhanceNft: "Улучшение NFT", trade: "Сделка CHR", spinRoulette: "Рулетка", playUpgrade: "Апгрейдер", playClicker: "Кликер", claimDailyReward: "Ежедневная награда", clientData: "Изменение данных", manageBusiness: "Бизнес" };
const fieldNames = { coins: "Баланс CR", chr: "CHR", ownerUid: "Владелец", ownerNick: "Ник владельца", rank: "Ранг", banned: "Блокировка", banReason: "Причина", banUntil: "Бан до", forSale: "На продаже", price: "Цена", status: "Статус", name: "Название", title: "Название" };
const date = value => new Date(Number(value)).toLocaleString("ru-RU");
const side = (items, coins) => [coins ? fmtNum(coins) + " CR" : "", ...items.map(nft => nft.name + (nft.number ? " #" + nft.number : "") + " · " + nft.id)].filter(Boolean).join(", ");

export function mountEconomy(container) {
  const route = state.route;
  let alive = true, next = null, mode = "open", offers = [], entries = [], generation = 0, timer;
  container.innerHTML = '<div class="page-head"><h1 class="page-title">' + tabs[route] + '</h1><button class="btn btn-sm" id="refreshEconomy">Обновить</button></div>'
    + '<nav class="economy-tabs" aria-label="Экономика"><a class="btn btn-sm" href="#/nfts">NFT</a>'
    + Object.entries(tabs).filter(([key]) => key !== "logs" || state.admin).map(([key, label]) =>
      '<a class="btn btn-sm ' + (key === route ? "btn-primary" : "") + '" href="#/' + key + '"' + (key === route ? ' aria-current="page"' : "") + '>' + label + '</a>').join("")
    + '</nav>'
    + (route === "offers" ? '<div class="row wrap economy-tools"><button class="btn btn-primary" id="newOffer">Создать оффер</button><label class="field">Показать<select class="input" id="offerMode"><option value="open">Все открытые</option><option value="mine">Мои офферы и обмены</option></select></label><p class="hint">CR и NFT резервируются до принятия или отмены. До 5 NFT с каждой стороны.</p></div>' : "")
    + '<p id="economyError" class="error-text" role="alert"></p><div id="economyContent" class="stack" aria-live="polite">Загрузка…</div><button class="btn economy-more" id="moreEconomy" hidden>Показать ещё</button>';
  const content = container.querySelector("#economyContent"), error = container.querySelector("#economyError"), more = container.querySelector("#moreEconomy");
  function renderOffers() {
    content.innerHTML = offers.length ? offers.map(offer => '<article class="card card-pad stack"><div class="row-between"><b>' + esc(offer.creatorNick)
      + '</b><span class="badge">' + (statuses[offer.status] || "Закрыт") + '</span></div>'
      + '<div><span class="hint">Автор отдаёт</span><p>' + esc(side(offer.give, offer.giveCr)) + '</p></div>'
      + '<div><span class="hint">Автор получает</span><p>' + esc(side(offer.take, offer.takeCr)) + '</p></div>'
      + '<span class="hint">' + esc(date(offer.createdAt)) + '</span>'
      + (offer.status === "open" ? '<div class="row wrap">'
        + (offer.creatorUid !== state.uid ? '<button class="btn btn-primary" data-accept="' + esc(offer.id) + '">Принять обмен</button>' : "")
        + (offer.creatorUid === state.uid || state.admin ? '<button class="btn" data-cancel="' + esc(offer.id) + '">Отменить и вернуть резерв</button>' : "") + '</div>' : "")
      + '</article>').join("") : '<p class="hint">Офферов пока нет.</p>';
  }
  function renderActivity() {
    content.innerHTML = entries.length ? entries.map(entry => {
      const before = entry.old_value || {}, after = entry.new_value || {};
      const delta = entry.document_path === "users/" + state.uid && typeof after.coins === "number" && typeof before.coins === "number" ? after.coins - before.coins : null;
      const details = Object.keys({ ...before, ...after }).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .map(key => (fieldNames[key] || key) + " · " + (before[key] ?? "—") + " → " + (after[key] ?? "—")).join(" · ");
      return '<article class="card card-pad stack"><div class="row-between"><b>' + esc(names[entry.action] || entry.action) + '</b>'
        + (delta !== null ? '<span>' + (delta > 0 ? "+" : "") + fmtNum(delta) + ' CR</span>' : "") + '</div>'
        + '<span class="hint">' + esc(date(entry.ts)) + ' · ' + esc(entry.document_path) + '</span>'
        + (route === "logs" ? '<span class="hint">Участник ' + esc(entry.actor_uid) + '</span>' : "")
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
    const inventory = await runAction("tradeInventory");
    if (!alive) return;
    const { body, close } = openModal('<h2 class="modal-title">Новый оффер</h2><form class="stack" id="offerForm">'
      + '<label class="field">Отдаю CR<input class="input" name="giveCr" type="number" min="0" max="100000" step="0.01" value="0" required></label>'
      + '<fieldset class="field"><legend>Мои NFT</legend><div class="offer-assets">'
      + inventory.map(nft => '<label><input type="checkbox" name="giveIds" value="' + esc(nft.id) + '"><span>' + esc(nft.name) + ' · ' + esc(nft.id) + '</span></label>').join("") + '</div></fieldset>'
      + '<label class="field">Хочу CR<input class="input" name="takeCr" type="number" min="0" max="100000" step="0.01" value="0" required></label>'
      + '<label class="field">Хочу NFT — ID через запятую<input class="input" name="takeIds" placeholder="ID из карточки NFT" maxlength="810"></label>'
      + '<p class="hint">Отметь NFT, которые отдаёшь. NFT из запроса должны принадлежать одному игроку и быть сняты с продажи.</p>'
      + '<p class="error-text" id="offerError" role="alert"></p><button class="btn btn-primary" type="submit">Подтвердить условия и зарезервировать</button></form>');
    const requestId = crypto.randomUUID();
    body.querySelector("#offerForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        await runAction("createOffer", {
          requestId,
          giveIds: new FormData(form).getAll("giveIds"),
          giveCr: Number(form.elements.giveCr.value), takeCr: Number(form.elements.takeCr.value),
          takeIds: form.elements.takeIds.value.split(",").map(value => value.trim()).filter(Boolean)
        });
        close(); toast("Оффер опубликован", "success"); await load();
      } catch (failure) { body.querySelector("#offerError").textContent = failure.message; }
      finally { button.disabled = false; }
    });
  }
  const click = async event => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    try {
      if (button.id === "newOffer") return await openOffer();
      if (button.id === "refreshEconomy") return await load();
      if (button.id === "moreEconomy") return await load(true);
      if (button.dataset.accept) {
        const offer = offers.find(offer => offer.id === button.dataset.accept);
        if (!offer || !await confirmDialog("Подтвердить обмен?", "Ты отдаёшь " + side(offer.take, offer.takeCr) + ". Получаешь " + side(offer.give, offer.giveCr) + ".", "Обменять")) return;
        button.disabled = true; await runAction("acceptOffer", offer.id); toast("Обмен завершён", "success");
      } else if (button.dataset.cancel) {
        if (!await confirmDialog("Отменить оффер?", "Зарезервированные CR и NFT вернутся автору.", "Отменить оффер")) return;
        button.disabled = true; await runAction("cancelOffer", button.dataset.cancel);
      } else if (button.dataset.claim) {
        button.disabled = true; await runAction("claimQuest", button.dataset.claim); toast("Награда получена", "success");
      } else return;
      await load();
    } catch (failure) { if (alive) toast(failure.message, "error"); }
    finally { button.disabled = false; }
  };
  container.addEventListener("click", click);
  container.querySelector("#offerMode")?.addEventListener("change", event => { mode = event.target.value; load(); });
  load();
  const poll = async () => {
    if (alive && !document.hidden && route === "offers") await load();
    if (alive) timer = setTimeout(poll, 30_000);
  };
  timer = setTimeout(poll, 30_000);
  return () => { alive = false; clearTimeout(timer); container.removeEventListener("click", click); };
}
