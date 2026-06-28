/**
 * /tmp/cannes-audit/gen-*.json を読み込み、検証・id一意化・重複排除して data/cases.json にマージする。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(__dirname, "../data/cases.json");
const DIR = "/tmp/cannes-audit";

const REQ = ["id", "title", "summary", "client", "agency", "categories", "award", "year", "regions", "link", "thumbnail", "overview", "background", "execution", "evaluationImpact", "sources"];
const norm = (s) => (s || "").toLowerCase().replace(/[（(].*?[）)]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

const cases = JSON.parse(fs.readFileSync(CASES, "utf8"));
const ids = new Set(cases.map((c) => c.id));
const titleSet = new Set(cases.filter((c) => (c.award || "").includes("Cannes Lions 2026")).map((c) => norm(c.title)));

let collected = [];
for (let i = 0; i < 12; i++) {
  const f = path.join(DIR, `gen-${i}.json`);
  if (!fs.existsSync(f)) continue;
  let arr;
  try { arr = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log(`!! parse fail gen-${i}: ${e.message}`); continue; }
  if (!Array.isArray(arr)) { console.log(`!! gen-${i} not array`); continue; }
  collected.push(...arr);
  console.log(`gen-${i}: ${arr.length}`);
}

let added = 0, skippedDup = 0, bad = 0;
for (const c of collected) {
  const miss = REQ.filter((k) => !(k in c));
  if (miss.length) { console.log(`  bad (missing ${miss.join(",")}): ${c.id || c.title}`); bad++; continue; }
  if (!Array.isArray(c.relatedWorks)) c.relatedWorks = [];
  if (titleSet.has(norm(c.title))) { skippedDup++; continue; }
  // unique id
  let id = (c.id || norm(c.title)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let base = id, n = 2;
  while (ids.has(id)) id = `${base}-${n++}`;
  c.id = id;
  c.thumbnail = `/thumbnails/${id}.jpg`;
  ids.add(id); titleSet.add(norm(c.title));
  cases.push(c);
  added++;
}
fs.writeFileSync(CASES, JSON.stringify(cases, null, 2));
console.log(`\nADDED ${added} | skipped dup ${skippedDup} | bad ${bad} | total now ${cases.length}`);
