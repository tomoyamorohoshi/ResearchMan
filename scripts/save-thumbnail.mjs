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
import sharp from "sharp";
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

// テスト用に差し替え可能なネットワーク依存（本番は既定の実装をそのまま使う）。
// ESM名前付きエクスポートは外部から再代入できないため、テストで差し替えたい境界の
// 関数だけをこのオブジェクト経由で呼び出す（2026-07-27 adversarial-review対応）。
export const _deps = {
  fetchImage,
  fetchOgImagePage,
  curlFetchText,
};

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

// ── <img>タグ フォールバック抽出（og:image/twitter:image不在サイト対策） ──
// Prix Ars Electronica（archive.aec.at）等、ogメタタグを一切持たないページが実在する。
// ページ本文の<img>タグから候補を抽出し、誤サムネ根絶の除外フィルタを通した上位数件を
// 既存のダウンロード保存経路（saveThumbnail）で順に試す（2026-07-27）。
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_ATTR_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const IMG_CLASS_ATTR_RE = /\bclass\s*=\s*["']([^"']+)["']/i;
// トラッキングピクセル/装飾用画像とみなして除外するsrcパターン
const IMG_EXCLUDE_SRC_RE = /logo|icon|sprite|pixel|spacer|avatar|emoji/i;
// width="1" / height="1"（1x1トラッカー）を除外。data-width="1" 等の別属性への
// 誤マッチを避けるため、属性名の直前が空白/タグ先頭であることを要求する
// （\bだと "data-width" の "width" にも一致してしまう。2026-07-27 review指摘E対応）
const IMG_TRACKER_DIM_RE = /(?:^|\s)(?:width|height)\s*=\s*["']?0*1["']?(?:px)?(?=[\s/>]|$)/i;
// classに"media"/"main"を含むかの単純な部分一致（単語境界だと post-media__img /
// mainContent 等の実サイトで多用されるクラス名に一致しないため。2026-07-27 review指摘D対応）
const IMG_PRIORITY_CLASS_RE = /media|main/i;
const IMG_FALLBACK_MAX_CANDIDATES = 5;

/**
 * HTML本文の<img>タグから、フォールバックサムネイル候補の絶対URLを抽出する。
 * 誤サムネ根絶のため .svg / data:URI / logo・icon・sprite・pixel・spacer・avatar・emoji
 * を含むもの / 1x1トラッカーを除外し、class に media/main を含むものを優先する。
 * 除外フィルタ通過後の出現順（class一致は先頭に寄せる）で上位5件まで返す。
 */
export function extractImgFallbackCandidates(html, pageUrl, limit = IMG_FALLBACK_MAX_CANDIDATES) {
  const body = html || "";
  const tags = body.match(IMG_TAG_RE) || [];
  const prioritized = [];
  const rest = [];
  const seen = new Set();

  for (const tag of tags) {
    if (IMG_TRACKER_DIM_RE.test(tag)) continue;

    const srcMatch = tag.match(IMG_SRC_ATTR_RE);
    if (!srcMatch) continue;
    const src = srcMatch[1].replace(/&amp;/g, "&").trim();
    if (!src || src.startsWith("data:")) continue;
    if (/\.svg(?:[?#]|$)/i.test(src)) continue;
    if (IMG_EXCLUDE_SRC_RE.test(src)) continue;

    let absolute;
    try {
      absolute = new URL(src, pageUrl).toString();
    } catch {
      continue;
    }
    if (!absolute.startsWith("http")) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    const classMatch = tag.match(IMG_CLASS_ATTR_RE);
    if (classMatch && IMG_PRIORITY_CLASS_RE.test(classMatch[1])) {
      prioritized.push(absolute);
    } else {
      rest.push(absolute);
    }
  }

  return [...prioritized, ...rest].slice(0, limit);
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
 * バッファが実際にデコード可能な画像かどうかを検証する（sharpでメタデータ取得を試みる）。
 * normalizeThumbnailBuffer はデコード失敗時に元のバッファをそのまま返す（＝失敗を外部から
 * 判別できない）ため、採用可否の判定にはこの専用チェックを使う
 * （2026-07-27 review指摘A: 404 HTML等がそのまま.jpgとして保存される問題への対応）。
 */
async function isDecodableImage(buf) {
  try {
    const meta = await sharp(buf).metadata();
    return Boolean(meta && meta.format);
  } catch {
    return false;
  }
}

/**
 * 指定URLの画像をダウンロードして /public/thumbnails/{id}.jpg に保存
 * @param {number} [minBytes=5000] 最小許容バイト数（imgタグフォールバック候補では
 *   誤検出（アイコン等の小画像）を弾くためより高い閾値を指定できる）
 * @param {boolean} [requireDecodable=false] trueの場合、バッファが実際にデコード可能な
 *   画像であることを検証してから保存する（imgタグフォールバック候補向け。og:image経路は
 *   従来通りfalseのまま＝挙動を変えない）
 * @returns ローカルパス "/thumbnails/{id}.jpg" or null
 */
export async function saveThumbnail(id, sourceUrl, minBytes = 5000, requireDecodable = false) {
  if (!sourceUrl || sourceUrl.includes("picsum")) return null;

  await fs.mkdir(THUMBNAILS_DIR, { recursive: true });

  // 既にローカルに存在する場合はスキップ
  const localPath = path.join(THUMBNAILS_DIR, `${id}.jpg`);
  try {
    await fs.access(localPath);
    return `/thumbnails/${id}.jpg`; // 既存ファイルをそのまま使用
  } catch {}

  const buf = await _deps.fetchImage(sourceUrl);
  if (!buf || buf.length < minBytes) return null; // 小さすぎる画像は除外
  if (requireDecodable && !(await isDecodableImage(buf))) return null; // デコード不能（404 HTML等）は除外

  // 直接配信(images.unoptimized)前提の正規化: 幅上限・JPEG化・メタデータ除去
  await fs.writeFile(localPath, await normalizeThumbnailBuffer(buf));
  return `/thumbnails/${id}.jpg`;
}

// imgタグフォールバック候補の最小許容バイト数（10KB未満は装飾用の小画像とみなし不採用）
const IMG_FALLBACK_MIN_BYTES = 10 * 1024;

/**
 * og:image を記事URLから取得してローカル保存。
 * og:image/twitter:imageが無い、またはそのURLでの保存に失敗した場合は
 * ページ本文の<img>タグから候補を抽出するフォールバックを試みる
 * （archive.aec.at等、ogメタタグを一切持たないサイト対策。2026-07-27）。
 * ページHTMLの取得は1回のみ（fetchPageHtmlAndOgImage）で、og:image判定とimgタグ
 * フォールバック抽出の両方に同じHTMLを再利用する（review指摘C: 重複フェッチ解消）。
 */
export async function saveThumbnailFromPage(id, pageUrl) {
  if (!pageUrl || !pageUrl.startsWith("http")) return null;

  const { html, ogImage } = await fetchPageHtmlAndOgImage(pageUrl);
  if (ogImage) {
    const saved = await saveThumbnail(id, ogImage);
    if (saved) return saved;
  }

  return saveThumbnailFromImgFallback(id, pageUrl, html);
}

/** ページ本文（既取得のHTML）の<img>タグ候補を上位から順に試し、最初に保存成功したものを採用する。 */
async function saveThumbnailFromImgFallback(id, pageUrl, html) {
  if (!html) return null;

  const candidates = extractImgFallbackCandidates(html, pageUrl);
  for (const url of candidates) {
    // requireDecodable=true: デコード不能なバッファ（404 HTML等）は不採用にして次候補へ
    const saved = await saveThumbnail(id, url, IMG_FALLBACK_MIN_BYTES, true);
    if (saved) {
      console.log(`[img-fallback] OK ${url}`);
      return saved;
    }
    console.log(`[img-fallback] NG ${url}`);
  }
  return null;
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
 * ページHTMLの取得 + og:image抽出をまとめて行う内部ヘルパー。
 * Node直接取得が失敗・非200・チャレンジ検知（403やCloudflareの"Just a moment..."等）の
 * 場合はcurlサブプロセスで再取得する（従来はステータスを無視してHTML解析していたため、
 * チャレンジページを素通しして og:image 無しと誤判定していた問題を修正）。
 * Node直接経路は60KBでストリーミングを打ち切るため、og:imageタグがそれより後方にある
 * 正規のページ（adweek.com実測: 約145KB地点）を「チャレンジではないがog:imageが無い」と
 * 誤判定してしまう。curlは打ち切りなしで全文取得するため、この場合も再取得を試みる方が
 * 実態に即している（2026-07-19 curlフォールバック実証で判明）。
 * 取得したHTML本文も返すことで、呼び出し元（imgタグフォールバック）が再フェッチせず
 * 同じHTMLから候補抽出できる（review指摘C）。副次効果として、curl全文取得はここで
 * og:image無しと判定した場合に必ず行われるため、imgタグフォールバックの候補抽出も
 * 60KB打ち切りの影響を受けない（review指摘B）。
 */
async function fetchPageHtmlAndOgImage(url, redirects = 3) {
  const page = await _deps.fetchOgImagePage(url, redirects);
  if (page && !isChallengeResponse(page.status, page.html)) {
    const img = extractOgImage(page.html);
    if (img) return { html: page.html, ogImage: img };
  }

  const html = await _deps.curlFetchText(url);
  if (!html) {
    console.log(`[curl-fallback] og:image NG(curl取得失敗) ${url}`);
    return { html: page?.html || null, ogImage: null };
  }
  const img = extractOgImage(html);
  if (img) {
    console.log(`[curl-fallback] og:image OK ${url}`);
    return { html, ogImage: img };
  }
  console.log(`[curl-fallback] og:image NG(og:image無し) ${url}`);
  return { html, ogImage: null };
}

/**
 * og:image のURLを記事ページから取得する（シグネチャ不変。tech-thumbs.mjs等が利用）。
 */
export async function fetchOgImage(url, redirects = 3) {
  const { ogImage } = await fetchPageHtmlAndOgImage(url, redirects);
  return ogImage;
}
