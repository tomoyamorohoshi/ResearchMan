/**
 * 監査エージェント6体のトランスクリプト(JSONL)から最終JSON(受賞作マスターリスト)を抽出し、
 * data/cases.json の現状(Cannes 2026)と突合して、部門×レベルの「抜け」を算出する。
 * 大きなトランスクリプトを読み込むがprintは集計のみ（呼び出し側コンテキストを汚さない）。
 *
 * 使い方: node scripts/cannes-gap.mjs <transcriptDir>
 */
import fs from "fs";
import path from "path";

const DIR = process.argv[2];
const FILES = {
  "G1 Film/Craft/Design": "ad33b4ce4a670e010.output",
  "G2 Outdoor/Print/Audio/Direct/Media": "a5ebfe44627ff9890.output",
  "G3 PR/Social/BXA/Commerce/B2B": "a6a55db11cf3e7da6.output",
  "G4 CreativeData/Strategy/Eff/Brand/BizTrans/Innovation": "a6e8a6f94878fdfac.output",
  "G5 Entertainment/Luxury": "a64b4b11ecaf63437.output",
  "G6 Health/Pharma/SDG/Glass/Titanium/GPforGood": "aac21b7610996c540.output",
};

function decode(s) {
  return (s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function lastAssistantText(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  let text = "";
  for (const ln of lines) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (o.type === "assistant" && o.message?.content) {
      const t = o.message.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (t.trim()) text = t; // keep last non-empty
    }
  }
  return text;
}
function extractJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { return text.slice(start, i + 1); } }
  }
  return null;
}

// --- build master list ---
const master = {}; // category -> level -> [{title,brand,agency,market}]
const LEVELS = ["GrandPrix", "Gold", "Silver", "Bronze", "TitaniumLions"];
for (const [label, fname] of Object.entries(FILES)) {
  const fp = path.join(DIR, fname);
  if (!fs.existsSync(fp)) { console.log(`!! missing transcript: ${label}`); continue; }
  const raw = extractJson(lastAssistantText(fp));
  if (!raw) { console.log(`!! no JSON in ${label}`); continue; }
  let data; try { data = JSON.parse(decode(raw)); } catch (e) { console.log(`!! parse fail ${label}: ${e.message}`); continue; }
  const cats = data.categories || {};
  for (const [cat, levels] of Object.entries(cats)) {
    master[cat] = master[cat] || {};
    for (const lv of LEVELS) {
      if (!Array.isArray(levels[lv])) continue;
      master[cat][lv] = (master[cat][lv] || []).concat(levels[lv]);
    }
  }
}

// --- current RM Cannes 2026 titles ---
const cases = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../data/cases.json"), "utf8"));
const norm = (s) => decode(s || "").toLowerCase().replace(/[（(].*?[）)]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const rmTitles = cases.filter((c) => (c.award || "").includes("Cannes Lions 2026")).map((c) => norm(c.title));
const rmSet = new Set(rmTitles);
function inRM(title) {
  const n = norm(title);
  if (rmSet.has(n)) return true;
  for (const t of rmSet) { if (t && n && (t.includes(n) || n.includes(t)) && Math.min(t.length, n.length) >= 6) return true; }
  return false;
}

// --- gap report ---
let totalDocumented = 0, totalMissing = 0;
const missingByCat = {};
for (const [cat, levels] of Object.entries(master)) {
  const seen = new Set();
  const missing = [];
  let docCount = 0;
  for (const lv of LEVELS) {
    for (const w of (levels[lv] || [])) {
      const key = norm(w.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      docCount++;
      if (!inRM(w.title)) missing.push(`${lv.replace("GrandPrix","GP").replace("TitaniumLions","Titanium")}: ${w.title} — ${w.brand}`);
    }
  }
  totalDocumented += docCount; totalMissing += missing.length;
  missingByCat[cat] = { docCount, have: docCount - missing.length, missing };
}

// award文字列ビルダー
function awardString(cat, lv) {
  const level = lv === "GrandPrix" ? "Grand Prix" : lv === "TitaniumLions" ? "" : lv;
  if (cat === "Titanium") return `Cannes Lions 2026 Titanium Lions${level ? " " + level : ""}`.trim();
  if (cat === "Grand Prix for Good") return "Cannes Lions 2026 Grand Prix for Good";
  if (cat.startsWith("Glass")) return `Cannes Lions 2026 Glass: The Lion for Change ${level}`.trim();
  return `Cannes Lions 2026 ${cat} Lions ${level}`.replace(/\s+/g, " ").trim();
}
const cleanTitle = (t) => decode(t).replace(/\s*\((?:campaign|\d+(?:st|nd|rd|th) metal|[^)]*metal[^)]*)\)\s*$/i, "").trim();

// missing.json 出力
const missingRecords = [];
for (const [cat, levels] of Object.entries(master)) {
  const seen = new Set();
  for (const lv of LEVELS) {
    for (const w of (levels[lv] || [])) {
      const key = norm(w.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!inRM(w.title)) {
        missingRecords.push({ category: cat, level: lv, award: awardString(cat, lv), title: cleanTitle(w.title), brand: decode(w.brand || ""), agency: decode(w.agency || ""), market: decode(w.market || "") });
      }
    }
  }
}
fs.writeFileSync("/tmp/cannes-audit/missing.json", JSON.stringify(missingRecords, null, 2));

console.log("=== GAP ANALYSIS (documented winners vs RM) ===");
for (const cat of Object.keys(missingByCat).sort()) {
  const m = missingByCat[cat];
  console.log(`\n### ${cat}  documented:${m.docCount} inRM:${m.have} MISSING:${m.missing.length}`);
  m.missing.forEach((s) => console.log("   - " + s));
}
console.log(`\n=== TOTAL documented:${totalDocumented}  missing:${totalMissing} ===`);
