/**
 * 既存ケースに「リサーチオーダー」ソースタグを遡及付与する。
 * 出自は各 add-*.mjs スクリプトの id 定義から逆引きする（過去のリサーチバッチ＝タブ）。
 * 冪等：既に付いていれば追加しない。
 *
 *   Music          ← add-music-cases / add-music-award-cases
 *   Album Sites    ← add-album-site-cases / add-remaining-album-cases
 *   Launch & Reveal← add-launch-visual-cases
 *   Radar          ← add-latest-cases（3日に1回の自動リサーチ相当の直近追加分）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const MAP = {
  Music: ["add-music-cases.mjs", "add-music-award-cases.mjs"],
  "Album Sites": ["add-album-site-cases.mjs", "add-remaining-album-cases.mjs"],
  "Launch & Reveal": ["add-launch-visual-cases.mjs"],
  Radar: ["add-latest-cases.mjs"],
};

function idsFromScript(file) {
  const text = fs.readFileSync(path.join(__dirname, file), "utf8");
  const ids = new Set();
  for (const m of text.matchAll(/\bid:\s*"([^"]+)"|"id":\s*"([^"]+)"/g)) {
    ids.add(m[1] || m[2]);
  }
  return ids;
}

const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf8"));
const byId = new Map(cases.map((c) => [c.id, c]));

for (const [tag, files] of Object.entries(MAP)) {
  const ids = new Set();
  for (const f of files) for (const id of idsFromScript(f)) ids.add(id);
  let tagged = 0;
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) continue;
    if (!c.sources) c.sources = [];
    if (!c.sources.includes(tag)) {
      c.sources.push(tag);
      tagged++;
    }
  }
  console.log(`${tag}: ${tagged}件付与 (script ids ${ids.size})`);
}

fs.writeFileSync(CASES_PATH, JSON.stringify(cases, null, 2));
console.log("done.");
