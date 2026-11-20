import { runAction } from "../db.js?v=instant-20261119";
import { openModal, confirmDialog } from "../ui.js?v=instant-20261119";
import {
  escapeHtml as esc,
  fmtNum,
  toast,
} from "../util.js?v=instant-20261119";

const strategies = {
  trend: "Следование за трендом",
  momentum: "Импульс",
  "mean-reversion": "Возврат к среднему",
};
const statuses = {
  running: "Работает",
  paused: "На паузе",
  stopped: "Остановлен",
  "risk-stopped": "Остановлен риском",
};
const cash = (value) => fmtNum((Number(value) || 0) / 100) + " $";
const fields = [
  ["initialUsd", "Начальный баланс, $", 100, 1e6, 100],
  ["maxTradeUsd", "Максимум сделки, $", 10, 1e5, 10],
  ["maxPositionUsd", "Максимум позиции, $", 10, 1e5, 10],
  ["maxPositions", "Открытых позиций", 1, 10, 1],
  ["riskPct", "Доля баланса на вход, %", 0.1, 100, 0.1],
  ["intervalSeconds", "Анализ каждые, сек", 15, 3600, 1],
  ["takeProfitPct", "Зафиксировать прибыль, %", 0.1, 100, 0.1],
  ["stopLossPct", "Стоп-лосс, %", 0.1, 50, 0.1],
  ["maxDrawdownPct", "Максимальная просадка, %", 0.1, 80, 0.1],
  ["dailyLossPct", "Дневной убыток, %", 0.1, 50, 0.1],
  ["signalPct", "Минимальный сигнал, %", 0.01, 20, 0.01],
  ["feeBps", "Комиссия, bps", 0, 100, 1],
  ["slippageBps", "Проскальзывание, bps", 0, 200, 1],
  ["maxSpreadBps", "Максимальный спред, bps", 1, 500, 1],
  ["minVolumeUsd", "Минимальный объём, $", 0, 1e11, 1000],
  ["maxDataAgeSeconds", "Возраст цены, сек", 5, 120, 1],
];
function formHtml(config, pairs, editing) {
  return `<h2 class="modal-title">${editing ? "Настройки бота" : "Новый торговый бот"}</h2><p class="modal-sub">Только виртуальные USD. Реальные средства и аккаунты биржи не используются.</p><form id="paperBotForm" class="stack"><label class="field">Название<input class="input" name="name" minlength="2" maxlength="60" value="${esc(config.name)}" required></label><label class="field">Описание<textarea class="textarea" name="description" maxlength="400">${esc(config.description || "")}</textarea></label><label class="field">Стратегия<select class="input" name="strategy">${Object.entries(
    strategies,
  )
    .map(
      ([key, name]) =>
        `<option value="${key}"${config.strategy === key ? " selected" : ""}>${name}</option>`,
    )
    .join(
      "",
    )}</select></label><fieldset class="paper-pairs"><legend>Торговые пары</legend>${pairs.map((pair) => `<label><input type="checkbox" name="pairs" value="${pair}"${config.pairs.includes(pair) ? " checked" : ""}> ${pair}</label>`).join("")}</fieldset><details><summary>Риск, издержки и ограничения</summary><div class="form-grid">${fields.map(([key, label, min, max, step]) => `<label class="field">${label}<input class="input" name="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${config[key]}"${editing && key === "initialUsd" ? " readonly" : ""} required></label>`).join("")}</div></details><p class="error-text" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-close>Отмена</button><button class="btn btn-primary" type="submit">Сохранить</button></div></form>`;
}
function chart(events) {
  if (new Set(events.filter(item => item.kind === "equity").map(item => item.bot_id)).size > 1) return '<div class="paper-empty">Выберите одного бота в фильтре, чтобы увидеть его график.</div>';
  const points = events
    .filter((item) => item.kind === "equity")
    .reverse()
    .slice(-50);
  if (points.length < 2)
    return `<div class="paper-empty">График появится после двух циклов анализа.</div>`;
  const values = points.map((item) => Number(item.data.equityCents) || 0),
    min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1,
    path = values
      .map(
        (value, index) =>
          `${index ? "L" : "M"}${(index * 100) / (values.length - 1)},${38 - ((value - min) * 36) / span}`,
      )
      .join(" ");
  return `<svg class="paper-chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Изменение виртуального баланса"><path d="${path}" vector-effect="non-scaling-stroke"/></svg>`;
}

