/**
 * 決定論的 Cannes 2026 網羅監査。
 * data/cannes2026-winners.json（正解リスト）の各受賞について、cases.json に
 * 「その作品が・その部門で」登録されているか（award文字列に当該部門が含まれるか）を確認する。
 * 抜けがあれば一覧表示して exit 1。LLMに依存しない単一ソースの真実チェック。
 *
 * 使い方: node scripts/audit-cannes.mjs        （npm run audit:cannes）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/cannes2026-winners.json"), "utf8")).winners;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/cases.json"), "utf8"));
const cn = cases.filter((c) => (c.award || "").includes("Cannes Lions 2026"));

const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "2026", "campaign", "lions", "x", "by", "ft", "feat"]);
const deaccent = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s) => deaccent(s || "").toLowerCase().replace(/[（(].*?[）)]/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ");
const toks = (s) => new Set(norm(s).split(/\s+/).filter((w) => w && w.length > 1 && !STOP.has(w)));
const jac = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
const flat = (s) => norm(s).replace(/\s/g, "");
const ALIAS = { "claudecanigetasixpackquicklyhowcanicommunicatebetterwithmymom": "anthropic-claude-super-bowl", "atimeandaplace": "anthropic-claude-super-bowl", "rosaliaftbjorkyvestumorberghain": "rosalia-berghain" };

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

const missing = [];
for (const w of ref) {
  const matches = findAllRM(w);
  const covered = matches.length && matches.some((m) => awardHasCategory(m.award, w.category));
  if (!covered) missing.push(w);
}

const byCat = {};
missing.forEach((w) => (byCat[w.category] = byCat[w.category] || []).push(w));
console.log(`Cannes 2026 deterministic audit — reference winners: ${ref.length}, RM 2026 cases: ${cn.length}`);
if (missing.length === 0) {
  console.log("✓ PASS — RMは正解リストの全受賞作を部門単位で網羅しています。");
  process.exit(0);
}
console.log(`✗ FAIL — ${missing.length} 件の受賞が RM で未カバー:\n`);
for (const cat of Object.keys(byCat).sort()) {
  console.log(`### ${cat} (${byCat[cat].length})`);
  byCat[cat].forEach((w) => console.log(`   - ${w.level}: ${w.title} — ${w.brand}`));
}
process.exit(1);
