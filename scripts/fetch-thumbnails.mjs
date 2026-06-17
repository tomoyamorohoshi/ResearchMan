/**
 * サムネイル自動収集スクリプト
 *
 * 優先順:
 *   1. cases.json の link URL から og:image を抽出
 *   2. 失敗したら "{title} {client} campaign" でGoogle検索して最初の画像URLを取得
 *   3. どちらも失敗したら現状維持（YouTube or picsum）
 *
 * 使い方: node scripts/fetch-thumbnails.mjs
 * 特定1件だけ: node scripts/fetch-thumbnails.mjs waves-of-will
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// og:image を HTML から抽出
function extractOgImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && m[1].startsWith("http")) return m[1];
  }
  return null;
}

// 方法1: 記事URLからog:image取得
async function fetchOgImage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    // HTMLをテキストで取得（先頭8KBで十分）
    const reader = res.body.getReader();
    let html = "";
    while (html.length < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel();
    return extractOgImage(html);
  } catch {
    return null;
  }
}

// 方法2: Google検索フォールバック（画像URLを探す）
async function searchFallback(title, client) {
  const q = encodeURIComponent(`${title} ${client} advertising campaign`);
  const searchUrl = `https://www.google.com/search?q=${q}&tbm=isch`;
  try {
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Google画像検索のレスポンスから "https://...jpg" を探す
    const m = html.match(/"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    return m ? m[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&") : null;
  } catch {
    return null;
  }
}

async function main() {
  const targetId = process.argv[2] ?? null;
  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));

  const targets = cases.filter((c) => {
    if (targetId) return c.id === targetId;
    // YouTubeサムネイルはスキップ
    return !c.thumbnail.includes("ytimg.com");
  });

  console.log(`\n対象: ${targets.length} 件\n`);

  let updated = 0;
  let failed = [];

  for (const c of targets) {
    process.stdout.write(`[${c.id}] `);

    // 方法1: og:image
    if (c.link && !c.link.startsWith("https://www.")) {
      // linkが直接記事URLの場合
    }
    let img = c.link ? await fetchOgImage(c.link) : null;

    if (img) {
      process.stdout.write(`✓ og:image\n`);
    } else {
      process.stdout.write(`✗ og:image失敗 → 検索フォールバック... `);
      img = await searchFallback(c.title, c.client);
      if (img) {
        process.stdout.write(`✓ 検索で発見\n`);
      } else {
        process.stdout.write(`✗ 両方失敗 → 現状維持\n`);
        failed.push(c.id);
      }
    }

    if (img) {
      // cases配列を直接更新
      const idx = cases.findIndex((x) => x.id === c.id);
      cases[idx].thumbnail = img;
      updated++;
    }

    // レート制限を避けるため少し待つ
    await new Promise((r) => setTimeout(r, 500));
  }

  await fs.writeFile(CASES_PATH, JSON.stringify(cases, null, 2));

  console.log(`\n完了: ${updated}件更新 / ${failed.length}件失敗`);
  if (failed.length > 0) {
    console.log(`失敗したID: ${failed.join(", ")}`);
  }
}

main().catch(console.error);
