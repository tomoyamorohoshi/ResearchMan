/**
 * Tokyo Art Beat（TAB）の展示個別ページ URL 判定。
 * 投稿経由（trustOrigin の intake）に限り、会場・主催者の個別公式ページが無いときの確認元として認める（2026-10-26 オーナー決定）。
 * 判定は host 完全一致（tokyoartbeat.com / www.tokyoartbeat.com）・既定ポート・userinfo 無し・path が /events/-/ 配下。
 */

export const TAB_NAME = "Tokyo Art Beat";
export const VERIFIED_VIA_TAB = "tokyoartbeat";

export function isTabEventUrl(u) {
  if (typeof u !== "string") return false;
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (host !== "tokyoartbeat.com" && host !== "www.tokyoartbeat.com") return false;
  return url.pathname.startsWith("/events/-/") && url.pathname.length > "/events/-/".length;
}
