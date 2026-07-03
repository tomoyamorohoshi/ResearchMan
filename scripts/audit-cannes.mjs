/**
 * 決定論的 Cannes 2026 網羅監査。
 * data/cannes2026-winners.json（正解リスト）の各受賞について、cases.json に
 * 「その作品が・その部門で」登録されているか（award文字列に当該部門が含まれるか）を確認する。
 * 抜けがあれば一覧表示して exit 1。LLMに依存しない単一ソースの真実チェック。
 *
 * 追加チェック（2026-07-04・レポートのみ・pre-pushはブロックしない）:
 *   - レベル一致検証: 部門は一致しているのにGrand Prix/Gold/Silver/Bronze等のレベルが
 *     参照リストと食い違うセグメントをWARN
 *   - 余分事例検出: cases.json側にあるが参照リストに対応winnerが無い部門×レベルの
 *     組み合わせをWARN（参照リストの欠落 or cases.json側の誤りの可能性）
 *   これらは参照リストが不完全（Silver/Bronzeの完全名簿非公開等）な場合に誤検知しうるため
 *   既定はレポートのみ。 --strict を付けるとWARNもexit 1にする。
 *
 * 使い方: node scripts/audit-cannes.mjs [--strict] [--out /path/to/report.json]
 *         （npm run audit:cannes）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRICT = process.argv.includes("--strict");
const outIdx = process.argv.indexOf("--out");
const OUT_PATH = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/cannes2026-winners.json"), "utf8")).winners;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/cases.json"), "utf8"));
const cn = cases.filter((c) => (c.award || "").includes("Cannes Lions 2026"));

const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "2026", "campaign", "lions", "x", "by", "ft", "feat"]);
const deaccent = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s) => deaccent(s || "").toLowerCase().replace(/[（(].*?[）)]/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ");
const toks = (s) => new Set(norm(s).split(/\s+/).filter((w) => w && w.length > 1 && !STOP.has(w)));
const jac = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
const flat = (s) => norm(s).replace(/\s/g, "");
const ALIAS = { "claudecanigetasixpackquicklyhowcanicommunicatebetterwithmymom": "anthropic-claude-super-bowl", "atimeandaplace": "anthropic-claude-super-bowl", "rosaliaftbjorkyvestumorberghain": "rosalia-berghain", "thefinalcopyofilonspecht": "loreal-final-copy" };

function findAllRM(rec) {
  const f = flat(rec.title); if (ALIAS[f]) { const a = cn.find((c) => c.id === ALIAS[f]); return a ? [a] : []; }
  const rt = toks(rec.title), rb = flat(rec.brand);
  const m = [];
  for (const c of cn) { const ct = toks(c.title); let s = jac(rt, ct); if (flat(c.title) === f) s = 1; else if (rb && flat(c.client) && (flat(c.client).includes(rb) || rb.includes(flat(c.client))) && jac(rt, ct) >= 0.3) s = Math.max(s, 0.8); if (s >= 0.5) m.push(c); }
  return m;
}
function awardHasCategory(award, cat) {
  const a = award.toLowerCase();
  const has = (re) => re.test(a);
  switch (cat) {
    case "Film": return has(/\bfilm lions\b/) || (has(/\bfilm\b/) && !has(/film craft/));
    case "Film Craft": return has(/film craft/);
    case "Digital Craft": return has(/digital craft/);
    case "Industry Craft": return has(/industry craft/);
    case "Design": return has(/\bdesign\b/);
    case "Outdoor": return has(/outdoor/);
    case "Print & Publishing": return has(/print/);
    case "Audio & Radio": return has(/audio\s*&\s*radio|radio\s*&\s*audio|audio and radio/);
    case "Direct": return has(/\bdirect\b/);
    case "Media": return has(/\bmedia\b/);
    case "PR": return has(/\bpr lions\b/);
    case "Social & Creator": return has(/social\s*&\s*creator|social and creator|social\s*&\s*influencer/);
    case "Brand Experience & Activation": return has(/brand experience/);
    case "Creative Commerce": return has(/creative commerce/);
    case "Creative B2B": return has(/b2b/);
    case "Creative Data": return has(/creative data/);
    case "Creative Strategy": return has(/creative strategy/);
    case "Creative Effectiveness": return has(/creative effectiveness/);
    case "Creative Brand": return has(/creative brand/);
    case "Creative Business Transformation": return has(/business transformation/);
    case "Innovation": return has(/innovation/);
    case "Entertainment": return award.split("/").some((seg) => { const s = seg.toLowerCase(); return /entertainment/.test(s) && !/for music|for sport|for gaming/.test(s); });
    case "Entertainment for Music": return has(/for music/);
    case "Entertainment for Sport": return has(/for sport/);
    case "Entertainment for Gaming": return has(/for gaming/);
    case "Luxury": return has(/luxury/);
    case "Health & Wellness": return has(/health\s*&\s*wellness|health and wellness/);
    case "Pharma": return has(/pharma/);
    case "Sustainable Development Goals": return has(/sustainable development|\bsdg\b/);
    case "Glass: The Lion for Change": return has(/glass/);
    case "Titanium": return has(/titanium/);
    case "Grand Prix for Good": return has(/grand prix for good/);
    default: return has(cat.toLowerCase().split(" ")[0]);
  }
}

// award文字列を "/" 区切りのセグメントに分解
function awardSegments(award) {
  return (award || "").split("/").map((s) => s.trim()).filter(Boolean);
}
// セグメントからレベル（Grand Prix/Gold/Silver/Bronze/Titanium等）を抽出
function extractLevel(segment) {
  const s = segment.toLowerCase();
  if (/grand prix for good/.test(s)) return "Grand Prix for Good";
  if (/grand prix/.test(s)) return "Grand Prix";
  if (/titanium/.test(s)) return "Titanium";
  if (/\bgold\b/.test(s)) return "Gold";
  if (/\bsilver\b/.test(s)) return "Silver";
  if (/\bbronze\b/.test(s)) return "Bronze";
  return null;
}
const ALL_CATEGORIES = [...new Set(ref.map((w) => w.category))];
function segmentCategory(segment) {
  for (const cat of ALL_CATEGORIES) {
    if (awardHasCategory(segment, cat)) return cat;
  }
  return null;
}

const missing = [];
const levelMismatches = [];
// caseId -> 参照リスト上でこのcaseにマッチした部門のSet（余分事例検出に使う）
const caseRefCategories = new Map();

for (const w of ref) {
  const matches = findAllRM(w);
  const covered = matches.length && matches.some((m) => awardHasCategory(m.award, w.category));
  if (!covered) missing.push(w);

  for (const m of matches) {
    if (!awardHasCategory(m.award, w.category)) continue;
    if (!caseRefCategories.has(m.id)) caseRefCategories.set(m.id, new Set());
    caseRefCategories.get(m.id).add(w.category);

    // 同一部門に複数レベル受賞（例: Oreo CowsのBE&A Gold+Silver）がありうるため、
    // 該当部門の全セグメントを見て、そのうち1つでもw.levelと一致すればOKとする
    const matchingSegs = awardSegments(m.award).filter((s) => awardHasCategory(s, w.category));
    if (matchingSegs.length) {
      const foundLevels = matchingSegs.map(extractLevel).filter(Boolean);
      if (foundLevels.length && !foundLevels.includes(w.level)) {
        levelMismatches.push({ id: m.id, category: w.category, refLevel: w.level, foundLevels: foundLevels.join("/"), segments: matchingSegs.join(" | ") });
      }
    }
  }
}

// 余分事例検出: cases.json側の各awardセグメントが指す部門が、参照リストにこのcase用として無いもの。
// 参照リストは2026年のみなので、award文字列中の他年（例: Cannes Lions 2025）のセグメントは対象外
const extraSegments = [];
for (const c of cn) {
  const refCats = caseRefCategories.get(c.id) || new Set();
  for (const seg of awardSegments(c.award)) {
    if (!seg.includes("Cannes Lions 2026")) continue;
    const cat = segmentCategory(seg);
    if (!cat) continue; // 部門判定できないセグメントは安全側でスキップ
    if (!refCats.has(cat)) extraSegments.push({ id: c.id, category: cat, segment: seg });
  }
}

const byCat = {};
missing.forEach((w) => (byCat[w.category] = byCat[w.category] || []).push(w));
console.log(`Cannes 2026 deterministic audit — reference winners: ${ref.length}, RM 2026 cases: ${cn.length}`);

const report = { missing, levelMismatches, extraSegments };
if (OUT_PATH) fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));

if (missing.length === 0) {
  console.log("✓ PASS — RMは正解リストの全受賞作を部門単位で網羅しています。");
} else {
  console.log(`✗ FAIL — ${missing.length} 件の受賞が RM で未カバー:\n`);
  for (const cat of Object.keys(byCat).sort()) {
    console.log(`### ${cat} (${byCat[cat].length})`);
    byCat[cat].forEach((w) => console.log(`   - ${w.level}: ${w.title} — ${w.brand}`));
  }
}

if (levelMismatches.length) {
  console.log(`\n⚠ WARN — レベル不一致 ${levelMismatches.length} 件（参照リストと部門は一致するがレベルが食い違う）:`);
  levelMismatches.forEach((m) => console.log(`   - ${m.id} [${m.category}]: 参照=${m.refLevel} / RM記載=${m.foundLevels}`));
}
if (extraSegments.length) {
  console.log(`\n⚠ WARN — 余分な部門セグメント ${extraSegments.length} 件（参照リストに対応winnerが無い。参照リストの欠落かRM側の誤りの可能性）:`);
  extraSegments.forEach((e) => console.log(`   - ${e.id}: "${e.segment}"`));
}

const hardFail = missing.length > 0;
const softFail = STRICT && (levelMismatches.length > 0 || extraSegments.length > 0);
if (hardFail || softFail) process.exit(1);
process.exit(0);
