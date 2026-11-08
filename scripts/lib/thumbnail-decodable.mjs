// サムネ実体が画像としてデコードできるかの検査（audit-thumbnails.mjs 用）。
// 2026-11: HTML(404/ブロックページ)が .jpg として保存されたまま監査を通った事故の再発防止。
import fs from "fs/promises";
import sharp from "sharp";

/** ファイルが sharp でデコード可能な画像なら true。HTML・空・読めない場合は false。 */
export async function isDecodableImageFile(filePath) {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length === 0) return false;
    const meta = await sharp(buf).metadata();
    return Boolean(meta && meta.format);
  } catch {
    return false;
  }
}
