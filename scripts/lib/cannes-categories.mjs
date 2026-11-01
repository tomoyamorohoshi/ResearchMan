/**
 * Cannes Lions 部門名の正規化表と判定関数（docs/CANNES_10Y_DESIGN.md §4・§5-4・§5-5）。
 * audit-cannes・cannes-reconcile・src/lib/awards.ts の3か所で共有する。
 *
 * 方針:
 * - 同じ部門の表記ゆれ（"Film Lions" / "film"、"Entertainment for Music" /
 *   "Entertainment Lions for Music"、"&" / "and"）だけを同一キーにする。
 * - 年をまたぐ名寄せ（Radio → Radio & Audio → Audio & Radio、Social & Influencer →
 *   Social & Creator、Creative eCommerce → Creative Commerce 等）はしない。
 * - 区別が必須の組は別キーのまま: Film / Film Craft、Design / Product Design、
 *   Entertainment / Entertainment for Music|Sport|Gaming、Grand Prix for Good /
 *   Lions Health Grand Prix for Good、Creative Commerce / Creative eCommerce。
 * 純粋関数のみ（Node・tsx・Next のどれからでも import できる）。
 */

// 正規化後のキー（小文字・"&"・空白整形済み）→ そのまま使う別名だけを列挙。
const ALIASES = new Map([
  ["sdg", "sustainable development goals"],
  ["b2b", "creative b2b"],
  ["business transformation", "creative business transformation"],
  ["print", "print & publishing"],
]);

export function normalizeCannesCategory(raw) {
  let s = String(raw ?? "")
    .toLowerCase()
    .replace(/cannes\s*lions/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\band\b/g, "&")
    .replace(/\s*&\s*/g, " & ")
    .trim();
  // "Entertainment Lions for Music" → "entertainment for music"、"Film Lions" → "film"。
  // 先頭の "Lions Health Grand Prix for Good" の Lions は部門名の一部なので残す。
  if (/^glass(?![a-z])/.test(s)) return "glass: the lion for change";
  s = s.replace(/\s+lions?\s+for\s+/g, " for ").replace(/\s+lions?$/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return ALIASES.get(s) ?? s;
}

export function sameCannesCategory(a, b) {
  const ka = normalizeCannesCategory(a);
  return ka !== "" && ka === normalizeCannesCategory(b);
}

// 正規形 award 文字列: "Cannes Lions <year> <公式部門名> Lions <Level>"（§5-5）
export function formatCannesAward({ year, category, level }) {
  const name = String(category ?? "").trim();
  const lvl = String(level ?? "").trim();
  // 部門名が Lions/Lion を含む・Titanium・Grand Prix 系は "Lions" を足さない
  const needLions = !/\blions?\b/i.test(name) && !/titanium|grand prix/i.test(name);
  const parts = ["Cannes Lions", String(year), needLions ? `${name} Lions` : name];
  // レベルが部門名に既に含まれる（Titanium / Grand Prix for Good）か、
  // "Glass Lion" のような部門固有の賞名（"lion" で終わる）は重ねない
  const lvlLow = lvl.toLowerCase();
  if (lvl && !name.toLowerCase().includes(lvlLow) && !/\blions?$/.test(lvlLow)) parts.push(lvl);
  return parts.join(" ");
}
