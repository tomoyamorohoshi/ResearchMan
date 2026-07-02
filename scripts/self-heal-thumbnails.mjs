/**
 * サムネイル自己修復スクリプト
 *
 * 1. 全サムネイルの死活確認
 * 2. 壊れているものをClaudeで自動修復（YouTube再検索）
 * 3. ローカル保存
 *
 * 使い方: node scripts/self-heal-thumbnails.mjs
 */

import fs from "fs/promises";
import https from "https";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { saveThumbnail, saveThumbnailFromPage } from "./save-thumbnail.mjs";
import { fetchYouTubeInfo, videoMatchesCase } from "./verify-video.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const THUMBNAILS_DIR = path.join(__dirname, "../public/thumbnails");

import { accessSync } from "fs";

// クロードのバイナリパス
const CLAUDE_BIN = (() => {
  for (const p of ["/Users/tm/.local/bin/claude","/usr/local/bin/claude","/opt/homebrew/bin/claude"]) {
    try { accessSync(p); return p; } catch {}
  }
  return "claude";
})();

/** ローカルサムネイルが有効かチェック */
async function checkLocalThumbnail(id) {
  const f = path.join(THUMBNAILS_DIR, `${id}.jpg`);
  try {
    const s = await fs.stat(f);
    return s.size > 3000; // 3KB以上あれば有効
  } catch {
    return false;
  }
}

/** 外部URLが生きているか確認 */
function checkUrl(url) {
  return new Promise((resolve) => {
    if (!url?.startsWith("http")) return resolve(false);
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      settle(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => settle(false));
    req.setTimeout(5000, () => { settle(false); req.destroy(); });
  });
}

/** ClaudeでYouTube IDを検索して修復 */
function findAndSaveThumbnail(id, title, client) {
  const query = `"${title}" ${client} official campaign video YouTube`;
  const prompt = `Search YouTube for the official campaign video or trailer for: ${query}
Return ONLY a valid 11-character YouTube video ID (e.g. dQw4w9WgXcQ).
If found, return just the ID. If not found, return: NOT_FOUND`;

  const result = spawnSync(CLAUDE_BIN, [
    "--print",
    "--model",
    "sonnet",
    "--allowedTools=WebSearch",
    "--dangerously-skip-permissions",
    prompt,
  ], { encoding: "utf-8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });

  const out = (result.stdout || "").trim();
  if (out.includes("NOT_FOUND") || !out) return null;

  // 11文字のYouTube IDを抽出
  const match = out.match(/\b([A-Za-z0-9_-]{11})\b/);
  return match ? match[1] : null;
}

// ── メイン ──────────────────────────────────────────────
async function main() {
  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  console.log(`\n🔍 サムネイルヘルスチェック（${cases.length}件）\n`);

  const broken = [];

  // Step 1: 全件チェック
  await Promise.all(cases.map(async (c) => {
    const isLocalOk = await checkLocalThumbnail(c.id);
    if (!isLocalOk) {
      // ローカルがない or 小さい → 外部URLも確認
      const isExtOk = c.thumbnail.startsWith("/thumbnails/")
        ? false
        : await checkUrl(c.thumbnail);

      if (!isLocalOk && !isExtOk) {
        broken.push(c);
      }
    }
  }));

  if (broken.length === 0) {
    console.log("✅ 全サムネイル正常！修復不要\n");
    return 0;
  }

  console.log(`⚠ 壊れているサムネイル: ${broken.length}件`);
  broken.forEach(c => console.log(`  × ${c.id}`));
  console.log("\n🔧 自動修復開始...\n");

  let fixed = 0, failed = 0;

  // 修復は「検証済みの画像」しか使わない。
  // かつてytimg 200チェックのみでClaude検索結果を採用していたため、
  // 無関係な動画のサムネ/videoIdで上書きする事故が多発した。その再発防止。
  for (const c of broken) {
    process.stdout.write(`[${c.id}] 修復中... `);

    // 1. 既存videoIdが正しい（ローカルファイル欠損だけ）なら再保存
    if (c.videoId) {
      const info = await fetchYouTubeInfo(c.videoId);
      if (info && videoMatchesCase(info, c.title, c.client)) {
        const local =
          (await saveThumbnail(c.id, `https://i.ytimg.com/vi/${c.videoId}/maxresdefault.jpg`)) ||
          (await saveThumbnail(c.id, `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`));
        if (local) { c.thumbnail = local; fixed++; console.log(`✓ 既存videoIdから再保存`); continue; }
      }
    }

    // 2. 記事URLの og:image
    if (c.link) {
      const local = await saveThumbnailFromPage(c.id, c.link);
      if (local) { c.thumbnail = local; fixed++; console.log("✓ 記事og:imageから修復"); continue; }
    }

    // 3. Claude でYouTube検索 → 必ずoEmbedタイトル照合してから採用
    const ytId = findAndSaveThumbnail(c.id, c.title, c.client);
    if (ytId) {
      const info = await fetchYouTubeInfo(ytId);
      if (info && videoMatchesCase(info, c.title, c.client)) {
        const local =
          (await saveThumbnail(c.id, `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`)) ||
          (await saveThumbnail(c.id, `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`));
        if (local) {
          c.thumbnail = local;
          c.videoId = ytId;
          fixed++;
          console.log(`✓ 修復完了 (${ytId})`);
          continue;
        }
      }
    }

    // 検証を通る画像が見つからない場合は上書きしない（誤画像より現状維持）
    console.log("✗ 検証済み画像が見つからず（未修復のまま）");
    failed++;
  }

  await fs.writeFile(CASES_PATH, JSON.stringify(cases, null, 2));

  console.log(`\n完了: ${fixed}件修復 / ${failed}件未解決`);
  return fixed;
}

main().catch(console.error);
