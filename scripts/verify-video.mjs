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
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERIFIED_VIDEOS_PATH = path.join(__dirname, "../data/verified-videos.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

export function httpGet(url, { maxBytes = 30000, redirects = 4, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!url || !/^https?:\/\//.test(url)) return resolve(null);
    const mod = url.startsWith("https") ? https : http;
    // req.destroy()はreqの'error'(ECONNRESET)を発火させ、resolve(null)が
    // 正常な結果より先に走る（=生きているリンクを「死」と誤判定する実バグ）。
    // 必ず「先に」settleしてからdestroyすること。
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = mod.get(
      url,
      { headers: { "User-Agent": UA, Accept: "text/html,application/json,*/*" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          settle(httpGet(next, { maxBytes, redirects: redirects - 1, timeoutMs }));
          req.destroy();
          return;
        }
        let body = "";
        const finish = () => settle({ status: res.statusCode, body });
        res.on("data", (d) => {
          body += d;
          if (body.length > maxBytes) {
            finish();
            req.destroy();
          }
        });
        res.on("end", finish);
        res.on("close", finish);
      }
    );
    req.on("error", () => settle(null));
    req.setTimeout(timeoutMs, () => {
      settle(null);
      req.destroy();
    });
  });
}

// Jina Reader経由でページを取得する（bot対策で直接アクセスできないサイトの救済用）。
// Jinaはターゲットが404等でもHTTP 200+本文を返すが、本文に必ず
// "Warning: Target URL returned error NNN" を含む（実測確認済み）ため、
// 死活判定はステータスだけでなくこの警告行の有無で行う（jinaSaysAlive参照）。
// コールドフェッチ(JSレンダリング)は10秒を超えることがあるため timeoutMs を長めに取る。
export function fetchViaJina(url) {
  return httpGet("https://r.jina.ai/" + url, { maxBytes: 4000, timeoutMs: 30000 });
}

export function jinaSaysAlive(res) {
  return !!(
    res &&
    res.status === 200 &&
    res.body.length >= 300 &&
    !/Warning: Target URL returned error (404|410|5\d\d)/.test(res.body)
  );
}

// link の実在確認。404/410/5xx/ネットワーク死のみ「死」と判定。
// 401/403 はbotブロックの可能性が高い（ページ自体は存在）ので生存扱い。
// 直接アクセスが完全に到達不能（!res）だった場合のみ、Jina Reader経由で救済を試みる
// （404/410/5xxは直接判定を信頼し、Jinaは使わない＝誤って死んだリンクを生かさない）。
export async function isUrlAlive(url) {
  const res = await httpGet(url, { maxBytes: 2000 });
  if (!res) return jinaSaysAlive(await fetchViaJina(url));
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

// 動画タイトル/チャンネル名が事例と関係あるか（無関係動画の採用を防ぐ）。
// 理由文字列つきで判定する版。audit側でどのルールで一致/不一致になったかを出せるようにする。
export function videoMatchScore(info, caseTitle, client) {
  if (!info) return { match: false, reason: "no-info" };
  const hay = `${info.title} ${info.author}`.toLowerCase();
  const norm = (s) => (s || "").toLowerCase();
  // 単語境界一致用（記号をスペースに変換。"art"が"startup"にマッチする類の誤検知を避ける）
  const hayWords = hay.replace(/[^a-z0-9]+/g, " ").trim();

  // 1. 英数トークン（3文字以上）の一致数で判定
  const tokens = (norm(caseTitle).match(/[a-z0-9]{3,}/g) || []).filter(
    (t) => !["the", "and", "for", "with"].includes(t)
  );
  const hit = tokens.filter((t) => hay.includes(t)).length;
  if (tokens.length >= 2 && hit >= Math.ceil(tokens.length / 2)) {
    return { match: true, reason: `title-tokens(${hit}/${tokens.length})` };
  }
  if (tokens.length === 1 && hit === 1) {
    return { match: true, reason: "title-token-single" };
  }

  // 2. クライアント名一致（日本語タイトル等でトークンが取れない場合の救済）。
  //    5文字以上は部分一致、3-4文字の短い名前（例: KFC/IKEA）は単語境界一致のみ許可
  //    （includes()の部分一致だけだと短い名前ほど誤検知しやすいため）
  const clientNorm = norm(client).replace(/[^a-z0-9]/g, "");
  if (clientNorm.length >= 5) {
    if (hay.replace(/[^a-z0-9]/g, "").includes(clientNorm)) {
      return { match: true, reason: "client-substring" };
    }
  } else if (clientNorm.length >= 3) {
    const re = new RegExp(`\\b${clientNorm}\\b`);
    if (re.test(hayWords)) {
      return { match: true, reason: "client-word-boundary" };
    }
  }

  // 3. 日本語タイトルの部分一致（4文字以上の日本語連続部分）
  const jp = (caseTitle || "").match(/[ぁ-んァ-ヶ一-龠]{4,}/g) || [];
  if (jp.some((seg) => `${info.title}${info.author}`.includes(seg))) {
    return { match: true, reason: "jp-substring" };
  }

  return { match: false, reason: "no-match" };
}

// 動画タイトル/チャンネル名が事例と関係あるか（無関係動画の採用を防ぐ）
export function videoMatchesCase(info, caseTitle, client) {
  return videoMatchScore(info, caseTitle, client).match;
}

// 検証済みの動画だけ true を返すワンストップ判定
export async function isVerifiedVideo(ytId, caseTitle, client) {
  const info = await fetchYouTubeInfo(ytId);
  return !!(info && videoMatchesCase(info, caseTitle, client));
}

// 人が視聴確認済みのペア（caseId+videoId一致）かどうか。
// data/verified-videos.json: { "<caseId>": { "videoId": "...", "verifiedAt": "...", "note": "..." } }
// タイトル照合ルールを強化・変更しても、確認済みペアは再flag/再検索されない
// （audit-integrity.mjs / self-heal-thumbnails.mjs が共用）
let _verifiedCache = null;
export async function isHumanVerifiedVideo(caseId, videoId) {
  if (!_verifiedCache) {
    try {
      _verifiedCache = JSON.parse(await fs.readFile(VERIFIED_VIDEOS_PATH, "utf-8"));
    } catch {
      _verifiedCache = {};
    }
  }
  const v = _verifiedCache[caseId];
  return !!(v && v.videoId === videoId);
}
