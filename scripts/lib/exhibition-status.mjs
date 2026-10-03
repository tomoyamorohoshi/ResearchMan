/**
 * Exhibition の会期ステータス判定（SPEC §3.2 の唯一の定義）。純関数・ESM。
 * src/lib/exhibition.ts はこのファイルを import して共有する（ロジックを複製しない）。
 * 日付は全て JST 暦日の YYYY-MM-DD 文字列。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 実在する暦日の YYYY-MM-DD か。
 * @param {unknown} s
 * @returns {boolean}
 */
export function isValidYmd(s) {
  if (typeof s !== "string") return false;
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * JST の暦日（YYYY-MM-DD）。UTC 15:00 で日付が変わる。
 * @param {Date} [now]
 * @returns {string}
 */
export function todayJst(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 日数差（b - a）。
 * @param {string} a YYYY-MM-DD
 * @param {string} b YYYY-MM-DD
 * @returns {number}
 */
export function daysBetween(a, b) {
  const t = (s) => {
    const m = YMD_RE.exec(s);
    if (!m) throw new Error(`invalid date: ${s}`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((t(b) - t(a)) / 86400000);
}

/**
 * today < start → upcoming / start <= today <= end → ongoing / today > end → ended。
 * YYYY-MM-DD は辞書順＝日付順なので文字列比較で足りる（不正値は例外）。
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} today JST 暦日
 * @returns {"upcoming"|"ongoing"|"ended"}
 */
export function computeStatus(startDate, endDate, today) {
  for (const s of [startDate, endDate, today]) {
    if (!isValidYmd(s)) throw new Error(`invalid date: ${s}`);
  }
  if (today < startDate) return "upcoming";
  if (today > endDate) return "ended";
  return "ongoing";
}
