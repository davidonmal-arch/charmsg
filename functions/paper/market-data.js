import { PAIRS } from "./engine.js";

// One adapter instance serializes public requests; only fixed, supported products reach the provider.
export class CoinbaseMarket {
  constructor({ request = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.request = request; this.now = now; this.sleep = sleep;
    this.cache = new Map(); this.queue = Promise.resolve(); this.lastRequest = 0;
  }
  async get(path, ttl) {
    const cached = this.cache.get(path);
    if (cached && cached.until > this.now()) return cached.value;
    const task = this.queue.catch(() => {}).then(async () => {
      const again = this.cache.get(path);
      if (again && again.until > this.now()) return again.value;
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.sleep(Math.max(0, 550 - (this.now() - this.lastRequest)));
        this.lastRequest = this.now();
        let response;
        try {
          response = await this.request("https://api.exchange.coinbase.com" + path, {
            headers: { Accept: "application/json", "User-Agent": "CharMsg-Paper/1.0" }, signal: AbortSignal.timeout(8000)
          });
        } catch {
          if (attempt === 2) throw new Error("Источник котировок недоступен");
          await this.sleep(1000 * (attempt + 1)); continue;
        }
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await this.sleep(1000 * (attempt + 1)); continue;
        }
        if (!response.ok) throw new Error("Источник котировок: HTTP " + response.status);
        const value = await response.json();
        this.cache.set(path, { value, until: this.now() + ttl });
        return value;
      }
    });
    this.queue = task;
    return task;
  }
  async quote(pair) {
    if (!PAIRS.includes(pair)) throw new Error("Неподдерживаемая торговая пара");
    const ticker = await this.get(`/products/${pair}/ticker`, 10000);
    const candles = await this.get(`/products/${pair}/candles?granularity=60`, 60000);
    const now = this.now();
    if (!Array.isArray(candles)) throw new Error("Некорректная история котировок");
    const history = candles.filter(row => Array.isArray(row) && row.length >= 6 && row[0] * 1000 + 60000 <= now)
      .sort((a, b) => a[0] - b[0]).slice(-40);
    if (history.length < 20 || history.some((row, i) => !row.slice(0, 6).every(Number.isFinite)
      || row[4] <= 0 || (i && row[0] - history[i - 1][0] !== 60))) throw new Error("История неполная или повреждена");
    const asOf = Date.parse(ticker.time);
    const bid = Number(ticker.bid), ask = Number(ticker.ask), price = Number(ticker.price), volume = Number(ticker.volume);
    if (![asOf, bid, ask, price, volume].every(Number.isFinite) || bid <= 0 || ask < bid || price <= 0 || volume < 0
      || !/^[0-9]+$/.test(String(ticker.trade_id))) throw new Error("Некорректная котировка");
    return { source: "coinbase-exchange", pair, id: String(ticker.trade_id) + ":" + ticker.time,
      asOf, bid, ask, volumeUsd: volume * price, historyEnd: history.at(-1)[0] * 1000 + 60000,
      closes: history.map(row => row[4]) };
  }
  async quotes(pairs) {
    const quotes = {}, errors = {};
    for (const pair of new Set(pairs)) {
      try { quotes[pair] = await this.quote(pair); }
      catch (error) { errors[pair] = error.message; }
    }
    return { quotes, errors };
  }
}
