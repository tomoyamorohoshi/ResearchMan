/**
 * ローカル（JST）日付の通算日インデックス。
 *
 * ラウンドフォーカス / レーンの日替わりローテーションに使う。以前は
 * cc が UTC エポック基準、tech が `new Date(year,0,0)` 基準とバラバラで、
 * JST 午前の実行がUTCでは前日扱いになりローテーション位置が1日ずれる余地があった。
 * 運用は日本（JSTはDSTなし）なので、JSTの暦日を基準に統一する。
 *
 * @param {Date} [d] 基準時刻（省略時は現在）
 * @returns {number} 1970-01-01(JST) からの経過日数
 */
export function localDayIndex(d = new Date()) {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  return Math.floor((d.getTime() + JST_OFFSET_MS) / 86400000);
}
