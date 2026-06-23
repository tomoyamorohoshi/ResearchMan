/**
 * 全サムネイルをローカルに保存するスクリプト（並列処理・高速版）
 * 実行: node scripts/repair-thumbnails.mjs
 */
import fs from "fs/promises";
import https from "https";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const THUMBNAILS_DIR = path.join(__dirname, "../public/thumbnails");
const CONCURRENCY = 10; // 並列数
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function main() {
await fs.mkdir(THUMBNAILS_DIR, { recursive: true });

/** URLから画像をダウンロードしてローカル保存。成功したら /thumbnails/{id}.jpg を返す */
async function downloadToLocal(id, url) {
  if (!url || !url.startsWith("http")) return null;
  const localFile = path.join(THUMBNAILS_DIR, `${id}.jpg`);
  // 既存ファイルがあれば再利用
  try { const s = await fs.stat(localFile); if(s.size>5000) return `/thumbnails/${id}.jpg`; } catch {}

  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        req.destroy(); return resolve(downloadToLocal(id, res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const ct = res.headers["content-type"] || "";
      if (!ct.startsWith("image/")) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", async () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 3000) return resolve(null); // 小さすぎる画像を除外
        await fs.writeFile(localFile, buf).catch(() => {});
        resolve(`/thumbnails/${id}.jpg`);
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

/** ページからog:imageを取得してローカル保存 */
async function fetchAndSaveOgImage(id, pageUrl) {
  if (!pageUrl || !pageUrl.startsWith("http")) return null;
  return new Promise((resolve) => {
    const mod = pageUrl.startsWith("https") ? https : http;
    const req = mod.get(pageUrl, { headers: { "User-Agent": UA } }, (res) => {
      let html = "";
      res.on("data", (d) => { html += d; if (html.length > 20000) req.destroy(); });
      res.on("end", async () => {
        const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        const imgUrl = m?.[1];
        if (!imgUrl?.startsWith("http")) return resolve(null);
        resolve(await downloadToLocal(id, imgUrl));
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// ── メイン処理 ──────────────────────────────────────────
const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
console.log(`総件数: ${cases.length}件\n処理開始（並列${CONCURRENCY}）...\n`);

let saved = 0, skipped = 0, failed = 0;

// 並列処理
// ハードタイムアウト（15秒）
function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function processCase(c) {
  const id = c.id;

  // 既にローカル保存済み
  if (c.thumbnail.startsWith("/thumbnails/")) {
    const f = path.join(THUMBNAILS_DIR, `${id}.jpg`);
    try { const s = await fs.stat(f); if (s.size > 3000) { skipped++; return; } } catch {}
  }

  let localPath = null;

  if (c.thumbnail.includes("picsum")) {
    // picsumの場合: videoId → og:image の順で試みる
    if (c.videoId) {
      localPath = await withTimeout(downloadToLocal(id, `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`));
    }
    if (!localPath && c.link && !c.link.includes("youtube.com") && !c.link.includes("youtu.be")) {
      localPath = await withTimeout(fetchAndSaveOgImage(id, c.link));
    }
  } else {
    // 外部URLをローカルに保存（YouTube含む）
    localPath = await withTimeout(downloadToLocal(id, c.thumbnail));
  }

  if (localPath) {
    c.thumbnail = localPath;
    saved++;
    process.stdout.write(`✓ ${id}\n`);
  } else {
    failed++;
    process.stdout.write(`✗ ${id}\n`);
  }
}

async function processBatch(batch) {
  return Promise.all(batch.map((c) => processCase(c)));
}

// バッチに分けて実行
const total = Math.ceil(cases.length / CONCURRENCY);
for (let i = 0; i < cases.length; i += CONCURRENCY) {
  const batchNum = Math.floor(i / CONCURRENCY) + 1;
  process.stdout.write(`\n--- バッチ ${batchNum}/${total} (${i+1}〜${Math.min(i+CONCURRENCY, cases.length)}件目) ---\n`);
  const batch = cases.slice(i, i + CONCURRENCY);
  try {
    await processBatch(batch);
  } catch (e) {
    console.error(`バッチ ${batchNum} エラー:`, e.message);
  }
}

await fs.writeFile(CASES_PATH, JSON.stringify(cases, null, 2));

const localCount = cases.filter(c => c.thumbnail.startsWith("/thumbnails/")).length;
const fileCount = (await fs.readdir(THUMBNAILS_DIR)).length;

console.log(`\n完了！`);
console.log(`  ローカル保存: ${saved}件新規 / ${skipped}件スキップ / ${failed}件失敗`);
console.log(`  /thumbnails/ 内ファイル数: ${fileCount}件`);
console.log(`  cases.json でローカルURL: ${localCount}件`);
}

main().catch(console.error);
