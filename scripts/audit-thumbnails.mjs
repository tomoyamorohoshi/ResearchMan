/**
 * サムネイル健全性監査。プレースホルダ/誤スクレイプ画像を検出して exit 1。
 *  (1) 既知プレースホルダのハッシュと一致するファイル（金色WORK/ベージュ/roastbrief/仏PALMARES等）
 *  (2) 2ファイル以上が完全一致 = 集約ページのog:imageを使い回した疑い
 *      （同一キャンペーンのprint/main等の正規バリアントのみ ALLOWED_DUP_GROUPS で許容）
 *  (3) thumbnailが/thumbnails/配下なのに実体が無い
 * 使い方: node scripts/audit-thumbnails.mjs  （npm run audit:thumbnails）
 */
import fs from "fs"; import path from "path"; import crypto from "crypto";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cases.json"), "utf8"));

// 既知プレースホルダ（集約ページの共通og:image）。検出したら誤り。
const BAD_HASHES = {
  "bb29396b91840b2ba5e129c29f64c555": "brand-innovators 金色WORKトロフィー",
  "5bbace56884b362a081e835cbabce2bc": "lovethework 空白ベージュ",
  "b994ce2d3b7ec1c4bafab4edcf687f0e": "roastbrief SHORTLIST(Media)スライド",
  "1baaf0555a904e649db3d2435ad3d859": "roastbrief SHORTLIST(Creative Commerce)スライド",
  "f933d7d3b62841c6f57b2307a1379f1c": "danstapub 仏PALMARESスライド",
  "b302a15142474732ac27970e03105579": "Taylor Swift汎用プロモ(Life of a Showgirl)",
};

// 同一キャンペーンの正規バリアント（print/main・年違い等）で画像共有を許容する組。
// それ以外で2件以上が完全一致したら集約ページog:imageの使い回しを疑う。
const ALLOWED_DUP_GROUPS = [
  ["heinz-look-familiar", "heinz-look-familiar-outdoor"],
  ["back-market-lets-end-fast-tech", "back-market-lets-end-fast-tech-print"],
  ["spotify-wrapped", "spotify-wrapped-dooh-2018"],
].map((g) => g.slice().sort().join("|"));

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
for (const ids of Object.values(hashToIds)) {
  if (ids.length < 2) continue;
  const key = ids.slice().sort().join("|");
  if (ALLOWED_DUP_GROUPS.includes(key)) continue; // 正規バリアント
  console.log(`✗ DUP x${ids.length} (同一画像の使い回し疑い): ${ids.join(", ")}`);
  fail++;
}
if (fail === 0) { console.log("✓ PASS — プレースホルダ/欠落/重複サムネは無し（正規バリアント除く）。"); process.exit(0); }
console.log(`\n✗ FAIL — ${fail} 件のサムネ問題。正しいキャンペーン画像に差し替えてください。`);
process.exit(1);
