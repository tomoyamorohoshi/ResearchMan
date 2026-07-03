/**
 * Technology（tech.json）の軽量整合監査。ネットワークアクセスなし・決定論。
 * pre-push で毎回走らせても速い前提の機械チェックのみを行う。
 *
 * チェック項目:
 *   1. 必須フィールドの欠落
 *   2. id重複
 *   3. type / domains が data/tech-tag-vocabulary.json の語彙内か
 *   4. date が YYYY-MM 形式か
 *   5. sourcesが欠落していないか（P2-1で全件必須化した）
 *   6. thumbnailが /thumbnails/tech/ 配下で実体があり5KB以上か
 *   7. public/thumbnails/tech/ 側の孤立ファイル（tech.jsonから未参照）
 *   8. linksがpost（X等）1本のみのentryをWARN（x.com依存の新規流入を検知。FAILにはしない）
 *
 * 使い方: node scripts/audit-tech.mjs  （npm run audit:tech）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const tech = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tech.json"), "utf8"));
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tech-tag-vocabulary.json"), "utf8"));
const THUMB_DIR = path.join(ROOT, "public/thumbnails/tech");

const REQUIRED_FIELDS = [
  "id", "title", "org", "type", "domains", "date", "summary", "point",
  "license", "links", "thumbnail", "sources",
];
const MIN_THUMB_BYTES = 5000;

let fail = 0;
const warn = [];

// ── 1. 必須フィールド / 3. 語彙 / 4. date形式 / 5. sources ──
for (const t of tech) {
  const missing = REQUIRED_FIELDS.filter((f) => {
    const v = t[f];
    if (Array.isArray(v)) return v.length === 0;
    return v === undefined || v === null || v === "";
  });
  if (missing.length) {
    console.log(`✗ MISSING FIELDS: ${t.id || "(id不明)"} → ${missing.join(", ")}`);
    fail++;
  }
  if (t.type && !vocab.Type.includes(t.type)) {
    console.log(`✗ INVALID TYPE: ${t.id} = "${t.type}"（語彙: ${vocab.Type.join("/")}）`);
    fail++;
  }
  for (const d of t.domains || []) {
    if (!vocab.Domain.includes(d)) {
      console.log(`✗ INVALID DOMAIN: ${t.id} = "${d}"（語彙: ${vocab.Domain.join("/")}）`);
      fail++;
    }
  }
  if (t.date && !/^\d{4}-\d{2}$/.test(t.date)) {
    console.log(`✗ INVALID DATE FORMAT: ${t.id} = "${t.date}"（YYYY-MM形式であるべき）`);
    fail++;
  }
}

// ── 2. id重複 ──
const idCounts = {};
for (const t of tech) idCounts[t.id] = (idCounts[t.id] || 0) + 1;
for (const [id, n] of Object.entries(idCounts)) {
  if (n > 1) { console.log(`✗ DUPLICATE ID: ${id} (${n}件)`); fail++; }
}

// ── 6. サムネイル実在・下限サイズ ──
const referencedFiles = new Set();
for (const t of tech) {
  const th = t.thumbnail || "";
  if (!th.startsWith("/thumbnails/tech/")) {
    console.log(`✗ THUMBNAIL PATH: ${t.id} = "${th}"（/thumbnails/tech/ 配下であるべき）`);
    fail++;
    continue;
  }
  const rel = th.replace(/^\/thumbnails\/tech\//, "");
  referencedFiles.add(rel);
  const p = path.join(ROOT, "public" + th);
  if (!fs.existsSync(p)) {
    console.log(`✗ MISSING THUMBNAIL FILE: ${t.id} (${th})`);
    fail++;
    continue;
  }
  const size = fs.statSync(p).size;
  if (size < MIN_THUMB_BYTES) {
    console.log(`✗ THUMBNAIL TOO SMALL: ${t.id} (${size}B < ${MIN_THUMB_BYTES}B、プレースホルダ疑い)`);
    fail++;
  }
}

// ── 7. 孤立サムネイルファイル ──
if (fs.existsSync(THUMB_DIR)) {
  for (const f of fs.readdirSync(THUMB_DIR)) {
    if (!referencedFiles.has(f)) {
      console.log(`✗ ORPHANED THUMBNAIL FILE: public/thumbnails/tech/${f}（tech.jsonから未参照）`);
      fail++;
    }
  }
}

// ── 8. postリンク1本のみ（x.com依存）はWARN ──
for (const t of tech) {
  const links = t.links || [];
  if (links.length === 1 && links[0].kind === "post") {
    warn.push(`${t.id}: 一次ソースが post（${links[0].url}）1本のみ。project/github/product等の永続的なリンクの併記を推奨`);
  }
}

console.log(`\n監査対象: ${tech.length}件`);
if (warn.length) {
  console.log(`\n⚠ WARN — ${warn.length}件（x.com依存リンクのみ。FAILにはしない）:`);
  warn.forEach((w) => console.log(`   - ${w}`));
}

if (fail === 0) {
  console.log("\n✓ PASS — tech.jsonのフィールド・語彙・サムネイル整合に問題なし。");
  process.exit(0);
}
console.log(`\n✗ FAIL — ${fail} 件の問題。`);
process.exit(1);
