/**
 * Workflow出力ファイルから正式なWeb/SNSケース10件を取り出し、
 * HTMLエンティティ（&amp; 等）をデコードして /tmp/websns-clean.json に保存する。
 */
import fs from "fs";

const OUTPUT = process.argv[2];
const raw = fs.readFileSync(OUTPUT, "utf8");

// 出力ファイルから JSON部分（{"count":...,"cases":[...]}）を抽出
const start = raw.indexOf('{"count"');
if (start === -1) {
  console.error("count JSON not found");
  process.exit(1);
}
// 末尾の対応する } を探す（単純なブレース計数）
let depth = 0, end = -1;
for (let i = start; i < raw.length; i++) {
  if (raw[i] === "{") depth++;
  else if (raw[i] === "}") {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}
const json = raw.slice(start, end);
const data = JSON.parse(json);

// HTMLエンティティのデコード（&amp; &lt; &gt; &quot; &#39; など）
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function deep(o) {
  if (typeof o === "string") return decodeEntities(o);
  if (Array.isArray(o)) return o.map(deep);
  if (o && typeof o === "object") {
    const r = {};
    for (const k of Object.keys(o)) r[k] = deep(o[k]);
    return r;
  }
  return o;
}

const cases = deep(data.cases);
fs.writeFileSync("/tmp/websns-clean.json", JSON.stringify(cases, null, 2));
console.log(`クリーンなケース: ${cases.length}件 → /tmp/websns-clean.json`);
cases.forEach((c) => console.log(`  - ${c.id} | ${c.award} | ${JSON.stringify(c.sources)}`));