export function mountBots(container) {
  let alive = true,
    overview,
    history = [],
    timer,
    filters = { days: 30 };
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">администрирование · paper trading</div><h1 class="page-title">Торговые боты</h1><p class="page-sub">Симуляция на публичных котировках Coinbase Exchange. Результат не гарантирует будущую прибыль.</p></div><div class="row wrap"><a class="btn btn-sm" href="#/admin">Админка</a><button class="btn btn-sm" id="paperRefresh">Обновить</button><button class="btn btn-primary btn-sm" id="paperCreate">Создать бота</button></div></div><p id="paperError" class="error-text" role="alert"></p><div id="paperContent" class="stack" aria-live="polite">Загрузка…</div>`;
  const content = container.querySelector("#paperContent"),
    error = container.querySelector("#paperError");
  async function load() {
    error.textContent = "";
    try {
      [overview, { events: history }] = await Promise.all([
        runAction("paperOverview"),
        runAction("paperHistory", filters),
      ]);
      if (alive) render();
    } catch (e) {
      if (alive) {
        error.textContent = e.message || "Не удалось загрузить ботов";
        content.innerHTML = `<div class="card card-pad paper-empty">Проверьте подключение API и повторите обновление.</div>`;
      }
    }
  }
  function edit(bot, copy = false) {
    const config = structuredClone(bot?.config || overview.defaults);
    if (copy) config.name += " — копия";
    const modal = openModal(formHtml(config, overview.pairs, !!bot && !copy), {
      className: "paper-modal",
    });
    modal.body.querySelector("[data-close]").onclick = modal.close;
    modal.body.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        submit = form.querySelector('[type="submit"]'),
        message = form.querySelector(".error-text"),
        raw = new FormData(form),
        config = Object.fromEntries(raw);
      config.pairs = raw.getAll("pairs");
      for (const [key] of fields) config[key] = Number(config[key]);
      submit.disabled = true;
      submit.textContent = "Сохраняем…";
      try {
        await runAction("paperSaveBot", {
          id: bot && !copy ? bot.id : null,
          revision: bot?.revision,
          config,
        });
        modal.close();
        toast("Бот сохранён", "success");
        await load();
      } catch (e) {
        message.textContent = e.message || "Не удалось сохранить";
        submit.disabled = false;
        submit.textContent = "Сохранить";
      }
    };
  }
  function render() {
    const bots = overview.bots,
      total = bots.reduce(
        (sum, bot) => sum + (Number(bot.state.equityCents) || 0),
        0,
      ),
      realized = bots.reduce(
        (sum, bot) => sum + (Number(bot.state.realizedCents) || 0),
        0,
      ),
      closed = bots.reduce(
        (sum, bot) => sum + (Number(bot.state.closed) || 0),
        0,
      ),
      wins = bots.reduce((sum, bot) => sum + (Number(bot.state.wins) || 0), 0),
      heartbeat =
        overview.control.heartbeat &&
        new Date(overview.control.heartbeat).getTime(),
      online = heartbeat && overview.serverTime - heartbeat < 30000;
    content.innerHTML = `<section class="paper-status ${overview.control.halted ? "danger" : online ? "ok" : "warn"}"><div><b>${overview.control.halted ? "Все боты аварийно остановлены" : online ? "Обработчик работает" : "Обработчик не отвечает"}</b><p>${esc(overview.control.worker_error || (online ? "Последний сигнал " + new Date(heartbeat).toLocaleTimeString("ru-RU") : "Новые сделки не выполняются, пока отдельный обработчик выключен."))}</p></div><button class="btn ${overview.control.halted ? "btn-primary" : "btn-danger"}" data-halt>${overview.control.halted ? "Снять остановку" : "Остановить всех"}</button></section><div class="stats-grid"><div class="stat-card"><div class="stat-label">Боты</div><div class="stat-value">${bots.length}</div><small>${bots.filter((bot) => bot.status === "running").length} активных</small></div><div class="stat-card"><div class="stat-label">Виртуальный баланс</div><div class="stat-value">${cash(total)}</div></div><div class="stat-card"><div class="stat-label">Результат</div><div class="stat-value ${realized < 0 ? "loss" : "profit"}">${cash(realized)}</div></div><div class="stat-card"><div class="stat-label">Успешные закрытия</div><div class="stat-value">${closed ? Math.round((wins / closed) * 100) : 0}%</div><small>${closed} закрыто</small></div></div><section class="card card-pad"><h2 class="section-title">Доходность</h2><p class="hint">Последние 30 дней, по фактическим записям симуляции.</p>${chart(history)}</section><section class="paper-grid">${bots.length ? bots.map((bot) => `<article class="card card-pad paper-bot"><div class="row-between"><div><h2 class="section-title">${esc(bot.config.name)}</h2><p class="hint">${esc(strategies[bot.config.strategy])} · ${bot.config.pairs.join(", ")}</p></div><span class="badge">${statuses[bot.status] || bot.status}</span></div><div class="paper-metrics"><span>Баланс <b>${cash(bot.state.equityCents)}</b></span><span>Результат <b>${cash(bot.state.realizedCents)}</b></span><span>Сделки <b>${bot.state.trades || 0}</b></span><span>Просадка <b>${fmtNum(bot.state.maxDrawdownPct || 0)}%</b></span></div>${bot.last_error ? `<p class="impact-note">Данные: ${esc(bot.last_error)}</p>` : ""}${bot.state.stoppedReason ? `<p class="impact-note">${esc(bot.state.stoppedReason)}</p>` : ""}<div class="row wrap"><button class="btn btn-sm" data-status="${bot.id}" data-next="${bot.status === "running" ? "paused" : "running"}">${bot.status === "running" ? "Приостановить" : "Запустить"}</button><button class="btn btn-sm" data-edit="${bot.id}">Настроить</button><button class="btn btn-sm" data-copy="${bot.id}">Копировать</button><button class="btn btn-sm btn-danger" data-archive="${bot.id}">Удалить</button></div></article>`).join("") : `<div class="card card-pad paper-empty"><h2 class="section-title">Ботов пока нет</h2><p>Создайте первого бота, выберите стратегию и пары. Он начнёт только после нажатия «Запустить».</p><button class="btn btn-primary" data-empty-create>Создать бота</button></div>`}</section><section class="card card-pad"><h2 class="section-title">Последние решения и сделки</h2><div class="table-wrap"><table class="admin-table"><thead><tr><th>Время</th><th>Бот</th><th>Пара</th><th>Решение</th><th>Причина / результат</th></tr></thead><tbody>${
      history
        .filter((item) => ["decision", "order"].includes(item.kind))
        .slice(0, 100)
        .map((item) => {
          const bot = bots.find((bot) => bot.id === item.bot_id);
          return `<tr><td>${new Date(item.at).toLocaleString("ru-RU")}</td><td>${esc(bot?.config.name || item.bot_id.slice(0, 8))}</td><td>${esc(item.data.pair || "—")}</td><td>${esc(item.kind === "order" ? (item.data.side === "buy" ? "Покупка" : "Продажа") : item.data.decision || "—")}</td><td>${esc(item.data.reason || (item.data.pnlCents == null ? "—" : "P/L " + cash(item.data.pnlCents)))}</td></tr>`;
        })
        .join("") ||
      `<tr><td colspan="5">Решений пока нет. Запустите бота и обработчик.</td></tr>`
    }</tbody></table></div></section>`;
    content.querySelector("section:last-child h2").insertAdjacentHTML("afterend", `<div class="row wrap paper-filters"><label class="field">Бот<select class="input" data-paper-filter="botId"><option value="">Все</option>${bots.map((bot) => `<option value="${bot.id}"${filters.botId === bot.id ? " selected" : ""}>${esc(bot.config.name)}</option>`).join("")}</select></label><label class="field">Пара<select class="input" data-paper-filter="pair"><option value="">Все</option>${overview.pairs.map((pair) => `<option${filters.pair === pair ? " selected" : ""}>${pair}</option>`).join("")}</select></label><label class="field">Период<select class="input" data-paper-filter="days">${[1, 7, 30, 365].map((days) => `<option value="${days}"${filters.days === days ? " selected" : ""}>${days === 1 ? "24 часа" : days + " дней"}</option>`).join("")}</select></label><label class="field">Тип<select class="input" data-paper-filter="kind"><option value="">Все</option><option value="order"${filters.kind === "order" ? " selected" : ""}>Сделки</option><option value="decision"${filters.kind === "decision" ? " selected" : ""}>Решения</option></select></label><label class="field">Сторона<select class="input" data-paper-filter="side"><option value="">Все</option><option value="buy"${filters.side === "buy" ? " selected" : ""}>Покупка</option><option value="sell"${filters.side === "sell" ? " selected" : ""}>Продажа</option></select></label><label class="field">Результат<select class="input" data-paper-filter="result"><option value="">Все</option><option value="win"${filters.result === "win" ? " selected" : ""}>Прибыль</option><option value="loss"${filters.result === "loss" ? " selected" : ""}>Убыток</option></select></label></div>`);
    content.querySelectorAll("[data-paper-filter]").forEach((select) => select.onchange = async () => {
      filters = {};
      content.querySelectorAll("[data-paper-filter]").forEach((field) => {
        if (field.value) filters[field.dataset.paperFilter] = field.dataset.paperFilter === "days" ? Number(field.value) : field.value;
      });
      await load();
    });
    content.querySelector("[data-halt]").onclick = async () => {
      if (
        !overview.control.halted &&
        !(await confirmDialog(
          "Аварийная остановка",
          "Остановить открытие всех новых виртуальных сделок?",
          "Остановить",
          true,
        ))
      )
        return;
      await runAction("paperEmergencyStop", {
        halted: !overview.control.halted,
      });
      await load();
    };
    content
      .querySelector("[data-empty-create]")
      ?.addEventListener("click", () => edit());
    content
      .querySelectorAll("[data-edit]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            edit(bots.find((bot) => bot.id === button.dataset.edit))),
      );
    content.querySelectorAll("[data-copy]").forEach(
      (button) =>
        (button.onclick = () =>
          edit(
            bots.find((bot) => bot.id === button.dataset.copy),
            true,
          )),
    );
    content.querySelectorAll("[data-status]").forEach(
      (button) =>
        (button.onclick = async () => {
          button.disabled = true;
          try {
            await runAction("paperSetStatus", {
              id: button.dataset.status,
              status: button.dataset.next,
            });
            await load();
          } catch (e) {
            toast(e.message, "error");
            button.disabled = false;
          }
        }),
    );
    content.querySelectorAll("[data-archive]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (
            !(await confirmDialog(
              "Удалить бота",
              "Бот будет архивирован, история сохранится.",
              "Удалить",
              true,
            ))
          )
            return;
          try {
            await runAction("paperSetStatus", {
              id: button.dataset.archive,
              status: "archived",
            });
            await load();
          } catch (e) {
            toast(e.message, "error");
          }
        }),
    );
  }
  container.querySelector("#paperRefresh").onclick = load;
  container.querySelector("#paperCreate").onclick = () =>
    overview ? edit() : toast("Дождитесь загрузки настроек", "error");
  load();
  timer = setInterval(() => {
    if (!document.hidden) load();
  }, 15000);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
