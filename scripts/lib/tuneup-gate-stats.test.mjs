// tuneup-gate-stats.mjs のテスト（node:test）。v3 Phase 3: 週次見直しの入力に足す統計。
// 実行: node --test scripts/lib/tuneup-gate-stats.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGateTierStats, computeLensStats, summarizeRejections, parseJsonl } from "./tuneup-gate-stats.mjs";

const mk = (id, o = {}) => ({ id, title: `事例${id}`, link: `https://ex.com/${id}`, summary: `要約${id}`, ...o });

test("computeGateTierStats: 旧データ(gateTierなし)混在でも壊れず legacy に集計する", () => {
  const cases = [
    mk("a1", { gateTier: "accept" }),
    mk("a2", { gateTier: "accept" }),
    mk("b1", { gateTier: "borderline" }),
    mk("b2", { gateTier: "borderline" }),
    mk("b3", { gateTier: "borderline" }),
    mk("old1"),
    mk("old2", { gateTier: "???" }),
  ];
  const r = computeGateTierStats({ favIds: ["a1", "b1", "b2", "old1"], trashedIds: ["a2", "b3"], cases });
  assert.equal(r.taggedCount, 5);
  assert.deepEqual(r.byTier.accept, { count: 2, fav: 1, trashed: 1, favRate: 0.5, trashRate: 0.5 });
  assert.equal(r.byTier.borderline.count, 3);
  assert.equal(r.byTier.borderline.fav, 2);
  assert.equal(r.byTier.borderline.trashed, 1);
  assert.ok(Math.abs(r.byTier.borderline.favRate - 2 / 3) < 1e-9);
  assert.equal(r.byTier.legacy.count, 2);
  assert.equal(r.byTier.legacy.fav, 1);
  assert.deepEqual(r.borderlineFav.map((x) => x.id), ["b1", "b2"]);
  assert.deepEqual(r.borderlineTrashed.map((x) => x.id), ["b3"]);
  assert.equal(r.borderlineFav[0].link, "https://ex.com/b1");
});

test("computeGateTierStats: 0件・全旧データでも率は0（NaNを出さない）", () => {
  const r = computeGateTierStats({ favIds: [], trashedIds: [], cases: [mk("x")] });
  assert.equal(r.taggedCount, 0);
  assert.equal(r.byTier.accept.favRate, 0);
  assert.equal(r.byTier.borderline.trashRate, 0);
  assert.deepEqual(r.borderlineFav, []);
  const e = computeGateTierStats({ favIds: undefined, trashedIds: undefined, cases: undefined });
  assert.equal(e.taggedCount, 0);
});

test("computeGateTierStats: fav と trash の両方に入る id でも borderline 一覧は各1件", () => {
  const r = computeGateTierStats({ favIds: ["b1"], trashedIds: ["b1"], cases: [mk("b1", { gateTier: "borderline" })] });
  assert.equal(r.borderlineFav.length, 1);
  assert.equal(r.borderlineTrashed.length, 1);
});

test("computeLensStats: レンズ1〜4別の採用数・fav・trash。範囲外/無しは untagged", () => {
  const cases = [
    mk("l1a", { discoveryLens: 1 }),
    mk("l1b", { discoveryLens: 1 }),
    mk("l2", { discoveryLens: 2 }),
    mk("l4", { discoveryLens: 4 }),
    mk("bad", { discoveryLens: 9 }),
    mk("old"),
  ];
  const r = computeLensStats({ cases, favIds: ["l1a", "l4", "old"], trashedIds: ["l1b"] });
  assert.equal(r.taggedCount, 4);
  assert.equal(r.untagged, 2);
  assert.deepEqual(r.byLens[1], { count: 2, fav: 1, trashed: 1 });
  assert.deepEqual(r.byLens[2], { count: 1, fav: 0, trashed: 0 });
  assert.deepEqual(r.byLens[3], { count: 0, fav: 0, trashed: 0 });
  assert.deepEqual(r.byLens[4], { count: 1, fav: 1, trashed: 0 });
});

test("parseJsonl: 壊れた行は読み飛ばす", () => {
  const out = parseJsonl('{"a":1}\nnot json\n\n{"b":2}\n');
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});

const NOW = new Date("2026-10-20T03:00:00Z");
test("summarizeRejections: 窓内のみ・理由別top・サンプル件数とタイトル長に上限（プロンプト肥大防止）", () => {
  const entries = [];
  for (let i = 0; i < 40; i++) entries.push({ date: "2026-10-19T01:00:00Z", pipeline: "cc", title: "あ".repeat(200) + i, reason: i % 4 === 0 ? "no-merit" : "not-new", link: "" });
  for (let i = 0; i < 9; i++) entries.push({ date: "2026-10-19T01:00:00Z", pipeline: "cc", title: `r${i}`, reason: `rare-${i}` });
  entries.push({ date: "2026-08-01T00:00:00Z", pipeline: "cc", title: "古い", reason: "old-reason" });
  const s = summarizeRejections(entries, { now: NOW, days: 7, topReasons: 5, sampleMax: 10, titleMax: 30 });
  assert.equal(s.total, 49);
  assert.equal(s.byReason.length, 5);
  assert.deepEqual(s.byReason[0], { reason: "not-new", count: 30 });
  assert.ok(!s.byReason.some((r) => r.reason === "old-reason"));
  assert.equal(s.samples.length, 10);
  assert.ok(s.samples.every((x) => x.title.length <= 31));
  assert.deepEqual(s.byPipeline, { cc: 49 });
});

test("summarizeRejections: 空・不正入力でも落ちない", () => {
  const s = summarizeRejections(undefined, { now: NOW });
  assert.equal(s.total, 0);
  assert.deepEqual(s.byReason, []);
  const t = summarizeRejections([{ title: "x" }, null, { date: "bad", reason: "r" }], { now: NOW });
  assert.equal(t.total, 0);
});
