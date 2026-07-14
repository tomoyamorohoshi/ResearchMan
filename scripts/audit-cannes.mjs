/**
 * 決定論的 Cannes 2026 網羅監査。
 * data/cannes2026-winners-v2.json（正解リスト）の各受賞について、cases.json に
 * 「その作品が・その部門で」登録されているか（award文字列に当該部門が含まれるか）を確認する。
 * 抜けがあれば一覧表示して exit 1。LLMに依存しない単一ソースの真実チェック。
 *
 * v2は2026-07-05にaward-verifierエージェント5体がlovethework.com公式で並列照合した
 * 15部門（VERIFIED_CATEGORIES参照）と、残り16部門（旧v1由来・6監査エージェントの
 * トランスクリプトから抽出・未公式照合）を統合したもの。各winnerのsourceUrlで
 * 出所を区別できる（公式URL or "(旧v1由来・未検証...)"の注記）。
 *
 * 追加チェック（レポートのみ・pre-pushはブロックしない）:
 *   - レベル一致検証: 部門は一致しているのにGrand Prix/Gold/Silver/Bronze等のレベルが
 *     参照リストと食い違うセグメントをWARN。ただし**公式照合済み15部門はFAIL**に昇格する
 *     （2026-07-05。v2のこの部分はレベルが公式確定のため、旧v1のような不完全さの言い訳が効かない）
 *   - 余分事例検出: cases.json側にあるが参照リストに対応winnerが無い部門×レベルの
 *     組み合わせをWARN（参照リストの欠落 or cases.json側の誤りの可能性）
 *   未検証16部門についてはこれらは引き続きWARNのみ（参照リストが不完全な可能性を残す）。
 *   --strict を付けると全部門のWARNもexit 1にする。
 *
 * 使い方: node scripts/audit-cannes.mjs [--strict] [--out /path/to/report.json]
 *         （npm run audit:cannes）
 *
 * 2026-07-14: 監査ロジック本体は scripts/audit-award.mjs（アワード非依存の汎用エンジン）に
 * 委譲した。このファイルにはカンヌ固有の知識（VERIFIED_CATEGORIES・awardHasCategoryの
 * switch文・extractLevel・ALIAS・STOP）のみを残す薄いラッパー。出力・exit code・
 * pre-push hookの動作は移行前と完全に同一（docs/AWARD_RESEARCH_SOP.md 参照）。
 */
import path from "path";
import { fileURLToPath } from "url";
import { runAudit } from "./audit-award.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRICT = process.argv.includes("--strict");
const outIdx = process.argv.indexOf("--out");
const OUT_PATH = outIdx >= 0 ? process.argv[outIdx + 1] : null;

// award-verifierエージェント5体がlovethework.com公式で並列照合済みの部門（2026-07-05）。
// この部門群のレベル不一致はWARNではなくFAILにする（v2のレベルは公式確定のため）
const VERIFIED_CATEGORIES = new Set([
  "Digital Craft", "Creative B2B", "Creative Business Transformation", "Design", "Entertainment",
  "Entertainment for Gaming", "Entertainment for Sport", "Film", "Film Craft", "Grand Prix for Good",
  "Industry Craft", "Pharma", "Outdoor", "Health & Wellness", "Audio & Radio",
]);

const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "2026", "campaign", "lions", "x", "by", "ft", "feat"]);
const ALIAS = { "claudecanigetasixpackquicklyhowcanicommunicatebetterwithmymom": "anthropic-claude-super-bowl", "atimeandaplace": "anthropic-claude-super-bowl", "rosaliaftbjorkyvestumorberghain": "rosalia-berghain", "thefinalcopyofilonspecht": "loreal-final-copy" };

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

const result = runAudit({
  refPath: path.join(__dirname, "../data/cannes2026-winners-v2.json"),
  casesPath: path.join(__dirname, "../data/cases.json"),
  awardPrefix: "Cannes Lions 2026",
  verifiedCategories: VERIFIED_CATEGORIES,
  awardHasCategory,
  extractLevel,
  alias: ALIAS,
  stopwords: STOP,
  strict: STRICT,
  outPath: OUT_PATH,
  label: "Cannes 2026",
});

process.exit(result.exitCode);
