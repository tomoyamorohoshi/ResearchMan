/**
 * サムネイル画像をローカルに保存するユーティリティ
 * 外部URLへの依存をなくし、/public/thumbnails/ に永続保存する
 */
import https from "https";
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { normalizeThumbnailBuffer } from "./lib/normalize-thumbnail.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.join(__dirname, "../public/thumbnails");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── curlフォールバック共通ヘルパー ────────────────────────────
// lbbonline.com / adweek.com 等のCloudflareがTLSフィンガープリント判定でNodeの
// http/httpsクライアントにだけ403チャレンジページ（"Just a moment..."）を返し、
// 同一UAでもcurlは200で通ることを実証済み（2026-07-19）。Node直接取得が失敗
// （エラー・非200・チャレンジ検知）した場合、Windows標準のcurl.exeで再取得する。
const execFileAsync = promisify(execFile);
const CURL_MAX_TIME_SEC = 15; // curl自体のタイムアウト
const CURL_KILL_TIMEOUT_MS = 20000; // execFileプロセスのkill猶予（--max-timeより少し長め）
const OG_HTML_TRUNCATE_BYTES = 60000; // 60KB超は打ち切る（Node直接経路と同じ方針）

async function curlFetchText(url) {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-L", "--max-time", String(CURL_MAX_TIME_SEC), "-A", UA, url],
      { encoding: "utf-8", maxBuffer: 1024 * 1024 * 5, timeout: CURL_KILL_TIMEOUT_MS }
    );
    // Node直接経路の60KB打ち切りはストリーミングを早期に打ち切るための最適化だが、
    // curlは既に本文全体を一括取得済み（打ち切っても通信コストは削減できない）。
    // og:imageタグが60KBより後（adweek.comで実測: 約145KB地点）にあるページが実在するため
    // ここでは打ち切らない（メモリ上限はmaxBufferの5MBで担保）。
    return stdout || null;
  } catch (e) {
    console.log(`[curl-fallback] curl失敗(html) ${url}: ${(e.message || "").slice(0, 150)}`);
    return null;
  }
}

async function curlFetchBuffer(url) {
  try {
    // バイナリ安全に取得（encoding:"buffer"。画像を文字列化して壊さない）
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-L", "--max-time", String(CURL_MAX_TIME_SEC), "-A", UA, url],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 20, timeout: CURL_KILL_TIMEOUT_MS }
    );
    return stdout && stdout.length > 0 ? stdout : null;
  } catch (e) {
    console.log(`[curl-fallback] curl失敗(image) ${url}: ${(e.message || "").slice(0, 150)}`);
    return null;
  }
}

/**
 * ステータス/本文からCloudflare等のチャレンジページかどうかを判定する。
 * 403やその他の異常ステータス、または本文に "Just a moment" / cf-chl 等の
 * チャレンジマーカーを含む場合はチャレンジ扱い（curlフォールバック対象）にする。
 */
export function isChallengeResponse(status, html) {
  if (typeof status === "number" && status >= 400) return true;
  const body = html || "";
  return /just a moment/i.test(body) || /cf-chl|cf_chl|challenge-platform|cf-browser-verification/i.test(body);
}

/** HTML本文からog:image（無ければtwitter:image）のURLを抽出する。無ければnull。 */
export function extractOgImage(html) {
  const body = html || "";
  const m =
    body.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
    body.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  // og:image URLはHTMLエスケープされていることがある（&amp; → &）
  const img = m?.[1]?.replace(/&amp;/g, "&");
  return img && img.startsWith("http") ? img : null;
}

/** URLから画像をダウンロードしてバッファで返す（Node直接取得のみ。redirects追跡込み）。 */
function fetchImageNode(url, redirects = 4) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith("http")) return resolve(null);
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
      // 301/302に加え303/307/308も追跡する（CDNは307/308を常用する）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        settle(fetchImageNode(next, redirects - 1));
        req.destroy();
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return settle(null); }
      const ct = res.headers["content-type"] || "";
      if (!ct.startsWith("image/")) { res.resume(); return settle(null); }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => settle(Buffer.concat(chunks)));
      // 接続が途中で切れてもPromiseを必ず解決する（未解決awaitでプロセスが静かに死ぬのを防ぐ）。
      // 画像は部分受信だと壊れたファイルになるため、end以外は必ずnullで確定する
      res.on("close", () => settle(null));
      res.on("error", () => settle(null));
    });
    req.on("error", () => settle(null));
    req.setTimeout(10000, () => { settle(null); req.destroy(); });
  });
}

/**
 * URLから画像をダウンロードしてバッファで返す（tech系スクリプトも共用）。
 * Node直接取得が失敗した場合はcurlサブプロセスでフォールバックする（シグネチャ不変）。
 */
