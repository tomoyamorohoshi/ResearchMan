/**
 * YouTube動画の実在確認＋事例との一致検証（共有モジュール）。
 *
 * 「ytimgが200を返す」だけの検証は、削除済み動画のグレー画像や
 * 無関係な動画を素通しする。必ず oEmbed でタイトルを取り、
 * 事例タイトル/クライアント名との一致を確認してから採用すること。
 * auto-research-cc.mjs / self-heal-thumbnails.mjs / audit-integrity.mjs が共用する。
 */
import https from "https";
import http from "http";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

export function httpGet(url, { maxBytes = 30000, redirects = 4 } = {}) {
  return new Promise((resolve) => {
    if (!url || !/^https?:\/\//.test(url)) return resolve(null);
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(
      url,
      { headers: { "User-Agent": UA, Accept: "text/html,application/json,*/*" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          req.destroy();
          const next = new URL(res.headers.location, url).toString();
          return resolve(httpGet(next, { maxBytes, redirects: redirects - 1 }));
        }
        let body = "";
        res.on("data", (d) => {
          body += d;
          if (body.length > maxBytes) req.destroy();
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
        res.on("close", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// link の実在確認。404/410/5xx/ネットワーク死のみ「死」と判定。
// 401/403 はbotブロックの可能性が高い（ページ自体は存在）ので生存扱い。
export async function isUrlAlive(url) {
  const res = await httpGet(url, { maxBytes: 2000 });
  if (!res) return false;
  if (res.status === 404 || res.status === 410) return false;
  if (res.status >= 500) return false;
  return true;
}

// oEmbed で動画の実在確認＋タイトル取得。埋め込み不可/削除済みは null。
export async function fetchYouTubeInfo(ytId) {
  if (!ytId || !/^[A-Za-z0-9_-]{11}$/.test(ytId)) return null;
  const res = await httpGet(
    `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${ytId}&format=json`,
    { maxBytes: 10000 }
  );
  if (!res || res.status !== 200) return null;
  try {
    const j = JSON.parse(res.body);
    return { title: j.title || "", author: j.author_name || "" };
  } catch {
    return null;
  }
}

// 動画タイトル/チャンネル名が事例と関係あるか（無関係動画の採用を防ぐ）
export function videoMatchesCase(info, caseTitle, client) {
  if (!info) return false;
  const hay = `${info.title} ${info.author}`.toLowerCase();
  const norm = (s) => (s || "").toLowerCase();
  // 1. 英数トークン（3文字以上）の一致数で判定
  const tokens = (norm(caseTitle).match(/[a-z0-9]{3,}/g) || []).filter(
    (t) => !["the", "and", "for", "with"].includes(t)
  );
  const hit = tokens.filter((t) => hay.includes(t)).length;
  if (tokens.length >= 2 && hit >= Math.ceil(tokens.length / 2)) return true;
  if (tokens.length === 1 && hit === 1) return true;
  // 2. クライアント名一致（日本語タイトル等でトークンが取れない場合の救済）
  const clientNorm = norm(client).replace(/[^a-z0-9]/g, "");
  if (clientNorm.length >= 3) {
    if (hay.replace(/[^a-z0-9]/g, "").includes(clientNorm)) return true;
  }
  // 3. 日本語タイトルの部分一致（4文字以上の日本語連続部分）
  const jp = (caseTitle || "").match(/[ぁ-んァ-ヶ一-龠]{4,}/g) || [];
  if (jp.some((seg) => `${info.title}${info.author}`.includes(seg))) return true;
  return false;
}

// 検証済みの動画だけ true を返すワンストップ判定
export async function isVerifiedVideo(ytId, caseTitle, client) {
  const info = await fetchYouTubeInfo(ytId);
  return !!(info && videoMatchesCase(info, caseTitle, client));
}
