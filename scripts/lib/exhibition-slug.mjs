/**
 * Exhibition の id/slug 生成（SPEC §3.1）。純関数・ESM。src/lib/exhibition.ts と共有する。
 * 形式: {startYear}-{venue英小文字}-{title英小文字}（60字目安）。favorites の
 * FAVORITE_ID_PATTERN（^[a-z0-9]+(-[a-z0-9]+)*$）と 100 字上限に適合させる。
 */

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_TARGET_LENGTH = 60;

/**
 * ASCII 小文字ハイフン区切りへ。ラテン文字のアクセントは除去し、日本語など
 * ASCII 化できない文字は落とす（全て落ちたら空文字）。
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return (text || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** FNV-1a 32bit → 6桁の16進（日本語のみの語のフォールバック用。決定的） */
function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * id/slug を生成する。venue/title が ASCII 化できない（日本語のみ）場合は元テキストの
 * 短いハッシュ（`h` + 6桁16進）で代替する。既存 id と衝突したら -2, -3...。
 * @param {{startDate: string, venue: string, title: string}} input
 * @param {Iterable<string>} [taken] 既に使われている id
 * @returns {string}
 */
export function buildExhibitionId({ startDate, venue, title }, taken = []) {
  const year = (startDate || "").slice(0, 4);
  const v = slugify(venue) || `h${shortHash(venue || "")}`;
  const t = slugify(title) || `h${shortHash(title || "")}`;
  let base = `${year}-${v}-${t}`;
  if (base.length > SLUG_TARGET_LENGTH) {
    base = base.slice(0, SLUG_TARGET_LENGTH).replace(/-+$/, "");
  }
  const used = taken instanceof Set ? taken : new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const cand = `${base}-${n}`;
    if (!used.has(cand)) return cand;
  }
}
