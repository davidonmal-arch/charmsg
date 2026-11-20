export const PAIRS = ["BTC-USD", "ETH-USD", "SOL-USD"];
export const STRATEGIES = ["trend", "mean-reversion", "momentum"];

const number = (value, min, max, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Некорректное поле " + name);
  return value;
};
export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Настройки не переданы");
  const name = String(input.name || "").trim(), description = String(input.description || "").trim();
  if (name.length < 2 || name.length > 60 || description.length > 400) throw new Error("Название 2–60 символов, описание до 400");
  if (!STRATEGIES.includes(input.strategy)) throw new Error("Неизвестная стратегия");
  if (!Array.isArray(input.pairs) || !input.pairs.length || input.pairs.length > PAIRS.length
    || new Set(input.pairs).size !== input.pairs.length || input.pairs.some(pair => !PAIRS.includes(pair))) throw new Error("Выберите поддерживаемые пары");
  const config = { name, description, strategy: input.strategy, pairs: [...input.pairs] };
  const ranges = {
    initialUsd: [100, 1000000], maxTradeUsd: [10, 100000], maxPositionUsd: [10, 100000],
    maxPositions: [1, 10], riskPct: [0.1, 100], intervalSeconds: [15, 3600],
    takeProfitPct: [0.1, 100], stopLossPct: [0.1, 50], maxDrawdownPct: [0.1, 80],
    dailyLossPct: [0.1, 50], signalPct: [0.01, 20], feeBps: [0, 100], slippageBps: [0, 200],
    maxSpreadBps: [1, 500], minVolumeUsd: [0, 100000000000], maxDataAgeSeconds: [5, 120]
  };
  for (const [field, [min,max]] of Object.entries(ranges)) config[field] = number(input[field],min,max,field);
  if (!Number.isInteger(config.maxPositions) || !Number.isInteger(config.intervalSeconds)) throw new Error("Количество позиций и интервал должны быть целыми");
  if (config.maxTradeUsd > config.maxPositionUsd || config.maxPositionUsd > config.initialUsd) throw new Error("Лимиты сделки и позиции должны помещаться в начальный баланс");
  return config;
}
export const DEFAULT_CONFIG = {
  name: "Новый бот", description: "", strategy: "trend", pairs: ["BTC-USD"],
  initialUsd: 10000, maxTradeUsd: 250, maxPositionUsd: 500, maxPositions: 3, riskPct: 5,
  intervalSeconds: 60, takeProfitPct: 2, stopLossPct: 1, maxDrawdownPct: 10, dailyLossPct: 3,
  signalPct: 0.5, feeBps: 10, slippageBps: 5, maxSpreadBps: 30, minVolumeUsd: 1000000, maxDataAgeSeconds: 30
};
export function initialState(config, now) {
  const cash = Math.round(config.initialUsd * 100);
  return { cashCents: cash, initialCents: cash, realizedCents: 0, feesCents: 0, positions: [],
    equityCents: cash, peakCents: cash, maxDrawdownPct: 0, day: new Date(now).toISOString().slice(0,10),
    dayStartCents: cash, trades: 0, closed: 0, wins: 0, lastQuotes: {}, marks: {}, stoppedReason: null };
}
const mean = values => values.reduce((sum,value)=>sum+value,0)/values.length;
function signal(strategy, closes, threshold) {
  const fast = mean(closes.slice(-5)), slow = mean(closes.slice(-20)), last = closes.at(-1);
  const momentum = (last / closes.at(-6) - 1) * 100, deviation = (slow / last - 1) * 100;
  const value = strategy === "momentum" ? momentum : strategy === "mean-reversion" ? deviation : (fast/slow-1)*100;
  return { buy: value >= threshold, sell: strategy === "mean-reversion" ? last >= slow : value <= -threshold,
    value, fast, slow, momentum, deviation };
}
export function quoteProblem(quote, config, now) {
  if (!quote || quote.source !== "coinbase-exchange") return "Нет подтверждённых рыночных данных";
  if (!Number.isFinite(quote.asOf) || quote.asOf > now + 5000 || now-quote.asOf > config.maxDataAgeSeconds*1000) return "Котировка устарела";
  if (![quote.bid,quote.ask,quote.volumeUsd].every(Number.isFinite) || quote.bid <= 0 || quote.ask < quote.bid || quote.volumeUsd < 0) return "Повреждённая котировка";
  if ((quote.ask/quote.bid-1)*10000 > config.maxSpreadBps) return "Слишком широкий спред";
  if (quote.volumeUsd < config.minVolumeUsd) return "Недостаточный объём торгов";
  if (!Array.isArray(quote.closes) || quote.closes.length < 20 || quote.closes.some(value=>!Number.isFinite(value)||value<=0)) return "Недостаточно истории цен";
  if (!Number.isFinite(quote.historyEnd) || now-quote.historyEnd > 180000 || quote.historyEnd > now+5000) return "История цен устарела";
  if (Math.abs(quote.closes.at(-1)/quote.closes.at(-2)-1)>0.1) return "Аномальное изменение цены";
  return null;
}
function liquidation(position, quote, config) {
  const price = quote.bid * (1-config.slippageBps/10000);
  const gross = Math.floor(position.quantity*price*100);
  const fee = Math.ceil(gross*config.feeBps/10000);
  return { price, gross, fee, net: Math.max(0,gross-fee) };
}
export function analyzeBot(bot, quotes, now) {
  const config = validateConfig(bot.config), state = structuredClone(bot.state);
  const decisions = [], orders = [];
  if (bot.status !== "running") return { state, decisions, orders, status: bot.status };
  let missing = false;
  for (const position of state.positions) {
    const quote = quotes[position.pair];
    if (quoteProblem(quote,config,now)) { missing = true; continue; }
    state.marks[position.pair] = quote;
  }
  const equity = () => state.cashCents + state.positions.reduce((total,position)=>{
    const quote=state.marks[position.pair];
    return total+(quote?liquidation(position,quote,config).net:position.costCents);
  },0);
  state.equityCents=equity();
  state.peakCents=Math.max(state.peakCents,state.equityCents);
  const drawdown=(state.peakCents-state.equityCents)/state.peakCents*100;
  state.maxDrawdownPct=Math.max(state.maxDrawdownPct,drawdown);
  const day=new Date(now).toISOString().slice(0,10);
  if(day!==state.day && !missing){state.day=day;state.dayStartCents=state.equityCents;}
  const dayLoss=(state.dayStartCents-state.equityCents)/state.dayStartCents*100;
  if(drawdown>=config.maxDrawdownPct || dayLoss>=config.dailyLossPct){
    state.stoppedReason=drawdown>=config.maxDrawdownPct?"Превышена допустимая просадка":"Достигнут дневной лимит убытка";
    return {state,orders,decisions:[{decision:"stop",reason:state.stoppedReason,drawdown,dayLoss}],status:"risk-stopped"};
  }
  for(const pair of config.pairs){
    const quote=quotes[pair], problem=quoteProblem(quote,config,now);
    if(problem){decisions.push({pair,decision:"wait",reason:problem});continue;}
    const basis={source:quote.source,id:quote.id,asOf:quote.asOf,bid:quote.bid,ask:quote.ask,volumeUsd:quote.volumeUsd,historyEnd:quote.historyEnd};
    const indicator=signal(config.strategy,quote.closes,config.signalPct);
    const decide=(decision,reason)=>decisions.push({pair,decision,reason,basis,indicators:indicator});
    if(state.lastQuotes[pair]===quote.id){decide("wait","Эта котировка уже обработана");continue;}
    state.lastQuotes[pair]=quote.id;
    state.marks[pair]=quote;
    const position=state.positions.find(position=>position.pair===pair);
    if(position){
      const fill=liquidation(position,quote,config), pnl=fill.net-position.costCents, percent=pnl/position.costCents*100;
      if(percent>=config.takeProfitPct || percent<=-config.stopLossPct || indicator.sell){
        const reason=percent>=config.takeProfitPct?"Целевая прибыль":percent<=-config.stopLossPct?"Стоп-лосс":"Выход по стратегии";
        state.cashCents+=fill.net;state.realizedCents+=pnl;state.feesCents+=fill.fee;
        state.closed++;if(pnl>0)state.wins++;state.trades++;
        state.positions=state.positions.filter(item=>item.id!==position.id);
        orders.push({key:bot.id+":"+position.id+":"+quote.id+":sell",pair,side:"sell",quantity:position.quantity,price:fill.price,
          grossCents:fill.gross,feeCents:fill.fee,netCents:fill.net,pnlCents:pnl,positionId:position.id,reason,quoteId:quote.id,at:now});
        decide("sell",reason);
      }else decide("hold","Позиция остаётся открытой");
      continue;
    }
    if(missing){decide("wait","Есть позиции без свежей оценки");continue;}
    if(!indicator.buy){decide("wait","Условия входа не выполнены");continue;}
    if(Math.abs(indicator.value)<=2*(config.feeBps+config.slippageBps)/100){decide("wait","Сигнал не покрывает комиссию и проскальзывание");continue;}
    if(state.positions.length>=config.maxPositions){decide("wait","Достигнут лимит позиций");continue;}
    const budget=Math.min(Math.floor(config.maxTradeUsd*100),Math.floor(config.maxPositionUsd*100),
      Math.floor(state.equityCents*config.riskPct/100),state.cashCents);
    const price=quote.ask*(1+config.slippageBps/10000);
    const quantity=Math.floor(((budget-2)/(1+config.feeBps/10000)/100/price)*1e8)/1e8;
    const gross=Math.ceil(quantity*price*100),fee=Math.ceil(gross*config.feeBps/10000),cost=gross+fee;
    if(!Number.isFinite(quantity)||quantity<=0||cost>state.cashCents||cost>budget||gross<100){decide("wait","Недостаточно свободного виртуального баланса");continue;}
    const id=bot.id+":"+pair+":"+quote.id;
    state.cashCents-=cost;state.feesCents+=fee;state.trades++;
    state.positions.push({id,pair,quantity,costCents:cost,openedAt:now,entryPrice:price});
    orders.push({key:id+":buy",pair,side:"buy",quantity,price,grossCents:gross,feeCents:fee,netCents:-cost,pnlCents:null,positionId:id,reason:"Вход по стратегии",quoteId:quote.id,at:now});
    decide("buy","Вход по стратегии с учётом издержек и лимитов");
  }
  state.equityCents=equity();state.peakCents=Math.max(state.peakCents,state.equityCents);
  state.maxDrawdownPct=Math.max(state.maxDrawdownPct,(state.peakCents-state.equityCents)/state.peakCents*100);
  if(!Number.isSafeInteger(state.cashCents)||state.cashCents<0)throw new Error("Нарушена целостность виртуального баланса");
  return {state,decisions,orders,status:"running"};
}
