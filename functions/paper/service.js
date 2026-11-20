import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "../database.js";
import { analyzeBot, DEFAULT_CONFIG, initialState, PAIRS, validateConfig } from "./engine.js";

const sql = () => {
  const connection = getFirestore().sql;
  if (!connection) throw new HttpsError("failed-precondition", "Для симуляции требуется PostgreSQL");
  return connection;
};
function admin(user) {
  if (!user?.isAdmin) throw new HttpsError("permission-denied", "Доступно только администратору");
}
function validId(id) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new HttpsError("invalid-argument", "Некорректный бот");
  return id;
}
async function event(client, botId, kind, data, dedupe = null, at = Date.now()) {
  await client.query("INSERT INTO charmsg.paper_events(bot_id,kind,data,dedupe,at) VALUES($1,$2,$3::jsonb,$4,to_timestamp($5/1000.0))",
    [botId, kind, JSON.stringify(data), dedupe, at]);
}
async function locked(client, id) {
  const control = (await client.query("SELECT * FROM charmsg.paper_control WHERE id=true FOR UPDATE")).rows[0];
  const bot = (await client.query("SELECT * FROM charmsg.paper_bots WHERE id=$1 FOR UPDATE", [validId(id)])).rows[0];
  if (!bot || bot.status === "archived") throw new HttpsError("not-found", "Бот не найден");
  return { control, bot };
}
export async function paperSaveBot(user, input) {
  admin(user);
  let config;
  try { config = validateConfig(input?.config); }
  catch (error) { throw new HttpsError("invalid-argument", error.message); }
  return sql().transaction(async client => {
    await client.query("SELECT id FROM charmsg.paper_control WHERE id=true FOR UPDATE");
    if (input.id) {
      const { bot } = await locked(client, input.id);
      if (bot.status === "running") throw new HttpsError("failed-precondition", "Приостановите бота перед изменением настроек");
      if (input.revision !== bot.revision) throw new HttpsError("aborted", "Настройки уже изменены. Обновите страницу");
      if (config.initialUsd !== bot.config.initialUsd) throw new HttpsError("invalid-argument", "Начальный баланс изменить нельзя. Создайте копию бота");
      if (bot.state.positions.some(position => !config.pairs.includes(position.pair))) throw new HttpsError("invalid-argument", "Нельзя убрать пару с открытой позицией");
      if (bot.state.positions.length > config.maxPositions) throw new HttpsError("invalid-argument", "Лимит ниже числа открытых позиций");
      await client.query("UPDATE charmsg.paper_bots SET config=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1", [bot.id, JSON.stringify(config)]);
      await event(client, bot.id, "admin", { action: "settings", actor: user.uid, config });
      return { id: bot.id };
    }
    const count = Number((await client.query("SELECT count(*) AS count FROM charmsg.paper_bots WHERE status<>'archived'")).rows[0].count);
    if (count >= 100) throw new HttpsError("resource-exhausted", "Сначала архивируйте ненужных ботов: максимум 100");
    const id = randomUUID();
    await client.query("INSERT INTO charmsg.paper_bots(id,config,state,status) VALUES($1,$2::jsonb,$3::jsonb,'paused')",
      [id, JSON.stringify(config), JSON.stringify(initialState(config, Date.now()))]);
    await event(client, id, "admin", { action: "create", actor: user.uid, config });
    return { id };
  });
}
export async function paperSetStatus(user, input) {
  admin(user);
  if (!['running', 'paused', 'stopped', 'archived'].includes(input?.status)) throw new HttpsError("invalid-argument", "Некорректный статус");
  return sql().transaction(async client => {
    const { bot, control } = await locked(client, input.id);
    if (input.status === "running" && control.halted) throw new HttpsError("failed-precondition", "Сначала снимите общую остановку");
    await client.query("UPDATE charmsg.paper_bots SET status=$2,revision=revision+1,next_run=now(),updated_at=now() WHERE id=$1", [bot.id, input.status]);
    await event(client, bot.id, "admin", { action: input.status, actor: user.uid });
    return { ok: true };
  });
}
export async function paperEmergencyStop(user, input) {
  admin(user);
  if (typeof input?.halted !== "boolean") throw new HttpsError("invalid-argument", "Укажите состояние остановки");
  return sql().transaction(async client => {
    await client.query("SELECT id FROM charmsg.paper_control WHERE id=true FOR UPDATE");
    await client.query("UPDATE charmsg.paper_control SET halted=$1 WHERE id=true", [input.halted]);
    if (input.halted) {
      const { rows } = await client.query("UPDATE charmsg.paper_bots SET status='paused',revision=revision+1,updated_at=now() WHERE status='running' RETURNING id");
      for (const bot of rows) await event(client, bot.id, "admin", { action: "emergency-stop", actor: user.uid });
    }
    return { ok: true };
  });
}
export async function paperOverview(user) {
  admin(user);
  const control = (await sql().query("SELECT * FROM charmsg.paper_control WHERE id=true")).rows[0];
  const { rows: bots } = await sql().query("SELECT * FROM charmsg.paper_bots WHERE status<>'archived' ORDER BY updated_at DESC LIMIT 100");
  return { control, bots, defaults: DEFAULT_CONFIG, pairs: PAIRS, serverTime: Date.now() };
}
export async function paperHistory(user, input = {}) {
  admin(user);
  const params = [], where = ["true"], add = value => { params.push(value); return "$" + params.length; };
  if (input.botId) where.push("bot_id=" + add(validId(input.botId)));
  if (input.pair) {
    if (!PAIRS.includes(input.pair)) throw new HttpsError("invalid-argument", "Неизвестная пара");
    where.push("data->>'pair'=" + add(input.pair));
  }
  if (input.kind) {
    if (!["order", "decision", "admin", "equity"].includes(input.kind)) throw new HttpsError("invalid-argument", "Некорректный журнал");
    where.push("kind=" + add(input.kind));
  }
  if (input.side) {
    if (!["buy", "sell"].includes(input.side)) throw new HttpsError("invalid-argument", "Некорректная сторона сделки");
    where.push("data->>'side'=" + add(input.side));
  }
  if (input.result) {
    if (!["win", "loss"].includes(input.result)) throw new HttpsError("invalid-argument", "Некорректный результат");
    where.push("kind='order' AND data->>'side'='sell' AND (data->>'pnlCents')::numeric " + (input.result === "win" ? ">0" : "<=0"));
  }
  if (input.days != null) {
    if (![1, 7, 30, 365].includes(input.days)) throw new HttpsError("invalid-argument", "Некорректный период");
    where.push("at>=now()-" + add(input.days) + "*interval '1 day'");
  }
  // Keyset pagination keeps old records reachable without expensive OFFSET scans.
  if (input.before != null) {
    if (!/^[1-9][0-9]{0,18}$/.test(String(input.before))) throw new HttpsError("invalid-argument", "Некорректная страница");
    where.push("id<" + add(input.before) + "::bigint");
  }
  const { rows } = await sql().query("SELECT id,bot_id,kind,at,data FROM charmsg.paper_events WHERE " + where.join(" AND ") + " ORDER BY id DESC LIMIT 201", params);
  return { events: rows.slice(0, 200), next: rows.length > 200 ? rows[199].id : null };
}

