/**
 * 既存サムネイルの一括正規化（メンテナンス用）。
 *
 * images.unoptimized（直接配信）への切替に伴い、public/thumbnails/ 配下
 * （tech/ 等のサブディレクトリ含む）の既存ファイルを配信に耐える形へ揃える。
 * scripts/lib/normalize-thumbnail.mjs と同一規則（幅≤1600・JPEG q80・メタデータ除去）で
 * 再エンコードする。
 *
 * 対象判定は**収束的**であること（watchdog 日曜deepが --dry-run の対象件数を
 * 異常検知に使うため、「正規化済みなのに毎回対象になる」ファイルがあると
 * 毎週無意味な自己修復commitが発生する）:
 *   - 幅 > 1600px → 対象（正規化後は必ず ≤1600 になるので再検出されない）
 *   - サイズ > 600KB かつ 再エンコードで10%超縮む → 対象
 *     （q80再圧縮でも縮まない高情報量画像を毎回再エンコードして世代劣化させない）
 * 既に基準内のファイルは触らない（無駄なgit差分を作らない）。
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
const SIZE_THRESHOLD = 600 * 1024;
const MIN_SHRINK_RATIO = 0.9; // これ未満に縮む場合だけサイズ超過を「対象」とする
const DRY_RUN = process.argv.includes("--dry-run");

// 対象は .jpg のみ（normalizeThumbnailBufferの出力はJPEGなので、.png等の拡張子の
// ファイルを書き換えると拡張子と中身が不一致になる。現状 thumbnails 配下は全て .jpg）
const files = (await fs.readdir(THUMBS_DIR, { recursive: true })).filter((f) => /\.jpe?g$/i.test(f));
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
  const overWidth = width !== null && width > THUMB_MAX_WIDTH;
  const overSize = st.size > SIZE_THRESHOLD;
  if (!overWidth && !overSize) continue;

  const out = await normalizeThumbnailBuffer(buf);
  // サイズ超過のみの場合、十分縮むときだけ書き換える（収束性の担保）
  if (!overWidth && out.length > st.size * MIN_SHRINK_RATIO) continue;

  targets++;
  before += st.size;
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
