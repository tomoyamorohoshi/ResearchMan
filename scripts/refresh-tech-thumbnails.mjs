/**
 * GitHub OGPカードになっているTechnologyサムネイルをキービジュアルへ差し替える。
 *
 * カード画像（1200x600 PNG＝リポジトリ名とスター数のテキスト画像）は技術内容が
 * 伝わらないため、プロジェクトページog:image → README先頭画像 → 動画サムネの
 * 優先順で実画像を取得し直す（tech-thumbs.mjs のチェーンからカードを除外して探索）。
 *
 * 差し替え時はファイル名を {id}-kv.jpg に変えて tech.json も更新する
 * （同名上書きだとVercelの画像最適化キャッシュに旧画像が残るため、URLごと変える）。
 *
 * 使い方: node scripts/refresh-tech-thumbnails.mjs [--dry-run]
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { keyVisualSources, fetchThumbBuf, isGithubCard } from "./tech-thumbs.mjs";
import { normalizeThumbnailBuffer } from "./lib/normalize-thumbnail.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const PUBLIC_DIR = path.join(__dirname, "../public");
const DRY_RUN = process.argv.includes("--dry-run");

const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
let replaced = 0, kept = 0;

for (const t of tech) {
  const curPath = path.join(PUBLIC_DIR, t.thumbnail.replace(/^\//, ""));
  let cur;
  try {
    cur = await fs.readFile(curPath);
  } catch {
    console.log(`✗ ${t.id}: サムネ実体なし（要別途対応）`);
    continue;
  }
  if (!isGithubCard(cur)) continue; // キービジュアル取得済み

  // カードを除いた候補から実画像を探す
  const sources = (await keyVisualSources(t.links, null)).filter(
    (s) => !/^https:\/\/opengraph\.githubassets\.com\//.test(s)
  );
  let found = null;
  for (const src of sources) {
    const buf = await fetchThumbBuf(src);
    if (buf && !isGithubCard(buf)) {
      found = { src, buf };
      break;
    }
  }
  if (!found) {
    kept++;
    console.log(`— ${t.id}: 代替キービジュアルなし（カードのまま）`);
    continue;
  }

  const newRel = `/thumbnails/tech/${t.id}-kv.jpg`;
  console.log(`✓ ${t.id}: ${found.src} → ${newRel}`);
  if (!DRY_RUN) {
    // 直接配信(images.unoptimized)前提の正規化: 幅上限・JPEG化・メタデータ除去
    await fs.writeFile(path.join(PUBLIC_DIR, newRel.replace(/^\//, "")), await normalizeThumbnailBuffer(found.buf));
    await fs.unlink(curPath).catch(() => {});
    t.thumbnail = newRel;
  }
  replaced++;
}

if (!DRY_RUN) await fs.writeFile(TECH_PATH, JSON.stringify(tech, null, 2));
console.log(`\n差し替え: ${replaced}件 / カードのまま: ${kept}件${DRY_RUN ? "（dry-run: 未反映）" : ""}`);
