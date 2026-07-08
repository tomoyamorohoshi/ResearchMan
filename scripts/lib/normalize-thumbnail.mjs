// サムネイル正規化（保存時共通処理）。
//
// 背景（2026-07-08 画像402インシデント）: サムネは next/image（Vercel画像最適化）経由で
// 配信していたが、Hobbyプランの画像変換クォータを使い切り全サムネが HTTP 402 になった。
// 対策として images.unoptimized で元画像の直接配信に切り替えたため、
// 「元画像そのものが配信に耐えるサイズ・形式である」ことを保存時に保証する必要がある。
// （過去には 4MB 超の jpg や、拡張子 .jpg の中身が PNG/WebP のファイルも混入していた）
import sharp from "sharp";

export const THUMB_MAX_WIDTH = 1600; // 詳細ページのretina表示でも十分な幅
export const THUMB_JPEG_QUALITY = 80;

/**
 * 画像バッファを配信用JPEGへ正規化する。
 * - EXIF orientation を反映（.rotate()）した上でメタデータは落とす
 * - 幅 THUMB_MAX_WIDTH 超は縮小（拡大はしない）
 * - PNG/WebP等も実体をJPEGへ変換（拡張子.jpgと中身を一致させる）
 * デコード不能なバッファはそのまま返す（保存可否の判断は呼び出し側の既存ロジックに委ねる）。
 */
export async function normalizeThumbnailBuffer(buf) {
  try {
    return await sharp(buf)
      .rotate()
      .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_JPEG_QUALITY, progressive: true, mozjpeg: true })
      .toBuffer();
  } catch {
    return buf;
  }
}
