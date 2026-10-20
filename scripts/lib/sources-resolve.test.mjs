// scripts/lib/sources-registry.mjs の resolveSourcesText / inferSourceId、および
// data/research-tuning.json の sourceRefs 整合性のテスト（node:test）。
// 実行: node --test scripts/lib/sources-resolve.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSourcesText, inferSourceId } from "./sources-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const s = (o) => ({ kind: "web", locator: "https://x.com/", lang: "en", region: "x", tier: 1, hitDensity: null, enabled: false, note: "", ...o });

const REG = [
  s({ id: "a", locator: "https://www.a-site.com/latest", tier: 2, enabled: true }),
  s({ id: "b", locator: "https://b-site.com/", tier: 1, enabled: true }),
  s({ id: "c", locator: "https://c-site.com/", tier: 1, enabled: false }),
  s({ id: "x1", kind: "x_account", locator: "@ideafuls", tier: 1, enabled: true }),
  s({ id: "xq", kind: "x_query", locator: "kinetic art", tier: 3, enabled: true }),
  s({ id: "xl", kind: "x_list", locator: "123", tier: 3, enabled: true }),
];

test("resolveSourcesText: 有効な源が1つも無ければ従来文字列にフォールバック（互換動作）", () => {
  const allOff = REG.map((r) => ({ ...r, enabled: false }));
  assert.equal(resolveSourcesText(["a", "b"], allOff, "LEGACY"), "LEGACY");
  assert.equal(resolveSourcesText(["a", "b"], [], "LEGACY"), "LEGACY");
  assert.equal(resolveSourcesText(["a", "b"], undefined, "LEGACY"), "LEGACY");
});

test("resolveSourcesText: enabledのみ・tier順（同tierはsourceRefs順）・id併記・kind別整形", () => {
  const t = resolveSourcesText(["a", "c", "b", "x1", "xq", "xl", "missing"], REG, "");
  assert.ok(!t.includes("その他の情報源"), "従来文字列が空ならその他の節は出ない");
  assert.ok(!t.includes("c-site.com"), "enabled:false は含めない");
  assert.ok(!t.includes("missing"));
  const iB = t.indexOf("b-site.com");
  const iX = t.indexOf("@ideafuls");
  const iA = t.indexOf("a-site.com");
  const iQ = t.indexOf("kinetic art");
  assert.ok(iB >= 0 && iX > iB && iA > iX && iQ > iA, `tier順: b(1) → x1(1) → a(2) → tier3 (${t})`);
  assert.match(t, /\[b\]/);
  assert.match(t, /\[x1\]/);
  assert.match(t, /X検索/);
  assert.match(t, /Xリスト/);
});

// 期待仕様の変更（2026-10-20）: 従来は「有効源があれば自由文 sources を捨て、有効 sourceRefs のみ」だったが、
// 有効化した少数源だけに探索が狭まる退行（ラウンド3が2源のみ）が出たため、
// 有効 sourceRefs を優先源として先頭に並べ、従来の自由文 sources を「その他の情報源」として残す。
test("resolveSourcesText: 有効源あり＋従来文字列 → 優先源を先頭、その他の情報源として従来文字列を残す（重複は除く）", () => {
  const t = resolveSourcesText(["a", "b"], REG, "a-site.com / foo.com / 広告賞の直近発表 / b-site.com");
  assert.match(t, /[b]/);
  assert.ok(t.indexOf("[b]") < t.indexOf("その他の情報源"), "優先源が先");
  const other = t.slice(t.indexOf("その他の情報源"));
  assert.ok(other.includes("foo.com") && other.includes("広告賞の直近発表"), "従来文字列を残す");
  assert.ok(!other.includes("a-site.com") && !other.includes("b-site.com"), "優先源と重複する従来源は除く");
});

test("resolveSourcesText: 従来文字列が全て優先源と重複 → その他の節を出さない", () => {
  const t = resolveSourcesText(["a", "b"], REG, "a-site.com / b-site.com");
  assert.ok(!t.includes("その他の情報源"));
});

test("resolveSourcesText: 有効源があるが当該sourceRefsに1つも無い → 従来文字列をそのまま（無ければ空）", () => {
  assert.equal(resolveSourcesText(["c"], REG, "LEGACY"), "LEGACY");
  assert.equal(resolveSourcesText([], REG, "LEGACY"), "LEGACY");
  assert.equal(resolveSourcesText(["c"], REG, ""), "");
});

test("inferSourceId: 記事URLのホストからレジストリidを推定（wwwは無視・Xはハンドル）", () => {
  assert.equal(inferSourceId("https://www.b-site.com/some/article", REG), "b");
  assert.equal(inferSourceId("https://a-site.com/x", REG), "a");
  assert.equal(inferSourceId("https://x.com/IdeaFuls/status/1", REG), "x1");
  assert.equal(inferSourceId("https://twitter.com/ideafuls/status/1", REG), "x1");
  assert.equal(inferSourceId("https://unknown.example/", REG), "");
  assert.equal(inferSourceId("", REG), "");
  assert.equal(inferSourceId("not a url", REG), "");
});

test("data/research-tuning.json: cc.roundFoci の sourceRefs は全て sources.json のidで、全登録idがどこかで参照される", () => {
  const tuning = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/research-tuning.json"), "utf-8"));
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/sources.json"), "utf-8"));
  const ids = new Set(reg.map((r) => r.id));
  const referenced = new Set();
  for (const f of tuning.cc.roundFoci) {
    assert.ok(Array.isArray(f.sourceRefs) && f.sourceRefs.length > 0, `${f.label}: sourceRefs`);
    assert.ok(typeof f.sources === "string" && f.sources.trim(), `${f.label}: 互換フォールバック用 sources を維持`);
    for (const r of f.sourceRefs) {
      assert.ok(ids.has(r), `未登録id: ${r}`);
      referenced.add(r);
    }
    assert.ok(!/最低\s*4件/.test(f.diversity), `${f.label}: 国内ノルマ文言が残っていない`);
  }
  for (const id of ids) assert.ok(referenced.has(id), `sources.json の ${id} がどの roundFoci からも参照されていない（有効化しても使われない）`);
});
