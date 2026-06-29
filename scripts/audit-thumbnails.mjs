/**
 * サムネイル健全性監査。プレースホルダ/誤スクレイプ画像を検出して exit 1。
 *  (1) 既知プレースホルダのハッシュと一致するファイル（金色WORK/ベージュ/roastbrief等）
 *  (2) 3ファイル以上が完全一致 = 集約ページのog:imageを使い回した疑い
 *      （2件はprint/main等の正規バリアントとして許容）
 *  (3) thumbnailが/thumbnails/配下なのに実体が無い
 * 使い方: node scripts/audit-thumbnails.mjs  （npm run audit:thumbnails）
 */
import fs from "fs"; import path from "path"; import crypto from "crypto";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cases.json"), "utf8"));

// 既知プレースホルダ（集約ページのog:image）。検出したら誤り。
const BAD_HASHES = {
  "bb29396b91840b2ba5e129c29f64c555": "brand-innovators 金色WORKトロフィー",
  "5bbace56884b362a081e835cbabce2bc": "lovethework 空白ベージュ",
  "b994ce2d3b7ec1c4bafab4edcf687f0e": "roastbrief SHORTLISTスライド",
};
const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");

let fail = 0;
const hashToIds = {};
for (const c of cases) {
  const t = c.thumbnail || "";
  if (!t.startsWith("/thumbnails/")) continue;
  const p = path.join(ROOT, "public" + t);
  if (!fs.existsSync(p)) { console.log(`✗ MISSING file: ${c.id} (${t})`); fail++; continue; }
  const h = md5(p);
  if (BAD_HASHES[h]) { console.log(`✗ PLACEHOLDER: ${c.id} = ${BAD_HASHES[h]}`); fail++; }
  (hashToIds[h] = hashToIds[h] || []).push(c.id);
}
for (const [h, ids] of Object.entries(hashToIds)) {
  if (ids.length >= 3) { console.log(`✗ DUP x${ids.length} (同一画像の使い回し疑い): ${ids.join(", ")}`); fail++; }
}
if (fail === 0) { console.log("✓ PASS — プレースホルダ/欠落/3件以上の重複サムネは無し。"); process.exit(0); }
console.log(`\n✗ FAIL — ${fail} 件のサムネ問題。正しいキャンペーン画像に差し替えてください。`);
process.exit(1);
