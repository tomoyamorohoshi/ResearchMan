// scripts/lib/case-search.mjs のユニットテスト。node --test で実行。
// CLI (scripts/search-cases.mjs) と MCP ルート (src/app/api/mcp/route.ts) が共有する
// 検索ロジックの単一ソースを、実データ (data/cases.json) に対する既知クエリで検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { searchCases } from "./case-search.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = JSON.parse(readFileSync(join(ROOT, "data", "cases.json"), "utf8"));
const cases = Array.isArray(raw) ? raw : raw.cases;

test("既知クエリ 'robotics' は該当2件をスコア降順・年降順で返す", () => {
  const { total, results } = searchCases(cases, { keywords: ["robotics"], limit: 12 });
  assert.equal(total, 2);
  assert.deepEqual(
    results.map((r) => r.c.id),
    ["scaniverse-ai-usdz-2026", "bts-spot-boston-dynamics"]
  );
});

test("tag フィルタ: 'Tech/Robotics' は該当2件のみ返す", () => {
  const { total, results } = searchCases(cases, { tags: ["Tech/Robotics"] });
  assert.equal(total, 2);
  const ids = results.map((r) => r.c.id).sort();
  assert.deepEqual(ids, ["bts-spot-boston-dynamics", "scaniverse-ai-usdz-2026"].sort());
});

test("year フィルタ: 'robotics' クエリ + 2026年のみだと1件(2026年のみ)になる", () => {
  const { total, results } = searchCases(cases, { keywords: ["robotics"], yearRange: "2026" });
  assert.equal(total, 1);
  assert.equal(results[0].c.id, "scaniverse-ai-usdz-2026");
});

test("year フィルタ: range指定 (2020-2022) で2021年の1件のみに絞られる", () => {
  const { total, results } = searchCases(cases, { keywords: ["robotics"], yearRange: "2020-2022" });
  assert.equal(total, 1);
  assert.equal(results[0].c.id, "bts-spot-boston-dynamics");
});

test("requireAll: 全キーワードがAND一致する事例だけに絞る", () => {
  const orResult = searchCases(cases, { keywords: ["robotics", "scaniverse"] });
  const andResult = searchCases(cases, { keywords: ["robotics", "scaniverse"], requireAll: true });
  assert.equal(orResult.total, 2);
  assert.equal(andResult.total, 1);
  assert.equal(andResult.results[0].c.id, "scaniverse-ai-usdz-2026");
});

test("0件ケース: 存在しないキーワードは total 0 / results 空配列", () => {
  const { total, results } = searchCases(cases, { keywords: ["zzz_no_such_keyword_xyz"] });
  assert.equal(total, 0);
  assert.deepEqual(results, []);
});

test("limit: 指定件数までに切り詰める（totalは切り詰め前の件数）", () => {
  const { total, results } = searchCases(cases, { keywords: ["robotics"], limit: 1 });
  assert.equal(total, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0].c.id, "scaniverse-ai-usdz-2026");
});

test("keywords 未指定・タグのみ指定時は全件スコア1で一致扱いになる", () => {
  const { results } = searchCases(cases, { tags: ["Tech/Robotics"] });
  assert.ok(results.every((r) => r.score === 1));
});
