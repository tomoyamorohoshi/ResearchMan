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

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function describeSource(s) {
  switch (s.kind) {
    case "web":
      return `${s.locator} [${s.id}]`;
    case "x_account":
      return `X ${s.locator} [${s.id}]`;
    case "x_list":
      return `Xリスト ${s.locator} [${s.id}]`;
    case "x_query":
      return `X検索「${s.locator}」[${s.id}]`;
    default:
      return `${s.locator} [${s.id}]`;
  }
}

/**
 * roundFoci の sourceRefs（レジストリid配列）を発見プロンプトの「情報源」文字列に解決する
 * （docs/RADAR_V2_DESIGN.md §4-3）。
 * - レジストリに enabled:true が1件も無い間（情報源選定前）は legacyText をそのまま返す（互換動作）。
 * - 1件でも有効化された後は、有効な源（enabled のみ・tier昇順・同tierは sourceRefs 順・[id] 併記）を
 *   「優先して巡回する情報源」として先頭に並べ、続けて従来の自由文 legacyText を「その他の情報源」として残す
 *   （優先源のホストを含む従来項目は重複として除く）。
 *   2026-10-20: 旧仕様は有効源があると legacyText を捨てたため、少数源だけに探索が狭まった（国内ラウンドが2源のみ）。
 *   当該フォーカスに有効源が無い場合は legacyText をそのまま返す（無ければ空文字）。
 */
export function resolveSourcesText(sourceRefs, registry, legacyText = "") {
  const reg = Array.isArray(registry) ? registry : [];
  if (!reg.some((s) => s && s.enabled === true)) return legacyText;
  const byId = new Map(reg.map((s) => [s.id, s]));
  const picked = (Array.isArray(sourceRefs) ? sourceRefs : [])
    .map((id, order) => ({ s: byId.get(id), order }))
    .filter((x) => x.s && x.s.enabled === true)
    .sort((a, b) => a.s.tier - b.s.tier || a.order - b.order);
  if (!picked.length) return legacyText;
  const priority = picked.map((x) => describeSource(x.s)).join(" / ");
  const hosts = picked.map((x) => (x.s.kind === "web" ? hostOf(x.s.locator) : "")).filter(Boolean);
  const others = String(legacyText || "")
    .split(" / ")
    .map((t) => t.trim())
    .filter((t) => t && !hosts.some((h) => t.toLowerCase().includes(h)));
  return others.length ? `${priority}

その他の情報源（上記を優先して巡回し、補助的に参照）: ${others.join(" / ")}` : priority;
}

/**
 * 記事URLからレジストリidを推定する（web=ホスト一致・wwwは無視、X=投稿者ハンドル一致）。
 * enabled は問わない（収集元の記録が目的）。特定できなければ空文字。
 */
export function inferSourceId(link, registry) {
  const reg = Array.isArray(registry) ? registry : [];
  let u;
  try {
    u = new URL(link);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "x.com" || host === "twitter.com") {
    const handle = (u.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    if (!handle) return "";
    const hit = reg.find((s) => s.kind === "x_account" && s.locator.toLowerCase() === `@${handle}`);
    return hit ? hit.id : "";
  }
  const hit = reg.find((s) => s.kind === "web" && hostOf(s.locator) === host);
  return hit ? hit.id : "";
}
