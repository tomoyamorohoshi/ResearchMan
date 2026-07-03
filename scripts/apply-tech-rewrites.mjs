/**
 * Technology 記事文章の一括適用。
 * 入力: [{id, pointJa, detailJa}] のJSONファイル（複数可）
 * data/tech.json の該当エントリの point / detail を上書きする。
 * 使い方: node scripts/apply-tech-rewrites.mjs <rewrites1.json> [rewrites2.json ...]
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TECH_PATH = path.join(__dirname, "../data/tech.json");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/apply-tech-rewrites.mjs <rewrites.json> ...");
  process.exit(1);
}

const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
const byId = new Map(tech.map((t) => [t.id, t]));

let applied = 0;
for (const f of files) {
  const arr = JSON.parse(await fs.readFile(f, "utf-8"));
  for (const r of arr) {
    const t = byId.get(r.id);
    if (!t) { console.log(`✗ 不明id: ${r.id}`); continue; }
    if (r.pointJa) t.point = r.pointJa;
    if (r.detailJa) t.detail = r.detailJa;
    applied++;
    console.log(`✓ ${r.id} (point ${r.pointJa?.length ?? "-"}字 / detail ${r.detailJa?.length ?? "-"}字)`);
  }
}
await fs.writeFile(TECH_PATH, JSON.stringify(tech, null, 2));
console.log(`\n適用: ${applied}件 → data/tech.json`);
