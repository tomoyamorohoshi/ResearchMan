// LINE Messaging API の無料枠（200通/月）消費ガード。
// notify-digest.mjs（routine送信）専用。notify-line.mjs の critical 経路はこのガードを
// 呼ばない（critical は quota に関わらず必ず送信を試みる仕様のため）。
import https from "https";

const QUOTA_URL = "https://api.line.me/v2/bot/message/quota/consumption";

/**
 * @param {string} token channelAccessToken
 * @returns {Promise<number|null>} totalUsage。取得失敗（ネットワークエラー・非2xx・
 *   パース失敗等）時は null を返す（例外を投げない）。
 */
export function fetchQuotaUsage(token) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const req = https.request(
      QUOTA_URL,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        const chunks = [];
        const finish = () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return settle(null);
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString());
            settle(typeof parsed.totalUsage === "number" ? parsed.totalUsage : null);
          } catch {
            settle(null);
          }
        };
        res.on("data", (d) => chunks.push(d));
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", () => settle(null));
      }
    );
    req.on("error", () => settle(null));
    req.setTimeout(15000, () => { settle(null); req.destroy(); });
    req.end();
  });
}

// 純粋関数: criticalは常にfalse（quotaに関わらず必ず送信を試みる）。
// routineはtotalUsage>=195で送信スキップ。取得失敗(null)は送信を試みる（false）。
export function shouldSkipForQuota(totalUsage, priority) {
  if (priority === "critical") return false;
  return totalUsage !== null && totalUsage >= 195;
}
