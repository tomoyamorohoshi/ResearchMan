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
import { saveThumbnail } from "./save-thumbnail.mjs";

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
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
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
    "--allowedTools=WebSearch",
    "--dangerously-skip-permissions",
    prompt,
  ], { encoding: "utf-8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });

  const out = (result.stdout || "").trim();
  if (out.includes("NOT_FOUND") || !out) return null;

  // 11文字のYouTube IDを抽出
  const match = out.match(/\b([A-Za-z0-9_-]{11})\b/);
  return match ? match[1] : null;
}

async function verifySingleYouTubeId(ytId) {
  const url = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
  return checkUrl(url);
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

  for (const c of broken) {
    process.stdout.write(`[${c.id}] Claude でYouTube検索中... `);

    const ytId = findAndSaveThumbnail(c.id, c.title, c.client);
    if (!ytId) { console.log("✗ 見つからず"); failed++; continue; }

    // 確認
    const valid = await verifySingleYouTubeId(ytId);
    if (!valid) { console.log(`✗ ID無効 (${ytId})`); failed++; continue; }

    // ローカル保存
    const local = await saveThumbnail(c.id, `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`);
    if (local) {
      c.thumbnail = local;
      c.videoId = ytId;
      fixed++;
      console.log(`✓ 修復完了 (${ytId})`);
    } else {
      console.log(`✗ 保存失敗`);
      failed++;
    }
  }

  await fs.writeFile(CASES_PATH, JSON.stringify(cases, null, 2));

  console.log(`\n完了: ${fixed}件修復 / ${failed}件未解決`);
  return fixed;
}

main().catch(console.error);
