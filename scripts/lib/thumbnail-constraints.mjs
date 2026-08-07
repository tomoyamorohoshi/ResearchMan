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
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
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

// ── サムネイル重複ガード（2026-08-07 サムネイル重複ロールバック障害の再発防止） ──
// 背景: 同一ジョブ内で新規追加しようとした複数事例が同じ画像（同一md5ハッシュ）の
// サムネイルを掴み、監査(audit-thumbnails.mjs)のDUP判定で全件ロールバックされた。
// 監査側は「data/cases.json内の全caseについて、thumbnailが/thumbnails/配下ならその
// ファイルのmd5が2件以上のcaseに出現したらDUP」という基準で判定するため、保存側にも
// 同じ基準（同一アルゴリズムのmd5）の重複拒否ガードを設け、監査で落ちる前に防ぐ。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(__dirname, "../..");
const DEFAULT_CASES_JSON_PATH = path.join(DEFAULT_ROOT, "data/cases.json");
const DEFAULT_PUBLIC_DIR = path.join(DEFAULT_ROOT, "public");

/**
 * バッファのmd5ハッシュを返す（audit-thumbnails.mjsのmd5関数と同一アルゴリズム）。
 * @param {Buffer} buf
 * @returns {string} 16進数のmd5ハッシュ
 */
export function hashThumbnailBuffer(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

/**
 * data/cases.json を読み、thumbnailが/thumbnails/配下で実ファイルが存在する各caseに
 * ついてmd5を計算し、既存サムネイルのハッシュ集合を返す
 * （audit-thumbnails.mjsのスキャンロジックと同じ対象・同じ基準。存在しないファイルは
 * スキップする＝MISSING判定は監査側の責務でここでは行わない）。
 * @param {{casesJsonPath?: string, publicDir?: string}} [options] テスト用にデータソースを差し替え可能
 * @returns {Set<string>}
 */
export function loadExistingThumbnailHashes({
  casesJsonPath = DEFAULT_CASES_JSON_PATH,
  publicDir = DEFAULT_PUBLIC_DIR,
} = {}) {
  const hashes = new Set();
  let cases;
  try {
    cases = JSON.parse(fs.readFileSync(casesJsonPath, "utf8"));
  } catch {
    return hashes; // cases.jsonが無い/壊れている場合は空集合（呼び出し元のフォールバックに任せる）
  }
  for (const c of cases) {
    const t = c?.thumbnail || "";
    if (!t.startsWith("/thumbnails/")) continue;
    const p = path.join(publicDir, t);
    try {
      hashes.add(hashThumbnailBuffer(fs.readFileSync(p)));
    } catch {
      // 実ファイルが無いcaseはスキップ（MISSING判定は監査側の責務）
    }
  }
  return hashes;
}

/**
 * サムネイル重複ガードを生成する。生成時に既存サムネイルのハッシュ集合を1回ロードし、
 * 以降 isDuplicate/remember でプロセス内の新規保存分も含めて重複判定できる。
 * @param {{casesJsonPath?: string, publicDir?: string}} [options] loadExistingThumbnailHashesにそのまま渡す
 */
export function createThumbnailDuplicateGuard(options) {
  const hashes = loadExistingThumbnailHashes(options);
  return {
    isDuplicate(hash) {
      return hashes.has(hash);
    },
    remember(hash) {
      hashes.add(hash);
    },
  };
}
