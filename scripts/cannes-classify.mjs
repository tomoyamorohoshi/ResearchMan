/**
 * /tmp/cannes-audit/missing.json の各受賞を、既存RM作品の「多重受賞（追記）」か「新規作成」かに分類する。
 *   - 既存作品が別部門でも受賞 → その作品の award 文字列に " / <新award>" を追記（重複カードを作らない）
 *   - 真に新規 → create.json へ
 * 出力: /tmp/cannes-audit/append.json, /tmp/cannes-audit/create.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const missing = JSON.parse(fs.readFileSync("/tmp/cannes-audit/missing.json", "utf8"));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/cases.json"), "utf8"));
const cn = cases.filter((c) => (c.award || "").includes("Cannes Lions 2026"));

const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "2026", "campaign", "lions", "x", "by", "ft", "feat"]);
const norm = (s) => (s || "").toLowerCase().replace(/[（(].*?[）)]/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ");
const toks = (s) => new Set(norm(s).split(/\s+/).filter((w) => w && w.length > 1 && !STOP.has(w)));
const jac = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
const flat = (s) => norm(s).replace(/\s/g, "");

// 既知の別名（タイトル表記が大きく異なる多重受賞作）
const ALIAS = {
  "claudecanigetasixpackquicklyhowcanicommunicatebetterwithmymom": "anthropic-claude-super-bowl",
  "atimeandaplace": "anthropic-claude-super-bowl",
};

function findExisting(rec) {
  const f = flat(rec.title);
  if (ALIAS[f]) return cn.find((c) => c.id === ALIAS[f]) || null;
  const rt = toks(rec.title), rb = flat(rec.brand);
  let best = null, bestScore = 0;
  for (const c of cn) {
    const ct = toks(c.title);
    const j = jac(rt, ct);
    const sameBrand = rb && flat(c.client) && (flat(c.client).includes(rb) || rb.includes(flat(c.client)));
    let score = j;
    if (flat(c.title) === f) score = 1;
    else if (sameBrand && j >= 0.34) score = Math.max(score, 0.8);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.5 ? best : null;
}

const appendMap = {}; // id -> Set(awardSegments)
const toCreate = [];
for (const rec of missing) {
  const ex = findExisting(rec);
  if (ex) {
    // 既存awardに同カテゴリが既にあればスキップ
    const catKey = rec.category.toLowerCase().replace(/[^a-z]/g, "");
    const hasCat = ex.award.toLowerCase().replace(/[^a-z]/g, "").includes(catKey);
    if (!hasCat) {
      (appendMap[ex.id] = appendMap[ex.id] || new Set()).add(rec.award);
    }
  } else {
    toCreate.push(rec);
  }
}

const appendList = Object.entries(appendMap).map(([id, set]) => ({ id, add: [...set] }));
fs.writeFileSync("/tmp/cannes-audit/append.json", JSON.stringify(appendList, null, 2));
fs.writeFileSync("/tmp/cannes-audit/create.json", JSON.stringify(toCreate, null, 2));

console.log("APPEND (multi-win to existing):", appendList.length, "works");
appendList.forEach((a) => console.log("   ", a.id, "+=", a.add.map((s) => s.replace("Cannes Lions 2026 ", "")).join(" | ")));
console.log("\nCREATE (new cases):", toCreate.length);
const byCat = {}; toCreate.forEach((r) => byCat[r.category] = (byCat[r.category] || 0) + 1);
console.log(JSON.stringify(byCat));