export async function runDueBots(market, now = Date.now()) {
  const control = (await sql().query("SELECT halted FROM charmsg.paper_control WHERE id=true")).rows[0];
  if (control.halted) return 0;
  const { rows: due } = await sql().query("SELECT * FROM charmsg.paper_bots WHERE status='running' AND next_run<=to_timestamp($1/1000.0) ORDER BY next_run LIMIT 100", [now]);
  if (!due.length) return 0;
  const { quotes, errors } = await market.quotes(due.flatMap(bot => bot.config.pairs));
  let processed = 0;
  for (const expected of due) {
    await sql().transaction(async client => {
      const { bot, control } = await locked(client, expected.id);
      const at = Date.now();
      if (control.halted || bot.status !== "running" || bot.revision !== expected.revision || new Date(bot.next_run).getTime() > at) return;
      const result = analyzeBot(bot, quotes, at);
      for (const order of result.orders) await event(client, bot.id, "order", order, order.key, at);
      for (const decision of result.decisions) await event(client, bot.id, "decision", { ...decision, sourceError: errors[decision.pair] || null }, null, at);
      await event(client, bot.id, "equity", { equityCents: result.state.equityCents, cashCents: result.state.cashCents,
        realizedCents: result.state.realizedCents, stale: bot.config.pairs.some(pair => !quotes[pair]) }, null, at);
      const lastError = bot.config.pairs.map(pair => errors[pair]).filter(Boolean).join("; ") || null;
      await client.query("UPDATE charmsg.paper_bots SET state=$2::jsonb,status=$3,next_run=to_timestamp($4/1000.0),last_error=$5,updated_at=now() WHERE id=$1",
        [bot.id, JSON.stringify(result.state), result.status, at + bot.config.intervalSeconds * 1000, lastError]);
      processed++;
    });
  }
  return processed;
}
export async function heartbeat(error = null) {
  await sql().query("UPDATE charmsg.paper_control SET heartbeat=now(),worker_error=$1 WHERE id=true", [error]);
}
