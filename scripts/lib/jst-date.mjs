/**
 * JSTの暦日文字列（YYYY-MM-DD）。UTCの toISOString 日付は使わない。
 * fetch-x-radar.mjs と auto-research-tech.mjs の両方が当日ファイル名の
 * 計算に使うため、main() をトップレベルで即実行するスクリプトとは
 * 独立したモジュールに置く（importするだけで本番処理が走る事故の防止。
 * OPERATIONS.md §4「main()を即実行するスクリプトをimportしない」参照）。
 */
export function jstDateString(d = new Date()) {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}
