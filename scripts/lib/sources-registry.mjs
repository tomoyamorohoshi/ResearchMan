/**
 * data/sources.json（情報源レジストリ）のスキーマ検証。
 * 仕様: docs/RADAR_V2_DESIGN.md §4-2。
 */

const KINDS = ["web", "x_account", "x_list", "x_query"];

/** @returns {{ok: boolean, errors: string[]}} */
export function validateSourcesRegistry(data) {
  const errors = [];
  if (!Array.isArray(data)) return { ok: false, errors: ["レジストリは配列である必要があります"] };
  const seen = new Set();
  data.forEach((s, idx) => {
    const at = `[${idx}]${s && s.id ? `(${s.id})` : ""}`;
    if (!s || typeof s !== "object") {
      errors.push(`${at}: オブジェクトではありません`);
      return;
    }
    if (typeof s.id !== "string" || !s.id.trim()) errors.push(`${at}: id が空です`);
    else if (seen.has(s.id)) errors.push(`${at}: id が重複しています`);
    else seen.add(s.id);
    if (!KINDS.includes(s.kind)) errors.push(`${at}: kind 不正（${s.kind}）`);
    if (typeof s.locator !== "string" || !s.locator.trim()) errors.push(`${at}: locator が空です`);
    else if (s.kind === "web" && !/^https?:\/\//.test(s.locator)) errors.push(`${at}: web の locator は http(s) URL`);
    else if (s.kind === "x_account" && !/^@\w+$/.test(s.locator)) errors.push(`${at}: x_account の locator は @handle`);
    if (!Number.isInteger(s.tier) || s.tier < 1 || s.tier > 3) errors.push(`${at}: tier は1〜3の整数`);
    if (s.hitDensity !== null && !(typeof s.hitDensity === "number" && s.hitDensity >= 0 && s.hitDensity <= 1)) {
      errors.push(`${at}: hitDensity は0〜1かnull`);
    }
    if (typeof s.enabled !== "boolean") errors.push(`${at}: enabled は boolean`);
  });
  return { ok: errors.length === 0, errors };
}
