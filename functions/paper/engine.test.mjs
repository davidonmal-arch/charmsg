import assert from "node:assert/strict";
import { analyzeBot, DEFAULT_CONFIG, initialState, validateConfig } from "./engine.js";
const now = Date.now();
const config = { ...DEFAULT_CONFIG, minVolumeUsd: 0, signalPct: 0.2 };
const quote = (price = 110, id = "1", closes = Array.from({ length: 40 }, (_, i) => 80 + i)) => ({
  source: "coinbase-exchange", id, asOf: now, bid: price, ask: price + 0.01, volumeUsd: 1e8, historyEnd: now - 60000, closes
});
const bot = (id = "bot") => ({ id, config, status: "running", state: initialState(config, now) });
const first = analyzeBot(bot(), { "BTC-USD": quote() }, now);
assert.equal(first.orders.length, 1);
assert.equal(first.orders[0].side, "buy");
assert.equal(first.state.cashCents, 1000000 - first.state.positions[0].costCents);
assert.equal(first.state.feesCents, first.orders[0].feeCents);
assert.ok(first.orders[0].grossCents + first.orders[0].feeCents <= config.maxTradeUsd * 100);
assert.equal(analyzeBot({ ...bot(), state: first.state }, { "BTC-USD": quote() }, now).orders.length, 0);
const sell = analyzeBot({ ...bot(), state: first.state }, { "BTC-USD": quote(120, "2") }, now);
assert.equal(sell.orders[0].side, "sell");
assert.equal(sell.state.positions.length, 0);
assert.equal(sell.state.cashCents - 1000000, sell.state.realizedCents);
assert.equal(sell.state.feesCents, first.orders[0].feeCents + sell.orders[0].feeCents);
assert.equal(sell.state.closed, 1); assert.equal(sell.state.wins, 1);
assert.ok(sell.orders[0].price < 120);
assert.equal(analyzeBot(bot("other"), { "BTC-USD": quote() }, now).state.cashCents, first.state.cashCents);
assert.equal(bot().state.cashCents, 1000000, "independent state");
assert.equal(analyzeBot({ ...bot(), status: "paused" }, { "BTC-USD": quote() }, now).orders.length, 0);
assert.equal(analyzeBot(bot(), {}, now).orders.length, 0);
assert.equal(analyzeBot(bot(), { "BTC-USD": { ...quote(), asOf: now - 120000 } }, now).orders.length, 0);
assert.equal(analyzeBot(bot(), { "BTC-USD": { ...quote(), ask: 1000 } }, now).orders.length, 0);
assert.equal(analyzeBot(bot(), { "BTC-USD": { ...quote(), historyEnd: now - 600000 } }, now).orders.length, 0);
const risk = { ...bot(), state: { ...first.state, peakCents: 2000000 } };
assert.equal(analyzeBot(risk, { "BTC-USD": quote() }, now).status, "risk-stopped");
const stop = analyzeBot({ ...bot(), state: first.state }, { "BTC-USD": quote(105, "3") }, now);
assert.equal(stop.orders[0].side, "sell"); assert.ok(stop.state.realizedCents < 0);
assert.throws(() => validateConfig({ ...config, initialUsd: NaN }));
assert.throws(() => validateConfig({ ...config, pairs: ["fake"] }));
assert.throws(() => validateConfig({ ...config, maxTradeUsd: 100000 }));
const limited = { ...bot(), config: { ...config, pairs: ["BTC-USD", "ETH-USD"], maxPositions: 1 } };
assert.equal(analyzeBot(limited, { "BTC-USD": quote(), "ETH-USD": quote() }, now).state.positions.length, 1);
const expensive = { ...bot(), config: { ...config, feeBps: 100, slippageBps: 200, strategy: "momentum" } };
assert.equal(analyzeBot(expensive, { "BTC-USD": quote(110, "4", Array.from({ length: 40 }, (_, i) => 100 + i * 0.1)) }, now).orders.length, 0);
// Deterministic scenario fixtures test mechanics; these generated paths are not market backtests.
const scenarios = {
  rising: i => 100 + i * 0.8,
  falling: i => 200 - i * 0.8,
  sideways: i => 100 + Math.sin(i / 3) * 3,
  shock: i => i < 55 ? 100 + i * 0.3 : 85 + (i - 55) * 0.1
};
for (const strategy of ["trend", "momentum", "mean-reversion"]) for (const [name, path] of Object.entries(scenarios)) {
  let current = { ...bot(), config: { ...config, strategy } };
  for (let i = 40; i < 100; i++) {
    const at = now + i * 60000;
    const market = { ...quote(path(i), String(i), Array.from({ length: 40 }, (_, j) => path(i - 39 + j))), asOf: at, historyEnd: at - 60000 };
    const result = analyzeBot(current, { "BTC-USD": market }, at);
    current = { ...current, ...result };
    assert.ok(current.state.cashCents >= 0); assert.ok(Number.isSafeInteger(current.state.cashCents));
    assert.equal(current.state.cashCents + current.state.positions.reduce((sum, p) => sum + p.costCents, 0), 1000000 + current.state.realizedCents);
  }
  console.log(`${strategy}/${name}: equity=${(current.state.equityCents / 100).toFixed(2)} USD; realized=${(current.state.realizedCents / 100).toFixed(2)}; fills=${current.state.trades}; status=${current.status}`);
}
console.log("Paper engine checks passed: accounting, costs, independent portfolios, duplicate quotes, risk, stale data and 12 scenarios.");
