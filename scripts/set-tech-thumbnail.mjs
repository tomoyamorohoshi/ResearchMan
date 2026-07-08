/**
 * Technologyサムネイルの手動設定（キービジュアルの明示指定）。
 *
 * 自動取得の結果が不満なとき、任意の画像URL（またはog:imageを持つページURL）を
 * 指定してサムネイルを差し替える。ファイル名にはバージョン番号を付けて
 * Vercelの画像キャッシュを確実にバストする。
 *
 * 使い方: node scripts/set-tech-thumbnail.mjs <id> <imageUrl|pageUrl>
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fetchThumbBuf } from "./tech-thumbs.mjs";
import { normalizeThumbnailBuffer } from "./lib/normalize-thumbnail.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const PUBLIC_DIR = path.join(__dirname, "../public");

const [id, url] = process.argv.slice(2);
if (!id || !url) {
  console.error("usage: node scripts/set-tech-thumbnail.mjs <id> <imageUrl|pageUrl>");
  process.exit(1);
}

const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
const t = tech.find((x) => x.id === id);
if (!t) {
  console.error(`id が見つかりません: ${id}`);
  process.exit(1);
}

const buf = await fetchThumbBuf(url);
if (!buf) {
  console.error(`画像を取得できませんでした: ${url}`);
  process.exit(1);
}

// バージョン付きファイル名でキャッシュバスト（-kv2, -kv3, ...）
const m = t.thumbnail.match(/-kv(\d*)\.jpg$/);
const ver = m ? (Number(m[1] || 1) + 1) : 2;
const newRel = `/thumbnails/tech/${id}-kv${ver}.jpg`;

// 直接配信(images.unoptimized)前提の正規化: 幅上限・JPEG化・メタデータ除去
await fs.writeFile(path.join(PUBLIC_DIR, newRel.replace(/^\//, "")), await normalizeThumbnailBuffer(buf));
await fs.unlink(path.join(PUBLIC_DIR, t.thumbnail.replace(/^\//, ""))).catch(() => {});
t.thumbnail = newRel;
await fs.writeFile(TECH_PATH, JSON.stringify(tech, null, 2));
console.log(`✓ ${id} → ${newRel}（${buf.length} bytes）`);
