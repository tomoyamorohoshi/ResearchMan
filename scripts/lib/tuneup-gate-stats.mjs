/**
 * 週次見直し（biweekly-tuneup.mjs）の v3 追加入力: gateTier 別 fav/トラッシュ率・レンズ別採用数・却下ログ要約。
 * 仕様: docs/CASE_RESEARCH_V3_SPEC.md §5。全て純粋関数（fs非依存）。tuneup-stats.mjs の作法に合わせる。
 *
 * cases.json の gateTier("accept"|"borderline")・discoveryLens(1..4) は v3 以降の新規エントリにだけ付く。
 * 旧エントリ（フィールド無し・想定外の値）は gateTier では "legacy"、レンズでは untagged に寄せて壊れないようにする。
 */

const TIERS = ["accept", "borderline", "legacy"];
const LENSES = [1, 2, 3, 4];

const tierOf = (c) => (c?.gateTier === "accept" || c?.gateTier === "borderline" ? c.gateTier : "legacy");
const lensOf = (c) => (LENSES.includes(Number(c?.discoveryLens)) ? Number(c.discoveryLens) : null);
const rate = (n, d) => (d > 0 ? n / d : 0);
const brief = (c) => ({ id: c.id, title: c.title, link: c.link || "", summary: c.summary || "" });

/**
 * gateTier 別（accept / borderline / legacy=旧データ）の件数・fav・トラッシュと率、および
 * borderline の fav / トラッシュ一覧（具体例の入れ替え候補の元）。
 */
export function computeGateTierStats({ favIds, trashedIds, cases }) {
  const favSet = new Set(favIds || []);
  const trashSet = new Set(trashedIds || []);
  const byTier = Object.fromEntries(TIERS.map((t) => [t, { count: 0, fav: 0, trashed: 0, favRate: 0, trashRate: 0 }]));
  const borderlineFav = [];
  const borderlineTrashed = [];
  let taggedCount = 0;
  for (const c of cases || []) {
    const t = tierOf(c);
    if (t !== "legacy") taggedCount++;
    const e = byTier[t];
    e.count++;
    const isFav = favSet.has(c.id);
    const isTrash = trashSet.has(c.id);
    if (isFav) e.fav++;
    if (isTrash) e.trashed++;
    if (t === "borderline") {
      if (isFav) borderlineFav.push(brief(c));
      if (isTrash) borderlineTrashed.push(brief(c));
    }
  }
  for (const e of Object.values(byTier)) {
    e.favRate = rate(e.fav, e.count);
    e.trashRate = rate(e.trashed, e.count);
  }
  return { taggedCount, byTier, borderlineFav, borderlineTrashed };
}

/** discoveryLens(1..4) 別の採用数と fav / トラッシュ数。レンズ無し・範囲外は untagged。 */
export function computeLensStats({ cases, favIds, trashedIds }) {
  const favSet = new Set(favIds || []);
  const trashSet = new Set(trashedIds || []);
  const byLens = Object.fromEntries(LENSES.map((l) => [l, { count: 0, fav: 0, trashed: 0 }]));
  let untagged = 0;
  let taggedCount = 0;
  for (const c of cases || []) {
    const l = lensOf(c);
    if (l === null) {
      untagged++;
      continue;
    }
    taggedCount++;
    byLens[l].count++;
    if (favSet.has(c.id)) byLens[l].fav++;
    if (trashSet.has(c.id)) byLens[l].trashed++;
  }
  return { taggedCount, untagged, byLens };
}

/** JSONL テキストを配列へ。壊れた行・空行は読み飛ばす。 */
export function parseJsonl(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* 壊れた行は無視 */
    }
  }
  return out;
}

/**
 * 却下ログ（logs/rejections-*.jsonl）の要約。プロンプト肥大（以前の ENAMETOOLONG 事故の原因）を避けるため、
 * 全文は流さず「直近 days 日の件数・理由上位・パイプライン別・サンプル少数（タイトルは切り詰め）」だけにする。
 */
export function summarizeRejections(entries, { now = new Date(), days = 7, topReasons = 8, sampleMax = 10, titleMax = 60 } = {}) {
  const from = now.getTime() - days * 86400000;
  const inWindow = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== "object") continue;
    const t = Date.parse(e.date);
    if (!Number.isFinite(t) || t < from || t > now.getTime() + 86400000) continue;
    inWindow.push(e);
  }
  const reasonCounts = new Map();
  const byPipeline = {};
  for (const e of inWindow) {
    const r = String(e.reason || "unknown");
    reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
    const p = String(e.pipeline || "unknown");
    byPipeline[p] = (byPipeline[p] || 0) + 1;
  }
  const byReason = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topReasons)
    .map(([reason, count]) => ({ reason, count }));
  const clip = (s) => (String(s).length > titleMax ? `${String(s).slice(0, titleMax)}…` : String(s));
  const samples = inWindow.slice(-sampleMax).map((e) => ({ title: clip(e.title || ""), reason: String(e.reason || "unknown") }));
  return { total: inWindow.length, windowDays: days, byReason, byPipeline, samples };
}