export async function fetchImage(url, redirects = 4) {
  if (!url || !url.startsWith("http")) return null;
  const direct = await fetchImageNode(url, redirects);
  if (direct) return direct;
  const buf = await curlFetchBuffer(url);
  if (buf && buf.length > 0) {
    console.log(`[curl-fallback] image OK ${url}`);
    return buf;
  }
  return null;
}

/**
 * 指定URLの画像をダウンロードして /public/thumbnails/{id}.jpg に保存
 * @returns ローカルパス "/thumbnails/{id}.jpg" or null
 */
export async function saveThumbnail(id, sourceUrl) {
  if (!sourceUrl || sourceUrl.includes("picsum")) return null;

  await fs.mkdir(THUMBNAILS_DIR, { recursive: true });

  // 既にローカルに存在する場合はスキップ
  const localPath = path.join(THUMBNAILS_DIR, `${id}.jpg`);
  try {
    await fs.access(localPath);
    return `/thumbnails/${id}.jpg`; // 既存ファイルをそのまま使用
  } catch {}

  const buf = await fetchImage(sourceUrl);
  if (!buf || buf.length < 5000) return null; // 小さすぎる画像は除外

  // 直接配信(images.unoptimized)前提の正規化: 幅上限・JPEG化・メタデータ除去
  await fs.writeFile(localPath, await normalizeThumbnailBuffer(buf));
  return `/thumbnails/${id}.jpg`;
}

/**
 * og:image を記事URLから取得してローカル保存
 */
export async function saveThumbnailFromPage(id, pageUrl) {
  if (!pageUrl || !pageUrl.startsWith("http")) return null;

  const ogImage = await fetchOgImage(pageUrl);
  if (!ogImage) return null;

  return saveThumbnail(id, ogImage);
}

/** 記事ページをNode直接取得し、{ status, html } を返す（redirects追跡込み）。取得不能ならnull。 */
function fetchOgImagePage(url, redirects = 3) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
      // リダイレクト追跡（従来は3xxでhtml空→og:image取れず失敗していた）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        settle(fetchOgImagePage(next, redirects - 1));
        req.destroy();
        return;
      }
      const status = res.statusCode;
      let html = "";
      // 60KB超で打ち切る際は必ず「先に」finishする。
      // req.destroy()はreqの'error'(ECONNRESET)を先に発火させるため、
      // 後からfinishしてもPromiseはすでにnullで解決済みになる（60KB超ページで全滅していた実バグ）
      const finish = () => settle({ status, html });
      res.on("data", (d) => { html += d; if (html.length > OG_HTML_TRUNCATE_BYTES) { finish(); req.destroy(); } });
      res.on("end", finish);
      // req.destroy() 後は end が発火しない。closeでも必ず解決する
      // （未解決awaitが残るとNodeがイベントループ枯渇で静かに終了し、呼び出し元が途中死する）
      res.on("close", finish);
      res.on("error", finish);
    });
    // 打ち切りdestroy時はfinish済み（settled）なのでこのresolve(null)は無効化される
    req.on("error", () => settle(null));
    req.setTimeout(8000, () => { settle(null); req.destroy(); });
  });
}

/**
 * og:image のURLを記事ページから取得する（シグネチャ不変）。
 * Node直接取得が失敗・非200・チャレンジ検知（403やCloudflareの"Just a moment..."等）の
 * 場合はcurlサブプロセスで再取得する（従来はステータスを無視してHTML解析していたため、
 * チャレンジページを素通しして og:image 無しと誤判定していた問題を修正）。
 */
export async function fetchOgImage(url, redirects = 3) {
  const page = await fetchOgImagePage(url, redirects);
  if (page && !isChallengeResponse(page.status, page.html)) {
    const img = extractOgImage(page.html);
    if (img) return img;
  }

  // Node直接取得が失敗・非200・チャレンジ検知、または200だがog:imageが見つからなかった
  // 場合はcurlでフォールバックする。Node直接経路は60KBでストリーミングを打ち切るため、
  // og:imageタグがそれより後方にある正規のページ（adweek.com実測: 約145KB地点）を
  // 「チャレンジではないがog:imageが無い」と誤判定してしまう。curlは打ち切りなしで
  // 全文取得するため、この場合も再取得を試みる方が実態に即している
  // （2026-07-19 curlフォールバック実証で判明）。
  const html = await curlFetchText(url);
  if (!html) {
    console.log(`[curl-fallback] og:image NG(curl取得失敗) ${url}`);
    return null;
  }
  const img = extractOgImage(html);
  if (img) {
    console.log(`[curl-fallback] og:image OK ${url}`);
    return img;
  }
  console.log(`[curl-fallback] og:image NG(og:image無し) ${url}`);
  return null;
}
