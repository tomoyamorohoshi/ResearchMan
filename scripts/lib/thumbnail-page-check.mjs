/**
 * サムネイル検査は「ページが実際に参照するURL」で行う（2026-07-08 第2インシデント反映）。
 *
 * /thumbnails/*.jpg への直接アクセスは200でも、サイトが実際に使う経路（/_next/image
 * 経由のVercel画像変換等）が壊れているケースを見逃す（実際に402クォータ枯渇で全滅した
 * 実例あり）。本番ページのHTMLを取得し<img>のsrc属性を抽出、その実URL
 * （/_next/image?url=... 形式ならデコードして実体URLに解決する）に対してHTTP 200 かつ
 * content-typeがimage/*であることを確認する。
 */
import https from "https";
import http from "http";
import { httpGet } from "../verify-video.mjs";

const UA = "researchman-watchdog-thumbnail-check";

// ページHTML取得。verify-video.mjsのhttpGetと同じsettleパターン実装を使い回す
// （リダイレクト追跡・タイムアウト・close/errorでのsettle保証込み）。maxBytesは
// ページ全体を見る必要があるため200000程度に上げる。
export function fetchHtml(url) {
  return httpGet(url, { maxBytes: 200000, timeoutMs: 15000 });
}

// <img src="..."> を出現順に最大limit件抽出する。
export function extractImgSrcs(html, limit = 40) {
  if (!html) return [];
  const re = /<img[^>]+src="([^"]+)"/g;
  const out = [];
  let m;
  while (out.length < limit && (m = re.exec(html))) {
    out.push(m[1]);
  }
  return out;
}

// /_next/image?url=... 形式ならクエリのurlをdecodeURIComponentして実体URLへ解決する。
// /で始まる相対パスはsiteOriginを前置。絶対URLはそのまま返す（将来また配信方式が
// 変わる可能性への防御として両対応にしてある）。
export function resolveActualImageUrl(src, siteOrigin) {
  if (!src) return src;
  if (src.startsWith("/_next/image")) {
    try {
      const u = new URL(src, siteOrigin);
      const inner = u.searchParams.get("url");
      if (inner) {
        const decoded = decodeURIComponent(inner);
        return decoded.startsWith("http") ? decoded : new URL(decoded, siteOrigin).toString();
      }
    } catch {
      // フォールスルーしてそのまま解決を試みる
    }
    return new URL(src, siteOrigin).toString();
  }
  if (src.startsWith("/")) return new URL(src, siteOrigin).toString();
  return src;
}

// 画像URLの実在確認（status 200 かつ content-type が image/ で始まるか）。
// httpGet(verify-video.mjs)はcontent-typeを返さないため、ヘッダーを見る専用実装を持つ。
// settleパターン準拠（OPERATIONS.md §4: destroy前に必ずsettle、close/errorでも解決）。
// リダイレクト(3xx)は追跡する。
export function checkImageUrl(url, { redirects = 4, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!url || !/^https?:\/\//.test(url)) return resolve({ ok: false, status: 0, contentType: null });
    const mod = url.startsWith("https") ? https : http;
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        settle(checkImageUrl(next, { redirects: redirects - 1, timeoutMs }));
        req.destroy();
        return;
      }
      const contentType = res.headers["content-type"] || null;
      const ok = res.statusCode === 200 && !!contentType && contentType.startsWith("image/");
      res.resume();
      settle({ ok, status: res.statusCode, contentType });
    });
    req.on("error", () => settle({ ok: false, status: 0, contentType: null }));
    req.setTimeout(timeoutMs, () => {
      settle({ ok: false, status: 0, contentType: null });
      req.destroy();
    });
  });
}

// pageUrl のHTMLを取得しimg srcを抽出（/thumbnails/ または /_next/image を含むもののみ、
// 先頭40件程度）。先頭2件（新着優先。一覧が新着順ソート済みという前提）＋残りから
// ランダムでsampleCount未満まで補い、各々の実URLを解決してHTTP検証する。
// 失敗したものの配列を返す（空配列=全件OK）。
export async function checkThumbnailsOnPage(pageUrl, { sampleCount = 4 } = {}) {
  const siteOrigin = new URL(pageUrl).origin;
  const page = await fetchHtml(pageUrl);
  if (!page || page.status !== 200) {
    return [{ src: null, resolvedUrl: null, reason: `ページ取得失敗（status=${page?.status ?? 0}）: ${pageUrl}` }];
  }

  const allSrcs = extractImgSrcs(page.body, 200)
    .filter((s) => s.includes("/thumbnails/") || s.includes("/_next/image"))
    .slice(0, 40);
  if (!allSrcs.length) {
    return [{ src: null, resolvedUrl: null, reason: `対象img srcが見つからない: ${pageUrl}` }];
  }

  const head = allSrcs.slice(0, 2);
  const restPool = allSrcs.slice(2);
  const randomCount = Math.max(0, Math.min(sampleCount - head.length, restPool.length));
  const poolCopy = [...restPool];
  const randomPicks = [];
  for (let i = 0; i < randomCount; i++) {
    const idx = Math.floor(Math.random() * poolCopy.length);
    randomPicks.push(poolCopy.splice(idx, 1)[0]);
  }
  const targets = [...head, ...randomPicks];

  const failures = [];
  for (const src of targets) {
    const resolvedUrl = resolveActualImageUrl(src, siteOrigin);
    const result = await checkImageUrl(resolvedUrl);
    if (!result.ok) {
      failures.push({
        src,
        resolvedUrl,
        status: result.status,
        contentType: result.contentType,
        reason: `status=${result.status} content-type=${result.contentType}`,
      });
    }
  }
  return failures;
}
