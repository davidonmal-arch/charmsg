import { state } from "../state.js";
import { escapeHtml, fmtDateTime, fmtDuration, plural, safeUrl } from "../util.js";

export function mountBan(container) {
  const profile = state.profile || {};
  const spam = profile.banType === "spam";
  const screenshot = profile.banType === "screenshot";
  const years = Number(profile.banYears) || 0;
  const until = Number(profile.banUntil) || 0;
  const banAt = Number(profile.banAt) || 0;
  const image = safeUrl(profile.banImage) || "./assets/ban.jpg";
  const reason =
    profile.banReason ||
    (screenshot
      ? "Обнаружена попытка сохранить экран. Это нарушает анонимность участников CharMsg."
      : "Аккаунт заблокирован администратором CharMsg за нарушение правил сообщества.");

  const durationText = years > 0
    ? `${years} ${plural(years, "год", "года", "лет")}`
    : until ? fmtDuration(until - banAt) : "бессрочно";
  const titleHtml = until > 0 ? `Вы забанены<br/>на ${escapeHtml(durationText)}` : "Вы забанены<br/>навсегда";

  container.innerHTML = `
    <section class="ban-screen">
      <div class="ban-card">
        <div class="ban-art">
          <img src="${escapeHtml(image)}" alt="Блокировка CharMsg" />
          <div class="ban-art-glow"></div>
          <span class="ban-stamp">BANNED</span>
        </div>

        <div class="ban-body">
          <div class="eyebrow">доступ закрыт</div>
          <h1 class="ban-title">${titleHtml}</h1>
          <p class="ban-lead">${escapeHtml(reason)}</p>

          <div class="ban-meta">
            <div class="ban-meta-row">
              <span>Тип блокировки</span>
              <b>${spam ? "спам" : screenshot ? "скриншот экрана" : "решение администратора"}</b>
            </div>
            <div class="ban-meta-row">
              <span>Дата бана</span>
              <b>${escapeHtml(fmtDateTime(banAt || Date.now()))}</b>
            </div>
            <div class="ban-meta-row">
              <span>Срок</span>
              <b>${escapeHtml(durationText)}</b>
            </div>
            <div class="ban-meta-row">
              <span>Действует до</span>
              <b>${until ? escapeHtml(fmtDateTime(until)) : "бессрочно"}</b>
            </div>
            <div class="ban-meta-row">
              <span>Анонимный ID</span>
              <b class="mono">${escapeHtml(profile.uid || state.uid || "—")}</b>
            </div>
          </div>

          <div class="ban-warning">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 17H3L12 3z"/><path d="M12 9v5"/><circle cx="12" cy="17" r=".8"/></svg>
            <span>${screenshot
              ? "Блокировка действует на этот анонимный профиль. Апелляции по скриншотам не рассматриваются."
              : `Блокировка действует на этот анонимный профиль.${until > 0 ? " После окончания срока доступ восстановится автоматически." : " Это бессрочная блокировка."} Апелляции рассматривает только администрация CharMsg.`}</span>
          </div>

          <button class="btn btn-ghost btn-block" id="banRefresh" type="button">Проверить статус ещё раз</button>
          <p class="ban-foot">CharMsg · анонимность — это ответственность</p>
        </div>
      </div>
    </section>`;

  container.querySelector("#banRefresh")?.addEventListener("click", () => {
    location.reload();
  });
}
