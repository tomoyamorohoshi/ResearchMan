/**
 * Exhibition（exhibition.json）の厳格な整合監査（SPEC §7）。ネットワークアクセスなし・決定論。
 * pre-push で毎回走らせる前提。✗ 行が1つでもあれば exit 1。緩める方向で直さないこと。
 *
 * FAIL: ルート形式 / 必須欠落 / id==slug・パターン・100字・id重複・link重複 / 日付の実在と前後 /
 *       status が statusAsOf 基準の再計算と不一致・statusAsOf が未来 / タグ語彙・都道府県・score・highlight・origin /
 *       official 必須・link 整合・URL スキーム / サムネ配下・実体・最小サイズ /
 *       ended 以外の matchReason 空・UNKNOWN / preference_only seed の混入 / cases・tech の id との衝突
 * WARN: 孤立サムネ、statusAsOf が2日以上古い、admission が UNKNOWN
 *
 * 使い方: node scripts/audit-exhibition.mjs  （npm run audit:exhibition）
 * テスト用差し替え（環境変数）:
 *   EXHIBITION_AUDIT_ROOT   data/ と public/ を持つルート（既定: リポジトリルート）
 *   EXHIBITION_AUDIT_TODAY  「今日」(YYYY-MM-DD)。statusAsOf の未来/陳腐化判定に使う（既定: JST 今日）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MIN_THUMB_BYTES } from "./lib/thumbnail-constraints.mjs";
import { computeStatus, todayJst, daysBetween, isValidYmd } from "./lib/exhibition-status.mjs";
import { SLUG_PATTERN, slugify } from "./lib/exhibition-slug.mjs";
import { normLink } from "./lib/norm-link.mjs";
import { normTitle } from "./lib/norm-title.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.EXHIBITION_AUDIT_ROOT || path.join(__dirname, "..");
const TODAY = process.env.EXHIBITION_AUDIT_TODAY || todayJst();
const THUMB_DIR = path.join(ROOT, "public/thumbnails/exhibition");
const THUMB_PREFIX = "/thumbnails/exhibition/";

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県",
  "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
const VENUE_TYPES = ["museum", "alt_space", "corporate", "media_art_center", "gallery", "other"];
const SOURCE_KINDS = ["official", "listing", "social", "news"];
const REQUIRED_FIELDS = [
  "id", "slug", "title", "artists", "venue", "venueType", "prefecture", "city",
  "startDate", "endDate", "status", "admission", "tags", "score", "matchReason",
  "sources", "link", "thumbnail", "addedAt", "origin",
];

let fail = 0;
const warn = [];
function ng(msg) {
  console.log(`✗ ${msg}`);
  fail++;
}

function readJson(rel, { required }) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    if (required) {
      ng(`ROOT: ${rel} が存在しません`);
      finish();
    }
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    ng(`ROOT: ${rel} をJSONとして読めません（${e.message}）`);
    finish();
  }
  return null;
}

function finish() {
  if (fail === 0) {
    console.log("\n✓ PASS — exhibition.jsonのフィールド・語彙・status・サムネイル整合に問題なし。");
    process.exit(0);
  }
  console.log(`\n✗ FAIL — ${fail} 件の問題。`);
  process.exit(1);
}

const data = readJson("data/exhibition.json", { required: true });
const vocab = readJson("data/exhibition-tag-vocabulary.json", { required: true });
const profile = readJson("data/exhibition-profile.json", { required: false });
const casesIds = new Set((readJson("data/cases.json", { required: false }) || []).map((c) => c?.id));
const techIds = new Set((readJson("data/tech.json", { required: false }) || []).map((t) => t?.id));
const tagVocab = new Set(vocab?.Tag || []);

// ── 1. ルート形式 / statusAsOf ──
let statusAsOfOk = false;
if (data.version !== 1) ng(`ROOT: version が 1 ではありません（${JSON.stringify(data.version)}）`);
if (!isValidYmd(data.statusAsOf)) {
  ng(`ROOT: statusAsOf が実在する YYYY-MM-DD ではありません（${JSON.stringify(data.statusAsOf)}）`);
} else {
  statusAsOfOk = true;
  if (data.statusAsOf > TODAY) {
    ng(`FUTURE statusAsOf: ${data.statusAsOf} は今日(${TODAY})より未来です`);
    statusAsOfOk = false;
  } else if (daysBetween(data.statusAsOf, TODAY) >= 2) {
    warn.push(`statusAsOf が ${data.statusAsOf} で今日(${TODAY})から2日以上古い。日次ジョブ停止の兆候`);
  }
}
if (!Array.isArray(data.items)) {
  ng("ROOT: items が配列ではありません");
  finish();
}
const items = data.items;

const preferenceOnly = (profile?.seeds || []).filter((s) => s.role === "preference_only");
if (!profile) warn.push("data/exhibition-profile.json が無く preference_only の混入検査をスキップした");

const idCounts = {};
const linkCounts = {};
const referencedFiles = new Set();

for (const e of items) {
  const label = e?.id || e?.title || "(id不明)";

  // ── 2. 必須フィールド ──
  const missing = REQUIRED_FIELDS.filter((f) => {
    const v = e[f];
    if (v === undefined || v === null) return true;
    if (f === "sources") return !Array.isArray(v) || v.length === 0;
    if (Array.isArray(v)) return false; // artists / tags は空配列可
    if (f === "matchReason" && e.status === "ended") return false;
    return v === "";
  });
  if (missing.length) ng(`MISSING FIELDS: ${label} → ${missing.join(", ")}`);

  // ── 3. id / slug / link 重複 ──
  if (e.id !== e.slug) ng(`SLUG MISMATCH: ${label} id="${e.id}" slug="${e.slug}"（同一値であるべき）`);
  if (typeof e.id === "string") {
    if (e.id.length > 100) ng(`INVALID SLUG: ${label} が100字を超えています（${e.id.length}字）`);
    if (!SLUG_PATTERN.test(e.id)) ng(`INVALID SLUG: ${label} が ^[a-z0-9]+(-[a-z0-9]+)*$ に適合しません`);
    idCounts[e.id] = (idCounts[e.id] || 0) + 1;
    if (casesIds.has(e.id)) ng(`ID COLLISION: ${e.id} は cases.json の id と衝突（お気に入りの id 名前空間は共有）`);
    if (techIds.has(e.id)) ng(`ID COLLISION: ${e.id} は tech.json の id と衝突（お気に入りの id 名前空間は共有）`);
  }
  const nl = normLink(e.link);
  if (nl) linkCounts[nl] = (linkCounts[nl] || 0) + 1;

  // ── 4. 日付 / 5. status ──
  const sOk = isValidYmd(e.startDate);
  const eOk = isValidYmd(e.endDate);
  if (!sOk) ng(`INVALID DATE: ${label} startDate="${e.startDate}"（実在する YYYY-MM-DD であるべき）`);
  if (!eOk) ng(`INVALID DATE: ${label} endDate="${e.endDate}"（実在する YYYY-MM-DD であるべき）`);
  if (sOk && eOk) {
    if (e.startDate > e.endDate) {
      ng(`INVALID DATE: ${label} endDate(${e.endDate}) < startDate(${e.startDate})`);
    } else if (statusAsOfOk) {
      const expected = computeStatus(e.startDate, e.endDate, data.statusAsOf);
      if (e.status !== expected) {
        ng(`STATUS MISMATCH: ${label} 保存値="${e.status}" だが statusAsOf(${data.statusAsOf}) 基準では "${expected}"（${e.startDate}〜${e.endDate}）`);
      }
    }
  }

  // ── 6. tags / prefecture / score / highlight / origin / venueType ──
  for (const t of e.tags || []) {
    if (!tagVocab.has(t)) ng(`INVALID TAG: ${label} = "${t}"（語彙: ${[...tagVocab].join("/")}）`);
  }
  if (e.prefecture !== undefined && !PREFECTURES.includes(e.prefecture)) {
    ng(`INVALID PREFECTURE: ${label} = "${e.prefecture}"（47都道府県の正式名のみ）`);
  }
  if (e.venueType !== undefined && !VENUE_TYPES.includes(e.venueType)) {
    ng(`INVALID VENUETYPE: ${label} = "${e.venueType}"（${VENUE_TYPES.join("/")}）`);
  }
  if (!Number.isInteger(e.score) || e.score < 0 || e.score > 100) {
    ng(`INVALID SCORE: ${label} = ${JSON.stringify(e.score)}（0〜100の整数）`);
  } else if (e.highlight !== (e.score >= 80)) {
    ng(`INVALID HIGHLIGHT: ${label} highlight=${JSON.stringify(e.highlight)} だが score=${e.score}（highlight===(score>=80)）`);
  }
  if (e.origin !== undefined && e.origin !== "auto" && e.origin !== "intake") {
    ng(`INVALID ORIGIN: ${label} = "${e.origin}"（auto|intake）`);
  }
  if (e.origin === "intake" && !e.intakeUrl) ng(`MISSING INTAKEURL: ${label} は origin=intake なのに intakeUrl がありません`);

  // ── 7. sources / link ──
  const sources = Array.isArray(e.sources) ? e.sources : [];
  for (const s of sources) {
    if (!s || typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) {
      ng(`INVALID SOURCE URL: ${label} sources に http(s) でない URL（${JSON.stringify(s?.url)}）`);
    }
    if (s && !SOURCE_KINDS.includes(s.kind)) ng(`INVALID SOURCE KIND: ${label} kind="${s.kind}"`);
  }
  const officials = sources.filter((s) => s?.kind === "official");
  if (Array.isArray(e.sources) && e.sources.length > 0 && officials.length === 0) {
    ng(`NO OFFICIAL SOURCE: ${label} に kind: official の source がありません（公式裏取りが必須）`);
  }
  if (typeof e.link === "string") {
    if (!/^https?:\/\//.test(e.link)) {
      ng(`INVALID LINK URL: ${label} link="${e.link}" が http(s) ではありません`);
    } else if (officials.length > 0 && !officials.some((s) => normLink(s.url) === nl)) {
      ng(`LINK NOT OFFICIAL: ${label} link="${e.link}" が sources の official のいずれとも一致しません`);
    }
  }

  // ── 8. サムネイル ──
  const th = e.thumbnail || "";
  if (typeof th === "string" && th) {
    if (!th.startsWith(THUMB_PREFIX)) {
      ng(`THUMBNAIL PATH: ${label} = "${th}"（${THUMB_PREFIX} 配下であるべき）`);
    } else {
      referencedFiles.add(th.slice(THUMB_PREFIX.length));
      const p = path.join(ROOT, "public" + th);
      if (!fs.existsSync(p)) {
        ng(`MISSING THUMBNAIL FILE: ${label} (${th})`);
      } else {
        const size = fs.statSync(p).size;
        if (size < MIN_THUMB_BYTES) {
          ng(`THUMBNAIL TOO SMALL: ${label} (${size}B < ${MIN_THUMB_BYTES}B、プレースホルダ疑い)`);
        }
      }
    }
  }

  // ── 9. ended 以外の matchReason / UNKNOWN ──
  if (e.status !== "ended") {
    if (!e.matchReason || String(e.matchReason).trim() === "") ng(`EMPTY MATCHREASON: ${label}`);
    for (const f of ["title", "venue", "startDate", "endDate"]) {
      if (typeof e[f] === "string" && e[f].includes("UNKNOWN")) ng(`UNKNOWN VALUE: ${label} の ${f} に UNKNOWN`);
    }
  }
  if (e.admission === "UNKNOWN") warn.push(`${label}: admission が UNKNOWN`);

  // ── 10. preference_only（嗜好専用 seed）の混入 ──
  for (const seed of preferenceOnly) {
    const seedSlug = slugify(seed.title);
    const nSeed = normTitle(seed.title);
    const nTitle = normTitle(e.title);
    const titleHit =
      nSeed.length >= 4 && nTitle.length >= 4 && (nTitle.includes(nSeed) || nSeed.includes(nTitle));
    const slugHit = seedSlug.length >= 4 && typeof e.slug === "string" && e.slug.includes(seedSlug);
    const urls = [e.link, ...sources.map((s) => s?.url)].map(normLink).filter(Boolean);
    const urlHit = seed.url && urls.includes(normLink(seed.url));
    if (titleHit || slugHit || urlHit) {
      ng(`PREFERENCE_ONLY LEAK: ${label} は嗜好専用 seed「${seed.title}」に該当（掲載禁止）`);
    }
  }
}

for (const [id, n] of Object.entries(idCounts)) {
  if (n > 1) ng(`DUPLICATE ID: ${id} (${n}件)`);
}
for (const [l, n] of Object.entries(linkCounts)) {
  if (n > 1) ng(`DUPLICATE LINK: ${l} (${n}件)`);
}

// ── 孤立サムネイル（WARN） ──
if (fs.existsSync(THUMB_DIR)) {
  for (const f of fs.readdirSync(THUMB_DIR)) {
    if (f.startsWith(".")) continue;
    if (!referencedFiles.has(f)) warn.push(`孤立サムネイル: public/thumbnails/exhibition/${f}（exhibition.jsonから未参照）`);
  }
}

console.log(`\n監査対象: ${items.length}件（statusAsOf=${data.statusAsOf}）`);
if (warn.length) {
  console.log(`\n⚠ WARN — ${warn.length}件（FAILにはしない）:`);
  warn.forEach((w) => console.log(`   - ${w}`));
}
finish();
