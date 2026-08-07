// サムネイル最小バイト数の単一の定義（audit-tech.mjs / tech-thumbs.mjs / save-thumbnail.mjs /
// studio/server/pipeline/techThumbnail.ts が共通で参照する）。
//
// 背景（2026-08-07 pre-push 8日間ブロック障害）: 保存側の下限チェックが「正規化前（ダウン
// ロード直後）のバッファ」に対してのみ行われ、normalizeThumbnailBuffer（幅上限リサイズ＋
// JPEG再エンコード）で縮小した後のサイズは検査されないまま書き込まれていた。単色領域が多い
// 画像は再エンコードでMIN_THUMB_BYTES未満まで縮むことがあり（実例: maskvidexperiments.jpg
// 4809B）、監査(audit-tech.mjs)の閾値と実際に保存されるファイルのサイズがずれてしまい、
// 保存は成功するのに監査は落ちる状態がcommitまで到達していた。
// normalizeAndEnforceMinBytes は正規化後のサイズも必ずこの定数で検査し、閾値未満なら
// null を返す（呼び出し側は書き込みをスキップし、次候補やフォールバックへ進むこと）。
import { normalizeThumbnailBuffer } from "./normalize-thumbnail.mjs";

export const MIN_THUMB_BYTES = 5000;

/**
 * バッファを配信用JPEGへ正規化し、正規化後のサイズが minBytes 未満なら null を返す。
 * @param {Buffer} buf 正規化前のバッファ
 * @param {number} [minBytes=MIN_THUMB_BYTES] 最小許容バイト数
 * @returns {Promise<Buffer|null>} 正規化後のバッファ、または閾値未満で不採用の場合 null
 */
export async function normalizeAndEnforceMinBytes(buf, minBytes = MIN_THUMB_BYTES) {
  if (!buf) return null;
  const normalized = await normalizeThumbnailBuffer(buf);
  if (!normalized || normalized.length < minBytes) return null;
  return normalized;
}
