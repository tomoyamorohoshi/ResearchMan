/**
 * 既存サムネイルの一括正規化（メンテナンス用）。
 *
 * images.unoptimized（直接配信）への切替に伴い、public/thumbnails/ の既存ファイルを
 * 配信に耐える形へ揃える: 幅 > 1600px または 300KB 超のファイルを
 * scripts/lib/normalize-thumbnail.mjs と同一規則（幅≤1600・JPEG q80・メタデータ除去）で
 * 再エンコードする。既に基準内のファイルは触らない（無駄なgit差分を作らない）。
 *
 * 使い方:
 *   node scripts/normalize-thumbnails.mjs           # 実行
 *   node scripts/normalize-thumbnails.mjs --dry-run # 対象と削減見込みの表示のみ
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { normalizeThumbnailBuffer, THUMB_MAX_WIDTH } from "./lib/normalize-thumbnail.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBS_DIR = path.join(__dirname, "../public/thumbnails");
const SIZE_THRESHOLD = 300 * 1024;
const DRY_RUN = process.argv.includes("--dry-run");

const files = (await fs.readdir(THUMBS_DIR)).filter((f) => f.endsWith(".jpg"));
let targets = 0;
let before = 0;
let after = 0;
let failed = 0;

for (const f of files) {
  const p = path.join(THUMBS_DIR, f);
  const st = await fs.stat(p);
  const buf = await fs.readFile(p);
  let width = null;
  try {
    width = (await sharp(buf).metadata()).width ?? null;
  } catch {
    console.warn(`WARN: デコード不能（スキップ）: ${f}`);
    failed++;
    continue;
  }
  if (st.size <= SIZE_THRESHOLD && (width === null || width <= THUMB_MAX_WIDTH)) continue;

  targets++;
  before += st.size;
  const out = await normalizeThumbnailBuffer(buf);
  after += out.length;
  console.log(
    `${DRY_RUN ? "[dry] " : ""}${f}: ${(st.size / 1024).toFixed(0)}KB(${width}px) → ${(out.length / 1024).toFixed(0)}KB`
  );
  if (!DRY_RUN) await fs.writeFile(p, out);
}

console.log(
  `対象 ${targets}/${files.length} 件: ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB` +
    (failed ? ` / デコード不能 ${failed} 件` : "")
);
