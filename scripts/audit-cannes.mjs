/**
 * 決定論的 Cannes 多年度網羅監査（docs/CANNES_10Y_DESIGN.md §4・§5-6）。
 * 年ごとの参照リストの各受賞について、cases.json に「その作品が・その部門で」登録されているかを確認する。
 *   参照リスト: 2016〜2025 = data/cannes/web/<year>-web.json（winners[]）、2026 = data/cannes2026-winners-v2.json
 *   年の状態: data/cannes/years.json（reference=一覧のみ / writing=事例化中 / complete=監査FAIL対象）
 *     - complete の年だけ従来のFAIL条件（未カバー・公式照合済み部門のレベル不一致）でexit 1
 *     - それ以外の年は同じ問題をWARN表示するだけ（exit 0。pre-pushを止めない）
 *   部門判定は scripts/lib/cannes-categories.mjs の正規化（年をまたぐ名寄せはしない）。
 *   事例に awardEntries（org="cannes"）があれば、その年は award 文字列でなく awardEntries で判定する
 *   （src/lib/awards.ts と同じ年単位の規則）。
 *
 * 2026 のFAIL条件（現状維持）: v2は2026-07-05にaward-verifierエージェント5体がlovethework.com公式で並列照合した
 * 15部門（VERIFIED_CATEGORIES）のレベル不一致をFAIL、残り16部門は WARN のみ。
 * 他の complete 年は参照リスト全部門を「公式確定」として扱う（web JSON は officialCounts と突合済みのため）。
 *
 * 使い方: node scripts/audit-cannes.mjs [--year YYYY] [--strict] [--verbose] [--out report.json]
 *   --strict: 指定年（無指定は全年）を状態に関わらず厳格に見る（WARN相当もexit 1）
 *   --verbose: reference/writing 年の未カバー一覧を省略せず全件表示
 *   （npm run audit:cannes / audit:cannes:strict）
 * 監査ロジック本体は scripts/audit-award.mjs（アワード非依存の汎用エンジン）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runAudit } from "./audit-award.mjs";
import { sameCannesCategory, formatCannesAward } from "./lib/cannes-categories.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// award-verifierエージェント5体がlovethework.com公式で並列照合済みの2026部門（2026-07-05）。
// この部門群のレベル不一致はWARNではなくFAILにする（v2のレベルは公式確定のため）
const VERIFIED_CATEGORIES = new Set([
  "Digital Craft", "Creative B2B", "Creative Business Transformation", "Design", "Entertainment",
  "Entertainment for Gaming", "Entertainment for Sport", "Film", "Film Craft", "Grand Prix for Good",
  "Industry Craft", "Pharma", "Outdoor", "Health & Wellness", "Audio & Radio",
]);

const BASE_STOP = ["the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "campaign", "lions", "x", "by", "ft", "feat"];
const ALIAS_2026 = { "claudecanigetasixpackquicklyhowcanicommunicatebetterwithmymom": "anthropic-claude-super-bowl", "atimeandaplace": "anthropic-claude-super-bowl", "rosaliaftbjorkyvestumorberghain": "rosalia-berghain", "thefinalcopyofilonspecht": "loreal-final-copy" };

const LEVEL_TAIL = /\s+(grand prix|gold|silver|bronze|shortlist.*|finalist.*)$/i;

// セグメントから部門名部分を取り出す（"Cannes Lions 2023 Outdoor Lions Gold" → "Outdoor Lions"）
function segmentCategoryText(seg) {
  let s = seg.replace(/\([^)]*\)/g, " ").replace(/cannes\s*lions\s*\d{4}/i, " ").replace(/\s+/g, " ").trim();
  s = s.replace(LEVEL_TAIL, "").trim(); // "Gold" 等
  const t = s.replace(/\s+grand prix$/i, "").trim(); // "Outdoor Lions Grand Prix"（"Grand Prix for Good" は末尾でないので残る）
  return t || s;
}

export function cannesAwardHasCategory(award, cat) {
  return (award || "").split("/").some((seg) => {
    const s = seg.trim();
    return s && sameCannesCategory(segmentCategoryText(s), cat);
  });
}

// 2026 の v2 参照は Health 版 Grand Prix for Good も同じ部門 "Grand Prix for Good"（subcategory=Health）に含める。
// 従来の判定（award に "grand prix for good" を含めば一致）を維持するため 2026 だけ緩める。他年は年別の公式名どおり別部門。
function hasCategory2026(award, cat) {
  if (cannesAwardHasCategory(award, cat)) return true;
  return sameCannesCategory(cat, "Grand Prix for Good") && /grand prix for good/i.test(award || "");
}

// セグメントからレベル（Grand Prix/Gold/Silver/Bronze/Titanium等）を抽出
function extractLevel(segment) {
  const s = segment.toLowerCase();
  // "Grand Prix for Good"は部門名（category）であり、レベルとしては単純に"Grand Prix"
  // （v2データのGrand Prix for Good部門は level="Grand Prix" として登録されている）
  if (/grand prix/.test(s)) return "Grand Prix";
  if (/titanium/.test(s)) return "Titanium";
  if (/\bgold\b/.test(s)) return "Gold";
  if (/\bsilver\b/.test(s)) return "Silver";
  if (/\bbronze\b/.test(s)) return "Bronze";
  return null;
}

// その年の判定に使う award 文字列。awardEntries（org=cannes・その年）があれば正規形で作り直す
export function caseAwardForYear(c, year) {
  const entries = (c.awardEntries || []).filter((e) => e && e.org === "cannes" && e.category && String(e.year) === String(year));
  if (!entries.length) return c.award;
  return entries.map((e) => formatCannesAward({ year, category: e.category, level: e.level })).join(" / ");
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function refPathForYear(year) {
  return year === 2026
    ? path.join(__dirname, "../data/cannes2026-winners-v2.json")
    : path.join(__dirname, `../data/cannes/web/${year}-web.json`);
}

/**
 * @param {object} o
 * @param {number[]} [o.years] 対象年（既定: states の全年）
 * @param {Record<string,string>} [o.states] 年→状態（既定: data/cannes/years.json）
 * @param {Record<string,Array>} [o.refs] 年→winners（テスト用。無ければファイルから）
 * @param {Array} [o.caseRecords] cases配列（テスト用）
 */
