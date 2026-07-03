/**
 * 部門×作品の粒度で監査する。マスターリストの各受賞(category,level,title)について、
 * RMに「その作品が・その部門で」登録されているかを確認する。
 *   - 作品はあるが当該部門がawardに無い → APPEND（既存awardに部門追記）
 *   - 作品自体が無い → CREATE
 * 出力: /tmp/cannes-audit/append2.json, /tmp/cannes-audit/create2.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DIR = process.argv[2];
const FILES = ["ad33b4ce4a670e010", "a5ebfe44627ff9890", "a6a55db11cf3e7da6", "a6e8a6f94878fdfac", "a64b4b11ecaf63437", "aac21b7610996c540"];
const LEVELS = ["GrandPrix", "Gold", "Silver", "Bronze", "TitaniumLions"];
const decode = (s) => (s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function lastJson(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  let text = "";
  for (const ln of lines) { let o; try { o = JSON.parse(ln); } catch { continue; } if (o.type === "assistant" && o.message?.content) { const t = o.message.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"); if (t.trim()) text = t; } }
  const s = text.indexOf("{"); if (s < 0) return null;
  let d = 0, inStr = false, esc = false;
  for (let i = s; i < text.length; i++) { const ch = text[i]; if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; } if (ch === '"') inStr = true; else if (ch === "{") d++; else if (ch === "}") { d--; if (d === 0) return text.slice(s, i + 1); } }
  return null;
}

// master: list of {category, level, title, brand, agency, market}
const master = [];
for (const id of FILES) {
  const raw = lastJson(path.join(DIR, id + ".output")); if (!raw) continue;
  let data; try { data = JSON.parse(decode(raw)); } catch { continue; }
  for (const [cat, levels] of Object.entries(data.categories || {})) {
    for (const lv of LEVELS) for (const w of (levels[lv] || [])) master.push({ category: cat, level: lv, ...w });
  }
}

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/cases.json"), "utf8"));
const cn = cases.filter((c) => (c.award || "").includes("Cannes Lions 2026"));

const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "2026", "campaign", "lions", "x", "by", "ft", "feat"]);
const norm = (s) => decode(s || "").toLowerCase().replace(/[（(].*?[）)]/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ");
const toks = (s) => new Set(norm(s).split(/\s+/).filter((w) => w && w.length > 1 && !STOP.has(w)));
const jac = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
const flat = (s) => norm(s).replace(/\s/g, "");
const ALIAS = { "claudecanigetasixpackquicklyhowcanicommunicatebetterwithmymom": "anthropic-claude-super-bowl", "atimeandaplace": "anthropic-claude-super-bowl" };

function findAllRM(rec) {
  const f = flat(rec.title); if (ALIAS[f]) { const a = cn.find((c) => c.id === ALIAS[f]); return a ? [a] : []; }
  const rt = toks(rec.title), rb = flat(rec.brand);
  const matches = [];
  for (const c of cn) { const ct = toks(c.title); let s = jac(rt, ct); if (flat(c.title) === f) s = 1; else if (rb && flat(c.client) && (flat(c.client).includes(rb) || rb.includes(flat(c.client))) && jac(rt, ct) >= 0.34) s = Math.max(s, 0.8); if (s >= 0.5) matches.push({ c, s }); }
  return matches.sort((a, b) => b.s - a.s).map((m) => m.c);
}

// category presence predicate on an award string (lowercased)
function awardHasCategory(award, cat) {
  const a = award.toLowerCase();
  const has = (re) => re.test(a);
  switch (cat) {
    case "Film": return has(/\bfilm lions\b/) || (has(/\bfilm\b/) && !has(/film craft/));
    case "Film Craft": return has(/film craft/);
    case "Digital Craft": return has(/digital craft/);
    case "Industry Craft": return has(/industry craft/);
    case "Design": return has(/design lions/) || has(/\bdesign\b/);
    case "Outdoor": return has(/outdoor/);
    case "Print & Publishing": return has(/print/);
    case "Audio & Radio": return has(/audio\s*&\s*radio|radio\s*&\s*audio|audio and radio/);
    case "Direct": return has(/direct lions|\bdirect\b/);
    case "Media": return has(/media lions|\bmedia\b/);
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
    case "Entertainment": return has(/entertainment lions (?!for)/) || (has(/entertainment/) && !has(/for music|for sport|for gaming/));
    case "Entertainment for Music": return has(/for music/);
    case "Entertainment for Sport": return has(/for sport/);
    case "Entertainment for Gaming": return has(/for gaming/);
    case "Luxury & Lifestyle": case "Luxury": return has(/luxury/);
    case "Health & Wellness": return has(/health\s*&\s*wellness|health and wellness/);
    case "Pharma": return has(/pharma/);
    case "Sustainable Development Goals": return has(/sustainable development|\bsdg\b/);
    case "Glass: The Lion for Change": return has(/glass/);
    case "Titanium": return has(/titanium/);
    case "Grand Prix for Good": return has(/grand prix for good/);
    default: return has(cat.toLowerCase().split(" ")[0]);
  }
}
function awardString(cat, lv) {
  const level = lv === "GrandPrix" ? "Grand Prix" : lv === "TitaniumLions" ? "" : lv;
  if (cat === "Titanium") return `Cannes Lions 2026 Titanium Lions${level ? " " + level : ""}`.trim();
  if (cat === "Grand Prix for Good") return "Cannes Lions 2026 Grand Prix for Good";
  if (cat.startsWith("Glass")) return `Cannes Lions 2026 Glass: The Lion for Change ${level}`.trim();
  const c = cat === "Luxury & Lifestyle" ? "Luxury" : cat;
  return `Cannes Lions 2026 ${c} Lions ${level}`.replace(/\s+/g, " ").trim();
}
const cleanTitle = (t) => decode(t).replace(/\s*\((?:campaign|\d+(?:st|nd|rd|th) metal|[^)]*metal[^)]*)\)\s*$/i, "").trim();

// dedupe master by (category, title)
const seen = new Set();
const appendMap = {}; const toCreate = []; const createSeen = new Set();
for (const rec of master) {
  const k = rec.category + "|" + flat(rec.title); if (seen.has(k)) continue; seen.add(k);
  if (!flat(rec.title)) continue;
  const matches = findAllRM(rec);
  if (matches.length) {
    const covered = matches.some((m) => awardHasCategory(m.award, rec.category));
    if (!covered) {
      const rm = matches[0];
      (appendMap[rm.id] = appendMap[rm.id] || new Set()).add(awardString(rec.category, rec.level));
    }
  } else {
    const ck = flat(rec.title); if (createSeen.has(ck)) continue; createSeen.add(ck);
    toCreate.push({ category: rec.category, level: rec.level, award: awardString(rec.category, rec.level), title: cleanTitle(rec.title), brand: decode(rec.brand || ""), agency: decode(rec.agency || ""), market: decode(rec.market || "") });
  }
}
const appendList = Object.entries(appendMap).map(([id, s]) => ({ id, add: [...s] }));
fs.writeFileSync("/tmp/cannes-audit/append2.json", JSON.stringify(appendList, null, 2));
fs.writeFileSync("/tmp/cannes-audit/create2.json", JSON.stringify(toCreate, null, 2));
console.log("APPEND (existing work missing a category-win):", appendList.length, "works,", appendList.reduce((n, a) => n + a.add.length, 0), "segments");
appendList.forEach((a) => console.log("   ", a.id, "+=", a.add.map((s) => s.replace("Cannes Lions 2026 ", "")).join(" | ")));
console.log("\nCREATE (work not in RM):", toCreate.length);
const byCat = {}; toCreate.forEach((r) => byCat[r.category] = (byCat[r.category] || 0) + 1); console.log(JSON.stringify(byCat));
