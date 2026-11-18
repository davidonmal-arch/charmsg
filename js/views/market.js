import { state, onChange, userOf } from "../state.js";
import { confirmDialog, openModal, openProfileModal } from "../ui.js";
import {
  NFT_EFFECTS,
  buyNft,
  canCreateNft,
  createNft,
  deleteNft,
  effectClass,
  enhanceNft,
  releaseNfts,
  giftNft,
  nftTitle,
  nftResaleLimit,
  setFeaturedNft,
  setNftSale,
  tickMarket,
  trade
} from "../store.js";
import {
  NFT_MIN_RANK,
  avatarData,
  clamp,
  escapeHtml,
  fmtNum,
  fmtPct,
  fmtRelative,
  fmtTime,
  imageFileToDataUrl,
  nickHtml,
  rankBadge,
  rankInfo,
  rankOf,
  safeUrl,
  toast
} from "../util.js";

function priceFmt(n) {
  const v = Number(n) || 0;
  if (v >= 100) return v.toLocaleString("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString("ru-RU", { maximumFractionDigits: 3, minimumFractionDigits: 3 });
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 4, minimumFractionDigits: 4 });
}

function buildChart(history) {
  const now = Date.now();
  let points = (Array.isArray(history) ? history : []).filter((p) => p && Number.isFinite(p.p) && Number.isFinite(p.t));
  const dayPoints = points.filter((p) => p.t >= now - 86_400_000);
  if (dayPoints.length >= 2) points = dayPoints;
  points = points.slice(-70);
  if (points.length === 0) points = [{ t: now - 1000, p: 100 }, { t: now, p: 100 }];
  if (points.length === 1) points = [{ t: points[0].t - 1000, p: points[0].p }, points[0]];

  const w = 680;
  const h = 200;
  const padY = 14;
  const prices = points.map((p) => p.p);
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (min === max) {
    min *= 0.985;
    max *= 1.015;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const x = (i) => (i / (points.length - 1)) * w;
  const y = (p) => padY + (1 - (p - min) / (max - min)) * (h - padY * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.p).toFixed(2)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const first = points[0].p;
  const last = points[points.length - 1].p;
  const up = last >= first;
  const stroke = up ? "#d9c2ec" : "#a98cbd";

  const grid = [0.25, 0.5, 0.75]
    .map((f) => `<line x1="0" x2="${w}" y1="${(padY + f * (h - padY * 2)).toFixed(1)}" y2="${(padY + f * (h - padY * 2)).toFixed(1)}" stroke="rgba(196,164,218,.08)" stroke-width="1" stroke-dasharray="3 5"/>`)
    .join("");

  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="График цены CharCoin">
    <defs>
      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="chartStroke" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#7f5d99"/>
        <stop offset="55%" stop-color="${stroke}"/>
        <stop offset="100%" stop-color="#e7d6f5"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${area}" fill="url(#chartFill)"/>
    <path d="${line}" fill="none" stroke="url(#chartStroke)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" filter="drop-shadow(0 0 6px rgba(196,164,218,.45))"/>
    <circle cx="${x(points.length - 1).toFixed(2)}" cy="${y(last).toFixed(2)}" r="3.6" fill="#e7d6f5" stroke="#4c2365" stroke-width="2"/>
  </svg>
  <div class="chart-legend"><span>${escapeHtml(priceFmt(min))} · минимум</span><span>${escapeHtml(priceFmt(max))} · максимум</span></div>`;
}

export function mountMarket(container) {
  let side = "buy";
  let amountInputValue = "";
  let nftFilter = "sale";

  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">экономика charmsg</div>
        <h1 class="page-title">Биржа <span class="nick-admin" style="font-size:0.64em;vertical-align:middle">CHR</span></h1>
        <p class="page-sub">Ненастоящая криптовалюта с настоящим влиянием: каждая сделка двигает общую цену для всех игроков и ботов.</p>
      </div>
      <div class="badge solid"><span class="dot live"></span> рынок живёт</div>
    </div>

    <div class="market-grid">
      <div class="stack">
        <div class="card market-hero">
          <div class="market-hero-top">
            <div class="coin-title">
              <div class="coin-logo">◈</div>
              <div>
                <div class="coin-name">CharCoin</div>
                <div class="coin-ticker">CHR · FIRESTORE MARKET</div>
              </div>
            </div>
            <div class="badge" id="botsBadge">боты активны</div>
          </div>
          <div class="price-row">
            <div class="price-big" id="priceBig">100.00</div>
            <div class="price-unit">CR за 1 CHR</div>
            <div class="delta" id="deltaChip">+0.00%</div>
          </div>
          <div class="chart-wrap" id="chartWrap"></div>
          <div class="market-meta">
            <span>Объём: <b id="metaVolume">0</b> CR</span>
            <span>Ликвидность: <b id="metaLiq">12 000</b></span>
            <span>Сделок в ленте: <b id="metaTrades">0</b></span>
            <span>Обновляется в реальном времени</span>
          </div>
        </div>

        <div class="card trade-panel">
          <div class="row-between" style="margin-bottom:13px">
            <div>
              <div class="eyebrow">сделка</div>
              <div style="font-size:16px;font-weight:750;letter-spacing:-.02em;margin-top:4px">Купить или продать CHR</div>
            </div>
            <span class="badge" id="tradeAvail">—</span>
          </div>
          <div class="seg">
            <button type="button" class="seg-btn active" id="buyTab">Купить</button>
            <button type="button" class="seg-btn sell" id="sellTab">Продать</button>
          </div>
          <div class="field">
            <label id="amountLabel">Сумма в CR</label>
            <div class="amount-wrap">
              <input class="input" id="tradeAmount" inputmode="decimal" placeholder="0.00" autocomplete="off" />
              <span class="amount-suffix" id="amountSuffix">CR</span>
            </div>
            <div class="quick-row" id="quickRow">
              <button class="quick-btn" data-frac="0.25">25%</button>
              <button class="quick-btn" data-frac="0.5">50%</button>
              <button class="quick-btn" data-frac="0.75">75%</button>
              <button class="quick-btn" data-frac="1">MAX</button>
            </div>
          </div>
          <div class="trade-summary">
            <div class="summary-row"><span>Вы получите</span><b id="estGet">0 CHR</b></div>
            <div class="summary-row"><span>Средняя цена сделки</span><b id="estPrice">—</b></div>
            <div class="summary-row"><span>Влияние на цену</span><b id="estImpact">0.00%</b></div>
          </div>
          <button class="btn btn-primary btn-block" id="tradeBtn" disabled>Купить CHR</button>
          <p class="impact-note" style="margin:11px 0 0">Цена общая для всех: ваша покупка толкает её вверх, продажа — вниз. Боты торгуют параллельно и тоже влияют на рынок. Стартовый баланс — 100 CR.</p>
        </div>
      </div>

      <div class="stack">
        <div class="card portfolio-card">
          <div class="eyebrow">портфель</div>
          <div class="portfolio-balance" id="portfolioTotal">—</div>
          <div class="portfolio-sub">Общая стоимость в CR</div>
          <div class="portfolio-rows">
            <div class="p-row"><span>Баланс CR</span><b id="pCoins">—</b></div>
            <div class="p-row"><span>CharCoin (CHR)</span><b id="pChr">—</b></div>
            <div class="p-row"><span>Стоимость CHR</span><b id="pValue">—</b></div>
            <div class="p-row"><span>Вложено в CHR</span><b id="pCost">—</b></div>
            <div class="p-row"><span>P&L</span><b id="pPnl">—</b></div>
          </div>
          <a href="#/profile" class="btn btn-ghost btn-block btn-sm" style="margin-top:12px">Настроить профиль</a>
        </div>

        <div class="card feed-card">
          <div class="row-between" style="margin-bottom:9px">
            <div>
              <div class="eyebrow">лента</div>
              <div style="font-size:15px;font-weight:750;letter-spacing:-.02em;margin-top:4px">Последние сделки</div>
            </div>
            <span class="badge"><span class="dot live"></span> live</span>
          </div>
          <div class="feed-list" id="feedList"><div class="empty" style="min-height:120px"><p>Ждём первые сделки…</p></div></div>
        </div>

        <div class="card leader-card">
          <div class="eyebrow">топ</div>
          <div style="font-size:15px;font-weight:750;letter-spacing:-.02em;margin:4px 0 8px">Богатейшие трейдеры</div>
          <div id="leaders"><div class="empty" style="min-height:100px"><p>Считаем портфели…</p></div></div>
        </div>
      </div>
    </div>

    <section class="card nft-section">
      <div class="row-between nft-head">
        <div>
          <div class="eyebrow">nft · коллекция</div>
          <div class="nft-title">NFT-маркет CharMsg</div>
          <p class="hint">Уникальные картинки с эффектами. Создавать может админ и ранг «${rankInfo(NFT_MIN_RANK).name}» и выше, покупать — любой пользователь.</p>
        </div>
        <div class="row wrap">
          <span class="badge" id="nftAccess">—</span>
          <button class="btn btn-primary btn-sm" id="releaseNftsBtn" type="button" hidden>Выпустить серию</button>
          <button class="btn btn-primary btn-sm" id="createNftBtn" type="button">Создать NFT</button>
        </div>
      </div>
      <div class="seg nft-filters" id="nftFilters">
        <button class="seg-btn active" type="button" data-nft-filter="sale">В продаже</button>
        <button class="seg-btn" type="button" data-nft-filter="all">Все</button>
        <button class="seg-btn" type="button" data-nft-filter="mine">Мои</button>
      </div>
      <div class="nft-grid" id="nftGrid"></div>
    </section>`;

  const $ = (id) => container.querySelector(`#${id}`);
  const priceBig = $("priceBig");
  const deltaChip = $("deltaChip");
  const chartWrap = $("chartWrap");
  const botsBadge = $("botsBadge");
  const metaVolume = $("metaVolume");
  const metaLiq = $("metaLiq");
  const metaTrades = $("metaTrades");
  const buyTab = $("buyTab");
  const sellTab = $("sellTab");
  const amountEl = $("tradeAmount");
  const amountSuffix = $("amountSuffix");
  const amountLabel = $("amountLabel");
  const tradeAvail = $("tradeAvail");
  const estGet = $("estGet");
  const estPrice = $("estPrice");
  const estImpact = $("estImpact");
  const tradeBtn = $("tradeBtn");
  const portfolioTotal = $("portfolioTotal");
  const pCoins = $("pCoins");
  const pChr = $("pChr");
  const pValue = $("pValue");
  const pCost = $("pCost");
  const pPnl = $("pPnl");
  const feedList = $("feedList");
  const leaders = $("leaders");
  const nftGrid = $("nftGrid");
  const nftAccess = $("nftAccess");
  const nftFilters = $("nftFilters");
  const createNftBtn = $("createNftBtn");

  const marketPrice = () => Number(state.market?.price) || 100;
  const liquidity = () => Math.max(1000, Number(state.market?.liq) || 12000);

  function available() {
    if (!state.profile) return 0;
    return side === "buy" ? Number(state.profile.coins) || 0 : Number(state.profile.chr) || 0;
  }

  function estimate(raw) {
    const price = marketPrice();
    const liq = liquidity();
    const amount = Math.max(0, Number(raw) || 0);
    if (side === "buy") {
      const cr = Math.min(amount, available());
      const impact = clamp(cr / liq, 0, 0.4);
      const chr = cr / (price * (1 + impact / 2));
      return { cr, chr, impact, avg: cr / Math.max(chr, 1e-9) };
    }
    const chr = Math.min(amount, available());
    const notional = chr * price;
    const impact = clamp(notional / liq, 0, 0.4);
    const cr = chr * price * (1 - impact / 2);
    return { cr, chr, impact, avg: cr / Math.max(chr, 1e-9) };
  }

  function refreshTradeUi() {
    if (!state.profile) {
      tradeBtn.disabled = true;
      tradeBtn.textContent = "Сначала создайте профиль";
      tradeAvail.textContent = "нет профиля";
      return;
    }
    const price = marketPrice();
    const est = estimate(amountEl.value);
    const avail = available();
    tradeAvail.textContent = side === "buy" ? `${fmtNum(avail)} CR доступно` : `${fmtNum(avail, 2)} CHR доступно`;
    estGet.textContent = side === "buy" ? `${fmtNum(est.chr, est.chr < 10 ? 4 : 2)} CHR` : `${fmtNum(est.cr)} CR`;
    estPrice.textContent = est.chr > 0 ? `${priceFmt(est.avg)} CR` : "—";
    estImpact.textContent = `${(est.impact * 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    const amount = Number(amountEl.value) || 0;
    tradeBtn.disabled = !(amount > 0 && avail > 0);
    tradeBtn.textContent = side === "buy" ? "Купить CHR" : "Продать CHR";
    if (side === "buy") {
      amountLabel.textContent = "Сумма в CR";
      amountSuffix.textContent = "CR";
      amountEl.placeholder = "0.00";
    } else {
      amountLabel.textContent = "Количество CHR";
      amountSuffix.textContent = "CHR";
      amountEl.placeholder = "0.0000";
    }
  }

  function refreshPortfolio() {
    const price = marketPrice();
    const p = state.profile;
    if (!p) {
      portfolioTotal.textContent = "—";
      pCoins.textContent = "—";
      pChr.textContent = "—";
      pValue.textContent = "—";
      pCost.textContent = "—";
      pPnl.textContent = "—";
      return;
    }
    const coins = Number(p.coins) || 0;
    const chr = Number(p.chr) || 0;
    const cost = Number(p.chrCost) || 0;
    const value = chr * price;
    const total = coins + value;
    const pnl = value - cost;
    portfolioTotal.textContent = `${fmtNum(total, 2)} CR`;
    pCoins.textContent = `${fmtNum(coins, 2)} CR`;
    pChr.textContent = `${fmtNum(chr, chr < 1 ? 4 : 2)} CHR`;
    pValue.textContent = `${fmtNum(value, 2)} CR`;
    pCost.textContent = `${fmtNum(cost, 2)} CR`;
    pPnl.textContent = `${pnl >= 0 ? "+" : ""}${fmtNum(pnl, 2)} CR`;
    pPnl.style.color = pnl >= 0 ? "var(--pos)" : "var(--neg)";
  }

  function refreshChartAndPrice() {
    const market = state.market || { price: 100, history: [] };
    const price = Number(market.price) || 100;
    priceBig.textContent = priceFmt(price);
    chartWrap.innerHTML = buildChart(market.history);
    const now = Date.now();
    const history = (market.history || []).filter((p) => p && p.t >= now - 86_400_000);
    const base = history.length ? history[0].p : price;
    const delta = base ? ((price - base) / base) * 100 : 0;
    deltaChip.textContent = fmtPct(delta);
    deltaChip.classList.toggle("neg", delta < 0);
    botsBadge.innerHTML = market.bots === false ? "боты выключены" : '<span class="dot live"></span> боты активны';
    metaVolume.textContent = fmtNum(market.volume || 0);
    metaLiq.textContent = fmtNum(market.liq || 12000);
    metaTrades.textContent = String(state.trades.length);
  }

  function refreshFeed() {
    const trades = state.trades || [];
    if (!trades.length) {
      feedList.innerHTML = `<div class="empty" style="min-height:120px"><p>Ждём первые сделки…</p></div>`;
      return;
    }
    feedList.innerHTML = trades
      .map((t) => {
        if (t.isNft) {
          return `<div class="feed-row nft-feed-row">
            <span class="side-badge nft">◈</span>
            <span class="feed-nick ${t.isAdmin ? "nick-admin" : ""}" data-uid="${escapeHtml(t.uid)}" title="${escapeHtml(t.nick || "")}">${escapeHtml(t.nick || "Аноним")}</span>
            <span class="dm-tag">nft</span>
            <span class="feed-amount">${escapeHtml(t.nftName || "NFT")}</span>
            <span class="feed-amount">−${fmtNum(t.amountCr || 0, 2)} CR</span>
            <span class="feed-time">${fmtRelative(t.ts)}</span>
          </div>`;
        }
        const isBot = !!t.isBot;
        return `<div class="feed-row">
          <span class="side-badge ${t.side === "buy" ? "buy" : "sell"}">${t.side === "buy" ? "↑" : "↓"}</span>
          <span class="feed-nick ${t.isAdmin ? "nick-admin" : ""}" ${isBot ? "" : `data-uid="${escapeHtml(t.uid)}"`} title="${escapeHtml(t.nick || "")}">${escapeHtml(t.nick || "Аноним")}</span>
          ${isBot ? '<span class="dm-tag">bot</span>' : ""}
          <span class="feed-amount">${t.side === "buy" ? "+" : "−"}${fmtNum(t.amountChr || 0, 3)} CHR</span>
          <span class="feed-time">${fmtRelative(t.ts)}</span>
        </div>`;
      })
      .join("");
  }

  function refreshLeaders() {
    const price = marketPrice();
    const users = [...state.users.values()]
      .filter((u) => u && u.nick)
      .map((u) => ({ ...u, portfolio: (Number(u.coins) || 0) + (Number(u.chr) || 0) * price }))
      .sort((a, b) => b.portfolio - a.portfolio);
    const own = state.profile;
    let list = users.slice(0, 8);
    if (own && !list.some((u) => u.uid === own.uid || u.id === own.uid)) list = [...list, own];
    leaders.innerHTML = list
      .map((u, i) => {
        const uid = u.uid || u.id;
        return `<div class="leader-row" data-uid="${escapeHtml(uid)}">
          <span class="leader-rank">${i + 1}</span>
          ${avatarData(u.nick, u.avatar, 26)}
          <span class="leader-nick ${u.isAdmin ? "nick-admin" : ""}">${escapeHtml(u.nick)}</span>
          ${rankBadge(rankOf(u), { compact: true })}
          <span class="leader-value">${fmtNum(u.portfolio, 2)} CR</span>
        </div>`;
      })
      .join("");
  }

  function effectName(key) {
    return NFT_EFFECTS.find((e) => e.key === key)?.name || "Без эффекта";
  }

  function nftCardHtml(nft) {
    const image = safeUrl(nft.image || "");
    const own = nft.ownerUid === state.uid;
    const owner = userOf(nft.ownerUid) || { nick: nft.ownerNick || "Аноним", avatar: "" };
    const price = Number(nft.price) || 0;
    const cap = nftResaleLimit(nft);
    const eligibleSale = nft.forSale && price <= cap;
    return `<article class="nft-card" data-nft="${nft.id}">
      <div class="nft-art ${effectClass(nft.effect)}">
        ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : `<span class="nft-noimg">◈</span>`}
        <span class="nft-effect">${escapeHtml(effectName(nft.effect))}</span>
        ${nft.forSale ? `<span class="nft-price-tag">${fmtNum(price, 2)} CR</span>` : ""}
      </div>
      <div class="nft-body">
        <div class="nft-card-top">
          <h3>${escapeHtml(nftTitle(nft))}</h3>
          ${nft.forSale ? '<span class="badge solid">продаётся</span>' : '<span class="badge">в коллекции</span>'}
        </div>
        ${nft.seriesId ? `<p class="hint">${nft.upgraded ? "Улучшенная копия" : `Базовая копия · улучшение ${fmtNum(nft.upgradePrice)} CR`}</p>` : ""}
        ${nft.description ? `<p class="nft-desc">${escapeHtml(nft.description)}</p>` : ""}
        <div class="nft-owner" data-uid="${escapeHtml(nft.ownerUid)}" role="button" tabindex="0">
          ${avatarData(owner.nick, owner.avatar, 24)}
          <span class="grow">${escapeHtml(owner.nick || nft.ownerNick || "Аноним")}</span>
          ${rankBadge(rankOf(owner), { compact: true })}
        </div>
        <div class="nft-actions">
          ${own
            ? `${nft.lastPrice > 0 ? `<p class="hint">Максимум ${fmtNum(cap, 2)} CR (3× от покупки)</p>` : ""}
               <input class="input nft-price-input" data-nft-price="${nft.id}" inputmode="decimal" placeholder="цена CR" value="${nft.forSale ? price : ""}" />
               <button class="btn btn-sm btn-primary" data-nft-list="${nft.id}" type="button">${nft.forSale ? "Обновить" : "Выставить"}</button>
               ${nft.forSale ? `<button class="btn btn-sm btn-ghost" data-nft-unlist="${nft.id}" type="button">Снять</button>` : ""}
               ${nft.seriesId && !nft.upgraded && nft.lastPrice > 0 ? `<button class="btn btn-sm btn-primary" data-nft-enhance="${escapeHtml(nft.id)}" type="button">Улучшить за ${fmtNum(nft.upgradePrice)} CR</button>` : ""}
               <button class="btn btn-sm btn-ghost" data-nft-gift="${escapeHtml(nft.id)}" type="button">Передать</button>
               <button class="btn btn-sm btn-ghost" data-nft-feature="${escapeHtml(nft.id)}" type="button">${state.profile?.featuredNftId === nft.id ? "Убрать из профиля" : "В профиль"}</button>
               <button class="btn btn-sm btn-danger" data-nft-delete="${nft.id}" type="button" title="Удалить NFT">×</button>`
            : eligibleSale
              ? `<button class="btn btn-sm btn-primary btn-block" data-nft-buy="${nft.id}" type="button">Купить за ${fmtNum(price, 2)} CR</button>`
              : `<span class="hint">${nft.forSale ? "Цена выше лимита перепродажи" : "Не выставлен на продажу"}</span>`}
        </div>
      </div>
    </article>`;
  }

  function refreshNfts() {
    const all = state.nfts || [];
    const list = all.filter((nft) => {
      if (nftFilter === "sale") return !!nft.forSale && Number(nft.price) <= nftResaleLimit(nft);
      if (nftFilter === "mine") return nft.ownerUid === state.uid;
      return true;
    });
    $("releaseNftsBtn").hidden = !state.admin;
    const allowed = canCreateNft(state.profile);
    nftAccess.textContent = allowed
      ? "создание открыто"
      : `NFT с ранга «${rankInfo(NFT_MIN_RANK).name}»`;
    createNftBtn.disabled = !allowed;
    createNftBtn.title = allowed ? "Создать свой NFT" : `Нужен ранг «${rankInfo(NFT_MIN_RANK).name}» или админ`;
    if (!list.length) {
      nftGrid.innerHTML = `<div class="empty" style="min-height:170px"><p>${nftFilter === "mine" ? "У вас пока нет NFT. Создайте первый или купите на маркете." : "Здесь пока нет NFT. Первый появится, как только кто-то выставит его на продажу."}</p></div>`;
      return;
    }
    nftGrid.innerHTML = list.map(nftCardHtml).join("");
  }

  async function attemptNftBuy(nftId) {
    if (!state.profile) {
      toast("Сначала создайте профиль", "error");
      return;
    }
    const nft = (state.nfts || []).find((n) => n.id === nftId);
    if (!nft) return;
    const ok = await confirmDialog(
      "Купить NFT?",
      `«${nft.name || "NFT"}» за ${fmtNum(nft.price || 0, 2)} CR. Сумма перейдёт продавцу, NFT станет вашим.`,
      "Купить"
    );
    if (!ok) return;
    try {
      const result = await buyNft(nftId, state.profile);
      toast(`NFT «${result.name}» куплен за ${fmtNum(result.price, 2)} CR`, "success");
    } catch (err) {
      toast(err.message || "Не удалось купить NFT", "error");
    }
  }

  function openReleaseNfts() {
    const modal = openModal(`
      <button class="modal-close" data-close aria-label="Закрыть">×</button>
      <h3 class="modal-title">Выпустить серию NFT</h3>
      <p class="modal-sub">Первое фото видно на базовой копии. После покупки игрок может один раз получить случайное фото, эффект и номер.</p>
      <form class="stack">
        <label class="field">Название<input class="input" name="title" required minlength="2" maxlength="60"></label>
        <label class="field">Описание<textarea class="textarea" name="description" maxlength="500"></textarea></label>
        <label class="field">Фото вариантов (2–5)<input class="input" name="files" type="file" accept="image/*" multiple></label>
        <label class="field">Или HTTPS-ссылки, по одной в строке<textarea class="textarea" name="links" rows="2"></textarea></label>
        <label class="field">Тираж<input class="input" name="count" type="number" min="1" max="50" value="10" required></label>
        <label class="field">Цена копии, CR<input class="input" name="price" type="number" min="1" max="100000" value="10" required></label>
        <label class="field">Цена улучшения, CR<input class="input" name="upgradePrice" type="number" min="1" max="100000" value="5" required></label>
        <p class="error-text" role="alert"></p>
        <button class="btn btn-primary btn-block" type="submit">Выставить тираж</button>
      </form>`);
    const form = modal.body.querySelector("form");
    const button = form.querySelector("button");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      const { title, description, files, links, count, price, upgradePrice } = form.elements;
      try {
        const urls = links.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        if (files.files.length + urls.length < 2 || files.files.length + urls.length > 5) throw new Error("Добавьте от 2 до 5 фото.");
        const photos = await Promise.all([...files.files].map((file) =>
          imageFileToDataUrl(file, { maxW: 420, maxH: 420, quality: 0.65 })
        ));
        const result = await releaseNfts({
          name: title.value, description: description.value, photos: [...photos, ...urls],
          count: Number(count.value), price: Number(price.value), upgradePrice: Number(upgradePrice.value)
        });
        modal.close();
        toast(`Выставлено копий: ${result.count}`, "success");
      } catch (error) {
        form.querySelector('[role="alert"]').textContent = error.message;
        button.disabled = false;
      }
    });
  }

  function openCreateNft() {
    if (!state.profile) {
      toast("Сначала создайте профиль", "error");
      return;
    }
    if (!canCreateNft(state.profile)) {
      toast(`Создавать NFT можно с ранга «${rankInfo(NFT_MIN_RANK).name}»`, "error");
      return;
    }
    const draft = { image: "", effect: "none" };
    const modal = openModal(
      `<button class="modal-close" data-close aria-label="Закрыть">×</button>
       <h3 class="modal-title">Создать NFT</h3>
       <p class="modal-sub">Картинка, название и эффект. Выставьте цену — и NFT появится на бирже, где его сможет купить любой.</p>
       <div class="nft-create-grid">
         <div>
           <div class="nft-art nft-preview" id="nftPreview"><span class="nft-noimg">◈</span></div>
           <div class="row wrap" style="gap:7px;margin-top:9px">
             <span class="btn btn-sm file-btn">Загрузить картинку<input type="file" id="nftFile" accept="image/*" /></span>
           </div>
           <input class="input" id="nftUrl" placeholder="или ссылка https://…" style="margin-top:8px" autocomplete="off" />
         </div>
         <div class="stack" style="gap:12px">
           <div class="field">
             <label for="nftName">Название</label>
             <input class="input" id="nftName" maxlength="60" placeholder="Например, Purple Genesis" />
           </div>
           <div class="field">
             <label for="nftNumber">Номер NFT (необязательно)</label>
             <input class="input" id="nftNumber" type="number" min="1" max="999999999" step="1" placeholder="Например, 42" />
           </div>
           <div class="field">
             <label for="nftDesc">Описание</label>
             <textarea class="textarea" id="nftDesc" maxlength="500" rows="2" placeholder="Что особенного в этом NFT?"></textarea>
           </div>
           <div class="field">
             <label>Эффект</label>
             <div class="quick-row" id="nftEffects">
               ${NFT_EFFECTS.map((e, i) => `<button type="button" class="quick-btn ${i === 0 ? "active" : ""}" data-effect="${e.key}">${e.name}</button>`).join("")}
             </div>
           </div>
           <div class="field">
             <label for="nftPrice">Цена продажи в CR</label>
             <input class="input" id="nftPrice" inputmode="decimal" placeholder="Например, 250" />
             ${state.admin ? `<label for="nftStakeCr">Оценка ставки в апгрейдере, CR</label>
               <input class="input" id="nftStakeCr" type="number" min="1" max="100000" step="1" value="1" />`
               : '<p class="hint">Ставка этим NFT в апгрейдере — 1 CR. Максимальная цена цели — 50 CR.</p>'}
             <div class="hint">0 — оставить в коллекции без продажи. Выставить можно позже.</div>
           </div>
         </div>
       </div>
       <div class="error-text" id="nftError"></div>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-close type="button">Отмена</button>
         <button class="btn btn-primary" id="nftSave" type="button">Создать NFT</button>
       </div>`,
      { className: "nft-create-modal" }
    );

    const body = modal.body;
    const preview = body.querySelector("#nftPreview");
    const paint = () => {
      const url = safeUrl(draft.image);
      preview.className = `nft-art nft-preview ${effectClass(draft.effect)}`;
      preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" />` : `<span class="nft-noimg">◈</span>`;
    };
    paint();

    body.querySelector("#nftFile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        draft.image = await imageFileToDataUrl(file, { maxW: 640, maxH: 640, quality: 0.82 });
        paint();
      } catch (err) {
        toast(err.message || "Не удалось обработать картинку", "error");
      } finally {
        e.target.value = "";
      }
    });
    body.querySelector("#nftUrl").addEventListener("input", (e) => {
      const url = safeUrl(e.target.value);
      if (url) {
        draft.image = url;
        paint();
      }
    });
    body.querySelector("#nftEffects").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-effect]");
      if (!btn) return;
      draft.effect = btn.dataset.effect;
      body.querySelectorAll("[data-effect]").forEach((b) => b.classList.toggle("active", b === btn));
      paint();
    });
    body.querySelector("#nftSave").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errorEl = body.querySelector("#nftError");
      errorEl.textContent = "";
      btn.disabled = true;
      btn.textContent = "Создаём…";
      try {
        await createNft(state.profile, {
          name: body.querySelector("#nftName").value,
          description: body.querySelector("#nftDesc").value,
          image: draft.image,
          effect: draft.effect,
          price: Number(body.querySelector("#nftPrice").value) || 0,
          number: body.querySelector("#nftNumber").value ? Number(body.querySelector("#nftNumber").value) : null,
          adminStakeCr: Number(body.querySelector("#nftStakeCr")?.value ?? 1)
        });
        modal.close();
        nftFilter = "mine";
        nftFilters.querySelectorAll("[data-nft-filter]").forEach((b) => b.classList.toggle("active", b.dataset.nftFilter === "mine"));
        refreshNfts();
        toast("NFT создан", "success");
      } catch (err) {
        errorEl.textContent = err.message || "Не удалось создать NFT";
        btn.disabled = false;
        btn.textContent = "Создать NFT";
      }
    });
  }

  function refresh() {
    refreshChartAndPrice();
    refreshTradeUi();
    refreshPortfolio();
    refreshFeed();
    refreshLeaders();
    refreshNfts();
  }

  function setSide(next) {
    side = next;
    buyTab.classList.toggle("active", side === "buy");
    sellTab.classList.toggle("active", side === "sell");
    amountEl.value = "";
    refreshTradeUi();
  }

  buyTab.addEventListener("click", () => setSide("buy"));
  sellTab.addEventListener("click", () => setSide("sell"));
  amountEl.addEventListener("input", refreshTradeUi);
  amountEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptTrade();
  });

  container.querySelectorAll("[data-frac]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const frac = Number(btn.dataset.frac);
      const avail = available();
      if (!avail) return;
      const value = side === "buy" ? avail * frac : avail * frac;
      amountEl.value = side === "buy" ? value.toFixed(2) : value.toFixed(4);
      refreshTradeUi();
    });
  });

  let trading = false;
  async function attemptTrade() {
    if (trading || !state.profile) return;
    const raw = Number(amountEl.value);
    if (!(raw > 0)) {
      toast("Введите сумму", "error");
      return;
    }
    const price = marketPrice();
    const est = estimate(raw);
    if (est.chr <= 0) {
      toast(side === "buy" ? "Недостаточно CR" : "У вас нет CHR", "error");
      return;
    }
    if (side === "buy" && est.cr < 1) {
      toast("Минимальная покупка — 1 CR", "error");
      return;
    }
    trading = true;
    tradeBtn.disabled = true;
    tradeBtn.textContent = "Отправляем сделку…";
    try {
      const result = await trade(state.uid, side, raw);
      toast(
        side === "buy"
          ? `Куплено ${fmtNum(result.amountChr, 4)} CHR за ${fmtNum(result.amountCr, 2)} CR`
          : `Продано ${fmtNum(result.amountChr, 4)} CHR за ${fmtNum(result.amountCr, 2)} CR`,
        "success"
      );
      amountEl.value = "";
      refreshTradeUi();
    } catch (err) {
      toast(err.message || "Сделка не прошла", "error");
    } finally {
      trading = false;
      refreshTradeUi();
      void price;
    }
  }
  tradeBtn.addEventListener("click", attemptTrade);

  feedList.addEventListener("click", (e) => {
    const node = e.target.closest("[data-uid]");
    if (node?.dataset.uid) openProfileModal(node.dataset.uid);
  });
  leaders.addEventListener("click", (e) => {
    const node = e.target.closest("[data-uid]");
    if (node?.dataset.uid) openProfileModal(node.dataset.uid);
  });

  nftFilters.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-nft-filter]");
    if (!btn) return;
    nftFilter = btn.dataset.nftFilter;
    nftFilters.querySelectorAll("[data-nft-filter]").forEach((b) => b.classList.toggle("active", b === btn));
    refreshNfts();
  });
  createNftBtn.addEventListener("click", openCreateNft);
  $("releaseNftsBtn").addEventListener("click", openReleaseNfts);

  nftGrid.addEventListener("click", async (e) => {
    const enhanceButton = e.target.closest("[data-nft-enhance]");
    if (enhanceButton) {
      const nft = state.nfts.find((item) => item.id === enhanceButton.dataset.nftEnhance);
      if (!nft) return;
      const ok = await confirmDialog("Улучшить NFT?", `За ${fmtNum(nft.upgradePrice)} CR копия получит случайное фото, эффект и номер. Улучшение доступно один раз.`, "Улучшить");
      if (!ok) return;
      enhanceButton.disabled = true;
      try {
        const result = await enhanceNft(nft.id);
        toast(`Улучшение применено: #${result.number}, ${effectName(result.effect)}`, "success");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        enhanceButton.disabled = false;
      }
      return;
    }
    const giftButton = e.target.closest("[data-nft-gift]");
    if (giftButton) {
      const nft = state.nfts.find((item) => item.id === giftButton.dataset.nftGift);
      if (!nft) return;
      const modal = openModal(`
        <button class="modal-close" data-close aria-label="Закрыть">×</button>
        <h3 class="modal-title">Передать ${escapeHtml(nftTitle(nft))}</h3>
        <p class="modal-sub">Получатель получит NFT бесплатно. С твоего баланса спишется комиссия 1 CR.</p>
        <form>
          <div class="field">
            <label for="giftRecipient">Ник получателя</label>
            <input class="input" id="giftRecipient" name="recipient" autocomplete="off" minlength="2" maxlength="18" required />
          </div>
          <p class="error-text" role="alert"></p>
          <button class="btn btn-primary btn-block" type="submit">Передать за 1 CR</button>
        </form>`);
      const form = modal.body.querySelector("form");
      const submit = form.querySelector("button");
      form.elements.recipient.focus();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          const result = await giftNft(nft.id, form.elements.recipient.value);
          modal.close();
          toast(`NFT передан игроку ${result.recipientNick}`, "success");
        } catch (error) {
          form.querySelector('[role="alert"]').textContent = error.message;
          submit.disabled = false;
        }
      });
      return;
    }
    const featureBtn = e.target.closest("[data-nft-feature]");
    if (featureBtn) {
      const key = featureBtn.dataset.nftFeature;
      const selected = state.profile?.featuredNftId === key;
      featureBtn.disabled = true;
      try {
        await setFeaturedNft(selected ? null : key);
        toast(selected ? "NFT убран из профиля" : "NFT закреплён в профиле", "success");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        featureBtn.disabled = false;
      }
      return;
    }
    const buyBtn = e.target.closest("[data-nft-buy]");
    if (buyBtn) {
      await attemptNftBuy(buyBtn.dataset.nftBuy);
      return;
    }
    const listBtn = e.target.closest("[data-nft-list]");
    if (listBtn) {
      const id = listBtn.dataset.nftList;
      const input = nftGrid.querySelector(`[data-nft-price="${id}"]`);
      const price = Number(input?.value) || 0;
      if (price <= 0) {
        toast("Введите цену больше нуля", "error");
        return;
      }
      try {
        await setNftSale(id, state.profile, price);
        toast(`NFT выставлен за ${fmtNum(price, 2)} CR`, "success");
      } catch (err) {
        toast(err.message || "Не удалось выставить NFT", "error");
      }
      return;
    }
    const unlistBtn = e.target.closest("[data-nft-unlist]");
    if (unlistBtn) {
      try {
        await setNftSale(unlistBtn.dataset.nftUnlist, state.profile, 0);
        toast("NFT снят с продажи", "success");
      } catch (err) {
        toast(err.message || "Не удалось снять NFT", "error");
      }
      return;
    }
    const deleteBtn = e.target.closest("[data-nft-delete]");
    if (deleteBtn) {
      const nft = (state.nfts || []).find((n) => n.id === deleteBtn.dataset.nftDelete);
      const ok = await confirmDialog("Удалить NFT?", `«${nft?.name || "NFT"}» исчезнет из коллекции без возможности восстановления.`, "Удалить", true);
      if (!ok) return;
      try {
        await deleteNft(deleteBtn.dataset.nftDelete, state.profile);
        toast("NFT удалён", "success");
      } catch (err) {
        toast(err.message || "Не удалось удалить NFT", "error");
      }
      return;
    }
    const owner = e.target.closest("[data-uid]");
    if (owner?.dataset.uid) openProfileModal(owner.dataset.uid);
  });

  const unsub = onChange(refresh);
  refresh();
  tickMarket();

  return () => unsub();
}
