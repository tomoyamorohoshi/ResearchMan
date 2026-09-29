// scripts/lib/bakeoff-report.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/bakeoff-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCandidates, suggestTier, renderReport, BAKEOFF_MAX_PER_RUN } from "./bakeoff-report.mjs";

const src = (id, tier, kind = "web", enabled = false) => ({ id, kind, tier, enabled, locator: "https://x/" + id });

test("selectCandidates: webのみ・tier昇順(安定)・上限30・scored済みは除外", () => {
  const all = [src("a", 3), src("b", 1), src("x", 1, "x_account"), src("c", 1), src("d", 2)];
  const r = selectCandidates(all, { scoredIds: new Set(["c"]), limit: 30, skip: 0 });
  assert.deepEqual(r.picked.map((s) => s.id), ["b", "d", "a"]);
  assert.equal(r.remaining, 0);
});

test("selectCandidates: enabled問わず対象", () => {
  const r = selectCandidates([src("a", 1, "web", true), src("b", 1, "web", false)], { scoredIds: new Set(), limit: 30, skip: 0 });
  assert.equal(r.picked.length, 2);
});

test("selectCandidates: limit は最大30に丸め、超過分は remaining に数える", () => {
  const all = Array.from({ length: 40 }, (_, i) => src("s" + i, 1));
  const r = selectCandidates(all, { scoredIds: new Set(), limit: 99, skip: 0 });
  assert.equal(BAKEOFF_MAX_PER_RUN, 30);
  assert.equal(r.picked.length, 30);
  assert.equal(r.remaining, 10);
});

test("selectCandidates: skip で先頭をスキップ（並列実行の分割用）", () => {
  const all = Array.from({ length: 5 }, (_, i) => src("s" + i, 1));
  const r = selectCandidates(all, { scoredIds: new Set(), limit: 2, skip: 2 });
  assert.deepEqual(r.picked.map((s) => s.id), ["s2", "s3"]);
  assert.equal(r.remaining, 1);
});

test("suggestTier: 件数不足は判定保留、高accept率はtier1、低率は見送り", () => {
  assert.equal(suggestTier({ count: 3, acceptRate: 1 }), "保留(件数不足)");
  assert.equal(suggestTier({ count: 10, acceptRate: 0.5 }), "tier1推奨");
  assert.equal(suggestTier({ count: 10, acceptRate: 0.3 }), "tier2推奨");
  assert.equal(suggestTier({ count: 10, acceptRate: 0.1 }), "見送り");
  assert.equal(suggestTier({ count: 0, acceptRate: null }), "取得失敗");
});

test("renderReport: 表・accept率降順・取得失敗節・代表例を含む", () => {
  const results = [
    { id: "lo", locator: "https://lo", tier: 2, summary: { count: 10, accepted: 1, acceptRate: 0.1, byCriterion: { A: 1, B: 0, C: 0 }, examples: [{ title: "T-lo", url: "https://lo/1", criterion: "A", reason: "r" }] }, fetchNote: "" },
    { id: "hi", locator: "https://hi", tier: 1, summary: { count: 10, accepted: 6, acceptRate: 0.6, byCriterion: { A: 2, B: 3, C: 1 }, examples: [{ title: "T-hi", url: "https://hi/1", criterion: "B", reason: "r" }] }, fetchNote: "" },
    { id: "ng", locator: "https://ng", tier: 3, summary: { count: 0, accepted: 0, acceptRate: null, byCriterion: { A: 0, B: 0, C: 0 }, examples: [] }, fetchNote: "403" },
  ];
  const md = renderReport({ date: "2026-09-30", results, unscored: ["zz"], n: 10 });
  assert.ok(md.indexOf("hi") < md.indexOf("| lo"));
  assert.match(md, /60%/);
  assert.match(md, /A2 \/ B3 \/ C1/);
  assert.match(md, /T-hi/);
  assert.match(md, /取得失敗/);
  assert.match(md, /403/);
  assert.match(md, /未実行.*zz/);
});

test("renderReport: invalidCount と duplicatesRemoved を注記する", () => {
  const results = [
    { id: "q", locator: "https://q", tier: 1, summary: { count: 5, accepted: 1, acceptRate: 0.2, byCriterion: { A: 1, B: 0, C: 0 }, examples: [], invalidCount: 2 }, fetchNote: "", duplicatesRemoved: 3 },
  ];
  const md = renderReport({ date: "2026-09-30", results, unscored: [], n: 10 });
  assert.match(md, /不正値2/);
  assert.match(md, /重複除去3/);
});
