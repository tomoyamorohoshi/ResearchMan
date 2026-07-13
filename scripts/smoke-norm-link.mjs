// scripts/lib/norm-link.mjs の単体検証。
// 同一記事の重複カード生成を防ぐための正規化キーが、期待通り「同一視すべきもの」を
// 同一キーに、「別記事とみなすべきもの」を別キーに畳み込むことを確認する。
// 実行: node scripts/smoke-norm-link.mjs
import { normLink } from "./lib/norm-link.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// ── 1. 末尾スラッシュ有無を同一視する ──
{
  const a = normLink("https://example.com/foo");
  const b = normLink("https://example.com/foo/");
  assert(a === b, `末尾スラッシュ有無を同一視 (${a} vs ${b})`);
}

// ── 2. #fragment を除去して同一視する ──
{
  const a = normLink("https://example.com/foo");
  const b = normLink("https://example.com/foo#section2");
  assert(a === b, `#fragmentを除去して同一視 (${a} vs ${b})`);
}

// ── 3. query は保持する（queryが違えば別キーになる） ──
{
  const a = normLink("https://example.com/foo?id=1");
  const b = normLink("https://example.com/foo?id=2");
  const c = normLink("https://example.com/foo");
  assert(a !== b, `queryが違えば別キー (${a} vs ${b})`);
  assert(a !== c, `queryありとqueryなしは別キー (${a} vs ${c})`);
}

// ── 4. ホスト大文字小文字を同一視する ──
{
  const a = normLink("HTTPS://Example.com/foo");
  const b = normLink("https://example.com/foo");
  assert(a === b, `ホスト大文字小文字を同一視 (${a} vs ${b})`);
}

// ── 5. 空文字・不正な文字列など不正入力は "" を返す ──
{
  assert(normLink("") === "", "空文字は\"\"");
  assert(normLink(null) === "", "nullは\"\"");
  assert(normLink(undefined) === "", "undefinedは\"\"");
  assert(normLink("not a url") === "", "パース不能な文字列は\"\"");
  assert(normLink("   ") === "", "空白のみは\"\"");
}

// ── 6. http:// と https:// は別キーとして扱う ──
{
  const a = normLink("http://example.com/foo");
  const b = normLink("https://example.com/foo");
  assert(a !== b, `httpとhttpsは別キー (${a} vs ${b})`);
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: norm-link");
}
