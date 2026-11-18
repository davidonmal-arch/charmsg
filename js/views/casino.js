import { state, onChange } from "../state.js";
import { openProfileModal } from "../ui.js";
import {
  CASINO_MAX_BET,
  CASINO_MIN_BET,
  UPGRADE_MAX_CHANCE,
  UPGRADE_MIN_CHANCE,
  effectClass,
  nftTitle,
  playUpgrade,
  rouletteColor,
  spinRoulette
} from "../store.js";
import { clamp, escapeHtml, fmtNum, fmtRelative, safeUrl, toast } from "../util.js";

const SEGMENTS = 37;
const SEG_ANGLE = 360 / SEGMENTS;

function nftValue(nft) {
  return Math.max(1, Number(nft?.price) || Number(nft?.lastPrice) || 100);
}

function nftArt(nft) {
  const image = safeUrl(nft?.image || "");
  return image
    ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />`
    : `<span class="nft-noimg">◈</span>`;
}

function wheelGradient() {
  const stops = [];
  for (let n = 0; n < SEGMENTS; n += 1) {
    const color = rouletteColor(n);
    const from = (n * SEG_ANGLE).toFixed(3);
    const to = ((n + 1) * SEG_ANGLE).toFixed(3);
    const fill = color === "red" ? "#8e2340" : color === "black" ? "#1b1420" : "#2c7a4b";
    stops.push(`${fill} ${from}deg ${to}deg`);
  }
  return `conic-gradient(from 0deg, ${stops.join(", ")})`;
}

function wheelNumbersHtml() {
  return Array.from({ length: SEGMENTS }, (_, n) => {
    const angle = (n + 0.5) * SEG_ANGLE;
    return `<span class="roulette-num ${rouletteColor(n)}" style="--a:${angle.toFixed(3)}deg">${n}</span>`;
  }).join("");
}

function numberBoardHtml() {
  return Array.from({ length: SEGMENTS }, (_, n) => {
    const color = rouletteColor(n);
    return `<button type="button" class="roulette-cell ${color}" data-roulette-number="${n}">${n}</button>`;
  }).join("");
}

export function mountCasino(container) {
  let game = "roulette";
  let betType = "red";
  let betValue = null;
  let betAmount = 10;
  let rouletteTurns = 0;
  let spinning = false;
  let spinTimer = null;

  let stakeKind = "cr";
  let targetKind = "cr";
  let stakeNftId = "";
  let targetNftId = "";
  let needleTurns = 0;
  let upgrading = false;
  let upgradeTimer = null;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">удача за charcoin</div>
        <h1 class="page-title">Казино</h1>
        <p class="page-sub">Рулетка на красное, чёрное или число и апгрейдер: поставьте CR или свой NFT и попробуйте забрать цель дороже. Дом всегда играет по своим правилам.</p>
      </div>
      <div class="row wrap">
        <span class="badge solid">Баланс: <b id="casinoBalance">—</b> CR</span>
        <span class="badge">ставки от ${CASINO_MIN_BET} CR</span>
      </div>
    </div>

    <div class="casino-tabs" id="casinoTabs">
      <button type="button" class="casino-tab active" data-game="roulette">🎡 Рулетка</button>
      <button type="button" class="casino-tab" data-game="upgrade">⬆ Апгрейдер</button>
    </div>

    <div class="casino-grid">
      <div class="stack" style="gap:14px">
        <section class="card casino-panel" data-game-panel="roulette">
          <div class="roulette-layout">
            <div class="roulette-stage">
              <div class="roulette-pointer" aria-hidden="true"></div>
              <div class="roulette-wheel" id="rouletteWheel" style="background:${wheelGradient()}">
                <div class="roulette-face">${wheelNumbersHtml()}</div>
                <div class="roulette-hub"><span>Char</span><b>CASINO</b></div>
              </div>
              <div class="roulette-result" id="rouletteResult">
                <span class="roulette-result-dot" id="rouletteResultDot"></span>
                <span id="rouletteResultText">Сделайте ставку и крутите</span>
              </div>
            </div>

            <div class="roulette-bets">
              <div class="roulette-quick" id="rouletteColorBets">
                <button type="button" class="roulette-color red active" data-roulette-color="red"><span class="dot"></span>Красное ×2</button>
                <button type="button" class="roulette-color black" data-roulette-color="black"><span class="dot"></span>Чёрное ×2</button>
              </div>
              <div class="roulette-board" id="rouletteBoard">${numberBoardHtml()}</div>
              <div class="field" style="margin-top:12px">
                <label for="rouletteAmount">Ставка в CR</label>
                <div class="amount-wrap">
                  <input class="input" id="rouletteAmount" inputmode="numeric" value="10" autocomplete="off" />
                  <span class="amount-suffix">CR</span>
                </div>
                <div class="quick-row" id="rouletteQuick">
                  <button type="button" class="quick-btn" data-bet-amount="10">10</button>
                  <button type="button" class="quick-btn" data-bet-amount="50">50</button>
                  <button type="button" class="quick-btn" data-bet-amount="100">100</button>
                  <button type="button" class="quick-btn" data-bet-amount="max">MAX</button>
                </div>
              </div>
              <div class="casino-bet-summary" id="rouletteSummary">Ставка: красное · 10 CR</div>
              <button type="button" class="btn btn-primary btn-block casino-play" id="spinBtn">Крутить рулетку</button>
              <p class="hint" style="margin:9px 0 0">Красное и чёрное платят ×2, точное число — ×36. Зеро забирает ставки на цвет.</p>
            </div>
          </div>
        </section>

        <section class="card casino-panel hidden" data-game-panel="upgrade">
          <div class="upgrader-layout">
            <div class="up-side">
              <div class="up-side-head">
                <span>Вы ставите</span>
                <div class="seg seg-mini" id="stakeKindSeg">
                  <button type="button" class="seg-btn active" data-stake-kind="cr">CR</button>
                  <button type="button" class="seg-btn" data-stake-kind="nft">NFT</button>
                </div>
              </div>
              <div class="up-box" id="stakeCrBox">
                <div class="field">
                  <label for="stakeAmount">Сумма CR</label>
                  <div class="amount-wrap">
                    <input class="input" id="stakeAmount" inputmode="numeric" value="100" autocomplete="off" />
                    <span class="amount-suffix">CR</span>
                  </div>
                  <div class="quick-row" id="stakeQuick">
                    <button type="button" class="quick-btn" data-stake-amount="50">50</button>
                    <button type="button" class="quick-btn" data-stake-amount="100">100</button>
                    <button type="button" class="quick-btn" data-stake-amount="500">500</button>
                    <button type="button" class="quick-btn" data-stake-amount="max">MAX</button>
                  </div>
                </div>
              </div>
              <div class="up-box hidden" id="stakeNftBox">
                <div class="up-nft-list" id="stakeNftList"></div>
              </div>
            </div>

            <div class="up-wheel-stage">
              <div class="up-wheel" id="upWheel">
                <div class="up-zone" id="upZone"></div>
                <div class="up-needle" id="upNeedle"></div>
                <div class="up-center"><b id="upChance">—</b><span>шанс</span></div>
              </div>
              <div class="up-result" id="upResult">Выберите ставку и цель</div>
            </div>

            <div class="up-side">
              <div class="up-side-head">
                <span>Апгрейд на</span>
                <div class="seg seg-mini" id="targetKindSeg">
                  <button type="button" class="seg-btn active" data-target-kind="cr">CR</button>
                  <button type="button" class="seg-btn" data-target-kind="nft">NFT</button>
                </div>
              </div>
              <div class="up-box" id="targetCrBox">
                <div class="field">
                  <label for="targetAmount">Цель в CR</label>
                  <div class="amount-wrap">
                    <input class="input" id="targetAmount" inputmode="numeric" value="400" autocomplete="off" />
                    <span class="amount-suffix">CR</span>
                  </div>
                  <div class="quick-row" id="targetQuick">
                    <button type="button" class="quick-btn" data-target-amount="250">250</button>
                    <button type="button" class="quick-btn" data-target-amount="500">500</button>
                    <button type="button" class="quick-btn" data-target-amount="1000">1000</button>
                  </div>
                </div>
              </div>
              <div class="up-box hidden" id="targetNftBox">
                <div class="up-nft-list" id="targetNftList"></div>
              </div>
            </div>
          </div>

          <div class="up-footer">
            <div class="casino-bet-summary" id="upSummary">Ставка 100 CR → цель 400 CR</div>
            <button type="button" class="btn btn-primary casino-play" id="upgradeBtn">Запустить апгрейдер</button>
          </div>
          <p class="hint" style="margin:10px 0 0">Шанс = стоимость ставки / стоимость цели, от ${Math.round(UPGRADE_MIN_CHANCE * 100)}% до ${Math.round(UPGRADE_MAX_CHANCE * 100)}%. Обычная ставка NFT оценивается в 1 CR. Максимальная цена цели для такой ставки — 50 CR. Если вы проиграли, ставка уходит дому. NFT-цель должна быть выставлена на продажу, а продавец получает её цену только при вашей победе.</p>
        </section>
      </div>

      <aside class="stack" style="gap:14px">
        <div class="card casino-feed">
          <div class="row-between" style="margin-bottom:10px">
            <div>
              <div class="eyebrow">лента</div>
              <div class="casino-feed-title">Последние игры</div>
            </div>
            <span class="badge"><span class="dot live"></span> live</span>
          </div>
          <div class="casino-feed-list" id="casinoFeed"><div class="empty" style="min-height:120px"><p>Пока никто не играл. Будьте первым.</p></div></div>
        </div>

        <div class="card casino-rules">
          <div class="eyebrow">правила</div>
          <div class="casino-feed-title" style="margin-bottom:8px">Как это работает</div>
          <ul class="casino-rule-list">
            <li>Ставки списываются с баланса CR мгновенно и без возврата при проигрыше.</li>
            <li>Апгрейдер — сделка с домом: вы получаете цель только при победе.</li>
            <li>NFT-цель снимается с продажи и переходит победителю.</li>
            <li>Администрация не возвращает проигранные средства.</li>
          </ul>
        </div>
      </aside>
    </div>`;

  const $ = (id) => container.querySelector(`#${id}`);
  const balanceEl = $("casinoBalance");
  const wheel = $("rouletteWheel");
  const resultDot = $("rouletteResultDot");
  const resultText = $("rouletteResultText");
  const amountEl = $("rouletteAmount");
  const summaryEl = $("rouletteSummary");
  const spinBtn = $("spinBtn");
  const colorBets = $("rouletteColorBets");
  const board = $("rouletteBoard");
  const stakeKindSeg = $("stakeKindSeg");
  const targetKindSeg = $("targetKindSeg");
  const stakeCrBox = $("stakeCrBox");
  const stakeNftBox = $("stakeNftBox");
  const targetCrBox = $("targetCrBox");
  const targetNftBox = $("targetNftBox");
  const stakeNftList = $("stakeNftList");
  const targetNftList = $("targetNftList");
  const stakeAmountEl = $("stakeAmount");
  const targetAmountEl = $("targetAmount");
  const upZone = $("upZone");
  const upNeedle = $("upNeedle");
  const upChanceEl = $("upChance");
  const upResult = $("upResult");
  const upSummary = $("upSummary");
  const upgradeBtn = $("upgradeBtn");
  const feedEl = $("casinoFeed");

  const ownNfts = () => (state.nfts || []).filter((n) => n.ownerUid === state.uid);
  const saleNfts = () => (state.nfts || []).filter((n) => n.forSale && n.ownerUid !== state.uid);

  function selectedStakeNft() {
    return ownNfts().find((n) => n.id === stakeNftId) || null;
  }
  function selectedTargetNft() {
    return saleNfts().find((n) => n.id === targetNftId) || null;
  }

  function betLabel() {
    if (betType === "number") return `число ${betValue}`;
    return betType === "red" ? "красное" : "чёрное";
  }

  function refreshRouletteUi() {
    const amount = Math.floor(Number(amountEl.value) || 0);
    betAmount = amount;
    colorBets.querySelectorAll("[data-roulette-color]").forEach((btn) => {
      btn.classList.toggle("active", betType === btn.dataset.rouletteColor);
    });
    board.querySelectorAll("[data-roulette-number]").forEach((btn) => {
      btn.classList.toggle("active", betType === "number" && Number(btn.dataset.rouletteNumber) === betValue);
    });
    summaryEl.innerHTML = `Ставка: <b>${escapeHtml(betLabel())}</b> · <b>${fmtNum(amount, 0)} CR</b>`;
    spinBtn.disabled = spinning || !state.profile || amount < CASINO_MIN_BET || amount > CASINO_MAX_BET;
  }

  function setRouletteResult(text, tone = "") {
    resultText.textContent = text;
    resultDot.className = `roulette-result-dot ${tone}`;
  }

  function spinWheelTo(result) {
    rouletteTurns += 1;
    const center = (result + 0.5) * SEG_ANGLE;
    const target = rouletteTurns * 360 * 4 + (360 - center);
    wheel.style.transition = "transform 3.7s cubic-bezier(.12,.78,.16,1)";
    wheel.style.transform = `rotate(${target}deg)`;
  }

  async function doSpin() {
    if (spinning) return;
    if (!state.profile) return toast("Сначала создайте профиль", "error");
    const amount = Math.floor(Number(amountEl.value) || 0);
    if (amount < CASINO_MIN_BET) return toast(`Минимальная ставка — ${CASINO_MIN_BET} CR`, "error");
    if (amount > CASINO_MAX_BET) return toast(`Максимальная ставка — ${CASINO_MAX_BET.toLocaleString("ru-RU")} CR`, "error");
    if (betType === "number" && !Number.isInteger(betValue)) return toast("Выберите число от 0 до 36", "error");
    spinning = true;
    spinBtn.disabled = true;
    spinBtn.textContent = "Крутим…";
    setRouletteResult("Колесо вращается…");
    try {
      const result = await spinRoulette(state.profile, { betType, betValue, amount });
      spinWheelTo(result.result);
      if (spinTimer) clearTimeout(spinTimer);
      spinTimer = setTimeout(() => {
        const colorName = result.color === "red" ? "красное" : result.color === "black" ? "чёрное" : "зеро";
        if (result.win) {
          setRouletteResult(`Выпало ${result.result} (${colorName}) — выигрыш ${fmtNum(result.payout, 0)} CR`, "win");
          toast(`Победа! +${fmtNum(result.payout - result.amount, 0)} CR`, "success");
        } else {
          setRouletteResult(`Выпало ${result.result} (${colorName}) — ставка ${fmtNum(result.amount, 0)} CR потеряна`, "lose");
          toast(`Проигрыш ${fmtNum(result.amount, 0)} CR`, "error");
        }
        spinning = false;
        spinBtn.textContent = "Крутить рулетку";
        refreshRouletteUi();
      }, 3800);
    } catch (err) {
      setRouletteResult("Ставка не принята");
      spinning = false;
      spinBtn.textContent = "Крутить рулетку";
      refreshRouletteUi();
      toast(err.message || "Не удалось сделать ставку", "error");
    }
  }

  function nftStakeValue(nft) {
    const value = Number(nft.adminStakeCr);
    return state.admin && nft.createdBy === state.uid && Number.isInteger(value)
      && value >= 1 && value <= CASINO_MAX_BET ? value : 1;
  }

  function miniNftHtml(nft, { selected, attr, owner = false }) {
    return `<button type="button" class="up-nft ${selected ? "active" : ""}" ${attr}="${escapeHtml(nft.id)}">
      <span class="up-nft-art ${effectClass(nft.effect)}">${nftArt(nft)}</span>
      <span class="up-nft-body">
        <span class="up-nft-name">${escapeHtml(nftTitle(nft))}</span>
        <span class="up-nft-price">${fmtNum(owner ? nftValue(nft) : nftStakeValue(nft), 2)} CR</span>
        ${owner ? `<span class="up-nft-owner">${escapeHtml(nft.ownerNick || "Аноним")}</span>` : ""}
      </span>
    </button>`;
  }

  function refreshNftPickers() {
    const own = ownNfts();
    if (stakeNftId && !own.some((n) => n.id === stakeNftId)) stakeNftId = "";
    stakeNftList.innerHTML = own.length
      ? own.map((n) => miniNftHtml(n, { selected: n.id === stakeNftId, attr: "data-stake-nft" })).join("")
      : `<div class="hint" style="padding:12px 0">У вас нет NFT. Купите на бирже или создайте свой.</div>`;

    const sale = saleNfts();
    if (targetNftId && !sale.some((n) => n.id === targetNftId)) targetNftId = "";
    targetNftList.innerHTML = sale.length
      ? sale.map((n) => miniNftHtml(n, { selected: n.id === targetNftId, attr: "data-target-nft", owner: true })).join("")
      : `<div class="hint" style="padding:12px 0">Нет NFT в продаже. Апгрейд на деньги всё ещё доступен.</div>`;
  }

  function upgradeValues() {
    const stakeNft = selectedStakeNft();
    const targetNft = selectedTargetNft();
    const stakeValue = stakeKind === "cr" ? Math.max(0, Number(stakeAmountEl.value) || 0) : stakeNft ? nftStakeValue(stakeNft) : 0;
    const targetValue = targetKind === "cr" ? Math.max(0, Number(targetAmountEl.value) || 0) : targetNft ? nftValue(targetNft) : 0;
    const valid = stakeValue > 0 && targetValue > stakeValue && stakeValue / targetValue >= UPGRADE_MIN_CHANCE;
    const chance = valid ? clamp(stakeValue / targetValue, UPGRADE_MIN_CHANCE, UPGRADE_MAX_CHANCE) : 0;
    return { stakeNft, targetNft, stakeValue, targetValue, valid, chance };
  }

  function refreshUpgraderUi() {
    stakeKindSeg.querySelectorAll("[data-stake-kind]").forEach((b) => b.classList.toggle("active", b.dataset.stakeKind === stakeKind));
    targetKindSeg.querySelectorAll("[data-target-kind]").forEach((b) => b.classList.toggle("active", b.dataset.targetKind === targetKind));
    stakeCrBox.classList.toggle("hidden", stakeKind !== "cr");
    stakeNftBox.classList.toggle("hidden", stakeKind !== "nft");
    targetCrBox.classList.toggle("hidden", targetKind !== "cr");
    targetNftBox.classList.toggle("hidden", targetKind !== "nft");

    const v = upgradeValues();
    const pct = Math.round(v.chance * 1000) / 10;
    upChanceEl.textContent = v.chance ? `${pct}%` : "—";
    const winArc = v.chance * 360;
    upZone.style.background = v.chance
      ? `conic-gradient(from 0deg, #9E7EB5 0deg ${winArc.toFixed(2)}deg, rgba(76,35,101,.28) ${winArc.toFixed(2)}deg 360deg)`
      : "conic-gradient(from 0deg, rgba(76,35,101,.28) 0deg 360deg)";

    if (!v.valid) {
      upSummary.innerHTML = v.stakeValue && v.targetValue
        ? `Цель должна быть дороже ставки`
        : `Выберите ставку и цель`;
    } else {
      const stakeLabel = stakeKind === "cr" ? `${fmtNum(v.stakeValue, 0)} CR` : `«${escapeHtml(v.stakeNft?.name || "NFT")}»`;
      const targetLabel = targetKind === "cr" ? `${fmtNum(v.targetValue, 0)} CR` : `«${escapeHtml(v.targetNft?.name || "NFT")}»`;
      upSummary.innerHTML = `${stakeLabel} → ${targetLabel} · шанс <b>${pct}%</b>`;
    }
    upgradeBtn.disabled = upgrading || !state.profile || !v.valid;
  }

  function refreshFeed() {
    const plays = state.casino || [];
    if (!plays.length) {
      feedEl.innerHTML = `<div class="empty" style="min-height:120px"><p>Пока никто не играл. Будьте первым.</p></div>`;
      return;
    }
    feedEl.innerHTML = plays
      .slice(0, 24)
      .map((play) => {
        const win = !!play.win;
        if (play.game === "roulette") {
          const color = play.color === "red" ? "красное" : play.color === "black" ? "чёрное" : "зеро";
          return `<div class="casino-feed-row">
            <span class="casino-feed-game">🎡</span>
            <span class="casino-feed-nick ${play.isAdmin ? "nick-admin" : ""}" data-uid="${escapeHtml(play.uid || "")}">${escapeHtml(play.nick || "Аноним")}</span>
            <span class="casino-feed-info">${escapeHtml(color)} · ${escapeHtml(String(play.result))}</span>
            <span class="casino-feed-amount ${win ? "win" : "lose"}">${win ? "+" : "−"}${fmtNum(win ? play.payout : play.amount, 0)} CR</span>
            <span class="casino-feed-time">${fmtRelative(play.createdAt)}</span>
          </div>`;
        }
        const stake = play.stakeType === "cr" ? `${fmtNum(play.stakeValue, 0)} CR` : play.stakeNftName || "NFT";
        const target = play.targetType === "cr" ? `${fmtNum(play.targetValue, 0)} CR` : play.targetNftName || "NFT";
        return `<div class="casino-feed-row">
          <span class="casino-feed-game">⬆</span>
          <span class="casino-feed-nick ${play.isAdmin ? "nick-admin" : ""}" data-uid="${escapeHtml(play.uid || "")}">${escapeHtml(play.nick || "Аноним")}</span>
          <span class="casino-feed-info">${escapeHtml(stake)} → ${escapeHtml(target)}</span>
          <span class="casino-feed-amount ${win ? "win" : "lose"}">${win ? "успех" : "провал"}</span>
          <span class="casino-feed-time">${fmtRelative(play.createdAt)}</span>
        </div>`;
      })
      .join("");
  }

  function refreshAll() {
    balanceEl.textContent = fmtNum(state.profile?.coins || 0, 0);
    refreshRouletteUi();
    refreshNftPickers();
    refreshUpgraderUi();
    refreshFeed();
  }

  function setGame(next) {
    game = next;
    container.querySelectorAll("[data-game]").forEach((b) => b.classList.toggle("active", b.dataset.game === next));
    container.querySelectorAll("[data-game-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.gamePanel !== next));
    if (next === "upgrade") refreshUpgraderUi();
    else refreshRouletteUi();
  }

  container.querySelector("#casinoTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-game]");
    if (btn) setGame(btn.dataset.game);
  });

  colorBets.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-roulette-color]");
    if (!btn || spinning) return;
    betType = btn.dataset.rouletteColor;
    betValue = null;
    refreshRouletteUi();
  });

  board.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-roulette-number]");
    if (!btn || spinning) return;
    betType = "number";
    betValue = Number(btn.dataset.rouletteNumber);
    refreshRouletteUi();
  });

  amountEl.addEventListener("input", refreshRouletteUi);
  container.querySelector("#rouletteQuick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bet-amount]");
    if (!btn || spinning) return;
    const max = Math.floor(Number(state.profile?.coins) || 0);
    amountEl.value = btn.dataset.betAmount === "max" ? String(Math.max(CASINO_MIN_BET, max)) : btn.dataset.betAmount;
    refreshRouletteUi();
  });

  spinBtn.addEventListener("click", doSpin);

  stakeKindSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stake-kind]");
    if (!btn || upgrading) return;
    stakeKind = btn.dataset.stakeKind;
    refreshUpgraderUi();
  });
  targetKindSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-target-kind]");
    if (!btn || upgrading) return;
    targetKind = btn.dataset.targetKind;
    refreshUpgraderUi();
  });
  stakeAmountEl.addEventListener("input", refreshUpgraderUi);
  targetAmountEl.addEventListener("input", refreshUpgraderUi);

  container.querySelector("#stakeQuick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stake-amount]");
    if (!btn || upgrading) return;
    const max = Math.floor(Number(state.profile?.coins) || 0);
    stakeAmountEl.value = btn.dataset.stakeAmount === "max" ? String(Math.max(CASINO_MIN_BET, max)) : btn.dataset.stakeAmount;
    refreshUpgraderUi();
  });
  container.querySelector("#targetQuick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-target-amount]");
    if (!btn || upgrading) return;
    targetAmountEl.value = btn.dataset.targetAmount;
    refreshUpgraderUi();
  });

  stakeNftList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stake-nft]");
    if (!btn || upgrading) return;
    stakeNftId = stakeNftId === btn.dataset.stakeNft ? "" : btn.dataset.stakeNft;
    refreshNftPickers();
    refreshUpgraderUi();
  });
  targetNftList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-target-nft]");
    if (!btn || upgrading) return;
    targetNftId = targetNftId === btn.dataset.targetNft ? "" : btn.dataset.targetNft;
    refreshNftPickers();
    refreshUpgraderUi();
  });

  function needleTo(chance, win) {
    needleTurns += 1;
    const winArc = Math.max(2, chance * 360);
    let angle;
    if (win) {
      angle = 3 + Math.random() * Math.max(1, winArc - 8);
    } else {
      angle = Math.min(357, winArc + 3 + Math.random() * Math.max(1, 360 - winArc - 8));
    }
    const target = needleTurns * 360 * 4 + angle;
    upNeedle.style.transition = "transform 3.5s cubic-bezier(.14,.8,.18,1)";
    upNeedle.style.transform = `rotate(${target}deg)`;
  }

  function setUpResult(text, tone = "") {
    upResult.textContent = text;
    upResult.className = `up-result ${tone}`;
  }

  async function doUpgrade() {
    if (upgrading) return;
    if (!state.profile) return toast("Сначала создайте профиль", "error");
    const v = upgradeValues();
    if (!v.valid) return toast("Цель должна быть дороже ставки", "error");
    if (stakeKind === "nft" && !v.stakeNft) return toast("Выберите свой NFT", "error");
    if (targetKind === "nft" && !v.targetNft) return toast("Выберите NFT-цель", "error");
    upgrading = true;
    upgradeBtn.disabled = true;
    upgradeBtn.textContent = "Крутим…";
    setUpResult("Стрелка вращается…");
    try {
      const result = await playUpgrade(state.profile, {
        stakeType: stakeKind,
        stakeNftId: stakeKind === "nft" ? stakeNftId : "",
        stakeAmount: stakeKind === "cr" ? Number(stakeAmountEl.value) || 0 : 0,
        targetType: targetKind,
        targetNftId: targetKind === "nft" ? targetNftId : "",
        targetAmount: targetKind === "cr" ? Number(targetAmountEl.value) || 0 : 0
      });
      needleTo(result.chance, result.win);
      if (upgradeTimer) clearTimeout(upgradeTimer);
      upgradeTimer = setTimeout(() => {
        if (result.win) {
          const prize = targetKind === "cr" ? `${fmtNum(result.targetValue, 0)} CR` : `NFT «${result.targetNftName}»`;
          setUpResult(`Успех! Вы забрали ${prize}`, "win");
          toast(`Апгрейд успешен: ${prize}`, "success");
        } else {
          const lost = stakeKind === "cr" ? `${fmtNum(result.stakeValue, 0)} CR` : `NFT «${result.stakeNftName}»`;
          setUpResult(`Провал. Ставка ${lost} ушла дому`, "lose");
          toast("Апгрейд не удался", "error");
        }
        upgrading = false;
        upgradeBtn.textContent = "Запустить апгрейдер";
        refreshAll();
      }, 3600);
    } catch (err) {
      setUpResult("Ставка не принята");
      upgrading = false;
      upgradeBtn.textContent = "Запустить апгрейдер";
      refreshAll();
      toast(err.message || "Не удалось запустить апгрейдер", "error");
    }
  }

  upgradeBtn.addEventListener("click", doUpgrade);

  feedEl.addEventListener("click", (e) => {
    const row = e.target.closest("[data-uid]");
    if (row?.dataset.uid) openProfileModal(row.dataset.uid);
  });

  const unsub = onChange(refreshAll);
  refreshAll();
  setGame(game);
  return () => {
    unsub();
    if (spinTimer) clearTimeout(spinTimer);
    if (upgradeTimer) clearTimeout(upgradeTimer);
  };
}
