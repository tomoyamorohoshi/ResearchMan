/**
 * 既存ケースにソースタグを遡及付与する。
 *   - award に "Cannes Lions 2026" を含む → "Cannes 2026"
 * 既に sources がある場合は重複追加しない。冪等。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf8"));

function addSource(c, tag) {
  if (!c.sources) c.sources = [];
  if (!c.sources.includes(tag)) c.sources.push(tag);
}

let tagged = 0;
for (const c of cases) {
  if ((c.award || "").includes("Cannes Lions 2026")) {
    addSource(c, "Cannes 2026");
    tagged++;
  }
}

fs.writeFileSync(CASES_PATH, JSON.stringify(cases, null, 2));
console.log(`"Cannes 2026" タグ付与: ${tagged}件 / 全${cases.length}件`);
