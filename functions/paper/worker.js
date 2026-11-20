import { getFirestore } from "../database.js";
import { CoinbaseMarket } from "./market-data.js";
import { heartbeat, runDueBots } from "./service.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the paper worker");
let stopping = false, wake;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; wake?.(); });
const market = new CoinbaseMarket();
console.log("CharMsg paper worker: virtual USD only; Coinbase public market data");
while (!stopping) {
  try {
    await heartbeat();
    await runDueBots(market);
    await heartbeat();
  } catch (error) {
    console.error("Paper worker cycle failed", error.code || error.name);
    await heartbeat("Цикл остановлен из-за ошибки. Новых сделок до успешного восстановления нет.").catch(() => {});
  }
  if (!stopping) await new Promise(resolve => {
    const timer = setTimeout(resolve, 5000);
    wake = () => { clearTimeout(timer); resolve(); };
  });
}
await getFirestore().terminate();
console.log("Paper worker stopped; committed state retained");
