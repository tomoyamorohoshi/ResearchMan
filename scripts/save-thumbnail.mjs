/**
 * サムネイル画像をローカルに保存するユーティリティ
 * 外部URLへの依存をなくし、/public/thumbnails/ に永続保存する
 */
import https from "https";
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.join(__dirname, "../public/thumbnails");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** URLから画像をダウンロードしてバッファで返す */
function fetchImage(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith("http")) return resolve(null);
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchImage(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const ct = res.headers["content-type"] || "";
      if (!ct.startsWith("image/")) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      // 接続が途中で切れてもPromiseを必ず解決する（未解決awaitでプロセスが静かに死ぬのを防ぐ）
      res.on("close", () => resolve(null));
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
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

  await fs.writeFile(localPath, buf);
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

function fetchOgImage(url, redirects = 3) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
      // リダイレクト追跡（従来は3xxでhtml空→og:image取れず失敗していた）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        req.destroy();
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchOgImage(next, redirects - 1));
      }
      let html = "";
      const finish = () => {
        const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
                || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
        const img = m?.[1];
        resolve(img && img.startsWith("http") ? img : null);
      };
      res.on("data", (d) => { html += d; if (html.length > 60000) req.destroy(); });
      res.on("end", finish);
      // req.destroy() 後は end が発火しない。closeでも必ず解決する
      // （未解決awaitが残るとNodeがイベントループ枯渇で静かに終了し、呼び出し元が途中死する）
      res.on("close", finish);
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}
