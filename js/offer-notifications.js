import { runAction } from "./db.js";
import { state } from "./state.js";
import { escapeHtml, safeUrl, fmtNum } from "./util.js";

export function setupOfferInbox() {
  navigator.serviceWorker?.getRegistration().then(registration => registration?.update()).catch(() => {});
  let alive = true, busy = false, timer;
  const seen = new Set();
  const pendingSeen = new Set();
  const notice = document.createElement("aside");
  notice.id = "offerNotice";
  notice.className = "offer-notice card";
  notice.hidden = true;
  document.querySelector("#view").before(notice);

  function badges(count) {
    document.querySelectorAll('[data-route="nfts"]').forEach(link => {
      let badge = link.querySelector(".offer-count");
      if (!count) { badge?.remove(); return; }
      if (!badge) { badge = document.createElement("span"); badge.className = "offer-count"; link.append(badge); }
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.setAttribute("aria-label", "Новых предложений обмена " + count);
    });
  }
  async function refresh() {
    if (!alive || busy || document.hidden) return;
    if (state.profile?.banned) { notice.hidden = true; badges(0); return; }
    busy = true;
    try {
      for (const id of pendingSeen) {
        await runAction("markOfferSeen", id);
        pendingSeen.delete(id);
      }
      const inbox = await runAction("offerInbox");
      if (!alive) return;
      badges(inbox.count);
      const offer = inbox.offers.find(item => !seen.has(item.id));
      if (!offer) {
        if (!inbox.offers.some(item => item.id === notice.dataset.offer)) notice.hidden = true;
        return;
      }
      seen.add(offer.id);
      notice.dataset.offer = offer.id;
      const image = safeUrl(offer.give?.find(nft => nft.image)?.image || "");
      const description = offer.give?.length ? offer.give.map(nft => nft.name).join(", ") : fmtNum(offer.giveCr) + " CR";
      notice.innerHTML = (image ? '<img src="' + escapeHtml(image) + '" alt="Предлагаемый NFT">' : '<div class="offer-notice-money">CR</div>')
        + '<div class="grow"><b>' + escapeHtml(offer.creatorNick) + ' предлагает обмен</b><p>' + escapeHtml(description) + '</p></div>'
        + '<button class="btn btn-sm btn-primary" data-open="' + escapeHtml(offer.id) + '">Посмотреть</button>'
        + '<button class="btn btn-sm" data-dismiss="' + escapeHtml(offer.id) + '" aria-label="Скрыть уведомление">×</button>';
      notice.hidden = false;
    } catch (error) { if (alive) console.warn("Offer notifications", error.code || "unavailable"); }
    finally { busy = false; }
  }
  notice.addEventListener("click", event => {
    const button = event.target.closest("button");
    const id = button?.dataset.open || button?.dataset.dismiss;
    if (!id) return;
    notice.hidden = true;
    if (button.dataset.open) location.hash = "#/offers?offer=" + encodeURIComponent(id);
    pendingSeen.add(id);
    refresh();
  });
  const push = event => { if (event.data?.type === "charmsg:offer") refresh(); };
  const visible = () => { if (!document.hidden) refresh(); };
  const poll = async () => { await refresh(); if (alive) timer = setTimeout(poll, 10_000); };
  navigator.serviceWorker?.addEventListener("message", push);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("charmsg:offers-changed", refresh);
  poll();
  return () => {
    alive = false; clearTimeout(timer); notice.remove(); badges(0);
    navigator.serviceWorker?.removeEventListener("message", push);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("charmsg:offers-changed", refresh);
  };
}