export function runCannesAudit({ years, states, refs = {}, caseRecords, strict = false, verbose = false, outPath = null } = {}) {
  states = states || loadJson(path.join(__dirname, "../data/cannes/years.json"));
  years = years || Object.keys(states).map(Number).sort((a, b) => a - b);
  const casesAll = caseRecords || loadJson(path.join(__dirname, "../data/cases.json"));
  let exitCode = 0;
  const reports = {};
  for (const year of years) {
    const state = states[String(year)];
    if (!state) {
      console.log(`\n=== Cannes ${year} — years.json に状態が無いためスキップ ===`);
      continue;
    }
    const ref = refs[year] || loadJson(refPathForYear(year)).winners;
    const complete = state === "complete";
    const prefix = `Cannes Lions ${year}`;
    console.log(`\n=== Cannes ${year} [${state}] — 参照 ${ref.length} 作品${complete || strict ? "" : "（WARNのみ・exit 0）"} ===`);
    const result = runAudit({
      refWinners: ref,
      caseRecords: casesAll.map((c) => ({ ...c, award: caseAwardForYear(c, year) })),
      awardPrefix: prefix,
      // 2026 は照合済み15部門のみ。他の年は参照リスト全部門を公式確定とみなす
      verifiedCategories: year === 2026 ? VERIFIED_CATEGORIES : new Set(ref.map((w) => w.category)),
      awardHasCategory: year === 2026 ? hasCategory2026 : cannesAwardHasCategory,
      extractLevel,
      alias: year === 2026 ? ALIAS_2026 : {},
      stopwords: new Set([...BASE_STOP, String(year)]),
      strict,
      warnOnly: !complete && !strict,
      verbose: verbose || complete || strict,
      label: `Cannes ${year}`,
      caseLabel: `RM ${year} cases`,
    });
    console.log(`  → 参照 ${result.report.refCount} 作品中 事例側と一致 ${result.report.matchedCount} 件 / 未カバー ${result.report.missing.length} 件`);
    reports[year] = result.report;
    if (result.exitCode) exitCode = 1;
  }
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(reports, null, 2));
  return { exitCode, reports };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const yearArg = flag("--year");
  const result = runCannesAudit({
    years: yearArg ? [Number(yearArg)] : undefined,
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
    outPath: flag("--out"),
  });
  process.exit(result.exitCode);
}
