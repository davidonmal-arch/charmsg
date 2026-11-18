const pacific = "America/Los_Angeles";
const pacificDay = new Intl.DateTimeFormat("en-US", {
  timeZone: pacific, year: "numeric", month: "numeric", day: "numeric"
});
const pacificHour = new Intl.DateTimeFormat("en-US", {
  timeZone: pacific, hour: "numeric", hourCycle: "h23"
});
const localReset = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Yekaterinburg", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
});

export function quotaResetTime(now = new Date()) {
  const parts = Object.fromEntries(pacificDay.formatToParts(now).map(({ type, value }) => [type, Number(value)]));
  const candidate = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 8);
  return new Date(candidate - Number(pacificHour.format(candidate)) * 3_600_000);
}

let shownAt = 0;
export function reportQuota(error) {
  if (!["resource-exhausted", "functions/resource-exhausted"].includes(error?.code)) return false;
  const notice = document.getElementById("quotaNotice");
  if (!notice || !notice.hidden) return true;
  shownAt = Date.now();
  const reset = quotaResetTime();
  notice.textContent = `Технические работы. Дневной лимит базы исчерпан. Ориентировочно до ${localReset.format(reset)} по Екатеринбургу.`;
  notice.hidden = false;
  return true;
}

export function clearQuota(startedAt = Date.now()) {
  if (startedAt < shownAt) return;
  const notice = document.getElementById("quotaNotice");
  if (!notice) return;
  notice.hidden = true;
  notice.textContent = "";
}
