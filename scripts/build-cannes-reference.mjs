/**
 * 監査エージェント6体のトランスクリプトから Cannes 2026 受賞作マスターリストを抽出し、
 * リポジトリ内の正解リスト data/cannes2026-winners.json に固定化する（一度きりの生成）。
 * 以後の監査はこの固定ファイルとの決定論的差分で行う（scripts/audit-cannes.mjs）。
 *
 * 使い方: node scripts/build-cannes-reference.mjs <transcriptDir>
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
const normCat = (c) => c === "Luxury & Lifestyle" ? "Luxury" : c;
const cleanTitle = (t) => decode(t).replace(/\s*\((?:campaign|\d+(?:st|nd|rd|th) metal|[^)]*metal[^)]*)\)\s*$/i, "").trim();

const winners = [];
const seen = new Set();
for (const id of FILES) {
  const raw = lastJson(path.join(DIR, id + ".output")); if (!raw) { console.log("!! no json", id); continue; }
  let data; try { data = JSON.parse(decode(raw)); } catch (e) { console.log("!! parse", id, e.message); continue; }
  for (const [cat0, levels] of Object.entries(data.categories || {})) {
    const cat = normCat(cat0);
    for (const lv of LEVELS) for (const w of (levels[lv] || [])) {
      const title = cleanTitle(w.title); if (!title) continue;
      const key = cat + "|" + title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(key)) continue; seen.add(key);
      winners.push({ category: cat, level: lv === "GrandPrix" ? "Grand Prix" : lv === "TitaniumLions" ? "Titanium" : lv, title, brand: decode(w.brand || ""), agency: decode(w.agency || ""), market: decode(w.market || "") });
    }
  }
}
winners.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
const out = { _note: "Cannes Lions 2026 公式受賞作の正解リスト（監査の単一ソース）。6体の独立監査エージェントが lovethework公式DB＋トレード各誌から構築。Silver/Bronzeは公開記録に名前がある分のみ（大規模部門は完全名簿が非公開）。", generatedFrom: "6 audit agents", count: winners.length, winners };
fs.writeFileSync(path.join(__dirname, "../data/cannes2026-winners.json"), JSON.stringify(out, null, 2));
console.log("reference written:", winners.length, "winners");
const byCat = {}; winners.forEach((w) => byCat[w.category] = (byCat[w.category] || 0) + 1);
console.log(JSON.stringify(byCat, null, 0));
