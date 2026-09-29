// scripts/lib/case-gate-criteria.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/case-gate-criteria.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GATE_CRITERIA_TEXT,
  GATE_LITMUS_TEXT,
  normalizeGateItem,
  parseBakeoffOutput,
  summarizeBakeoff,
  buildBakeoffPrompt,
} from "./case-gate-criteria.mjs";

test("基準文言: A/B/C・告知のみreject・awwwardsはBの根拠にならない旨を含む", () => {
  assert.match(GATE_CRITERIA_TEXT, /A[\s\S]*一文/);
  assert.match(GATE_CRITERIA_TEXT, /B[\s\S]*クラフト/);
  assert.match(GATE_CRITERIA_TEXT, /C[\s\S]*新規性/);
  assert.match(GATE_CRITERIA_TEXT, /awwwards/);
  assert.match(GATE_CRITERIA_TEXT, /告知/);
});

test("リトマス文言: 正例(Auspicious/Suspicious Art)と逆例4種を含む", () => {
  assert.match(GATE_LITMUS_TEXT, /Auspicious Art/);
  for (const s of ["日向坂46", "Kingdom Hearts IV", "VketReal 2026", "awwwards"]) {
    assert.ok(GATE_LITMUS_TEXT.includes(s), s);
  }
});

test("normalizeGateItem: 正常なacceptはそのまま", () => {
  const r = normalizeGateItem({ title: "t", url: "https://a", verdict: "accept", criterion: "B", reason: "r" });
  assert.equal(r.verdict, "accept");
  assert.equal(r.criterion, "B");
});

test("normalizeGateItem: 不正なverdictはrejectへフォールバック", () => {
  assert.equal(normalizeGateItem({ verdict: "maybe", criterion: "A" }).verdict, "reject");
  assert.equal(normalizeGateItem({}).verdict, "reject");
  assert.equal(normalizeGateItem(null).verdict, "reject");
});

test("normalizeGateItem: accept でも criterion が A/B/C 以外ならrejectへ（安全側）", () => {
  const r = normalizeGateItem({ verdict: "accept", criterion: "none" });
  assert.equal(r.verdict, "reject");
  assert.equal(r.criterion, "none");
  assert.equal(normalizeGateItem({ verdict: "accept", criterion: "Z" }).verdict, "reject");
});

test("normalizeGateItem: reject の criterion は none に正規化", () => {
  assert.equal(normalizeGateItem({ verdict: "reject", criterion: "A" }).criterion, "none");
});

test("normalizeGateItem: 大文字小文字・空白ゆれを許容", () => {
  const r = normalizeGateItem({ verdict: " ACCEPT ", criterion: "c" });
  assert.equal(r.verdict, "accept");
  assert.equal(r.criterion, "C");
});

test("parseBakeoffOutput: items配列を正規化して返す", () => {
  const out = parseBakeoffOutput({
    bakeoffItems: [
      { title: "a", url: "u1", verdict: "accept", criterion: "A", reason: "x" },
      { title: "b", url: "u2", verdict: "reject", criterion: "none", reason: "告知" },
      "garbage",
    ],
    fetchNote: "ok",
  });
  assert.equal(out.items.length, 3);
  assert.equal(out.items[2].verdict, "reject");
  assert.equal(out.fetchNote, "ok");
});

test("parseBakeoffOutput: nullや配列欠落は items 空・fetchFailed", () => {
  assert.deepEqual(parseBakeoffOutput(null).items, []);
  assert.equal(parseBakeoffOutput(null).fetchFailed, true);
  assert.equal(parseBakeoffOutput({}).fetchFailed, true);
  assert.equal(parseBakeoffOutput({ bakeoffItems: [] }).fetchFailed, true);
});

test("summarizeBakeoff: accept率・基準内訳・代表例3件", () => {
  const items = [
    { title: "1", url: "u1", verdict: "accept", criterion: "A", reason: "r1" },
    { title: "2", url: "u2", verdict: "accept", criterion: "B", reason: "r2" },
    { title: "3", url: "u3", verdict: "accept", criterion: "B", reason: "r3" },
    { title: "4", url: "u4", verdict: "accept", criterion: "C", reason: "r4" },
    { title: "5", url: "u5", verdict: "reject", criterion: "none", reason: "r5" },
  ];
  const s = summarizeBakeoff(items);
  assert.equal(s.count, 5);
  assert.equal(s.accepted, 4);
  assert.equal(s.acceptRate, 0.8);
  assert.deepEqual(s.byCriterion, { A: 1, B: 2, C: 1 });
  assert.equal(s.examples.length, 3);
  assert.ok(s.examples.every((e) => e.verdict === "accept"));
});

test("summarizeBakeoff: 0件はacceptRate null", () => {
  const s = summarizeBakeoff([]);
  assert.equal(s.count, 0);
  assert.equal(s.acceptRate, null);
});

test("buildBakeoffPrompt: 基準・リトマス・URL・N・marker・WebFetch指示・インジェクション対策を含む", () => {
  const p = buildBakeoffPrompt({ id: "x", locator: "https://example.com/latest", note: "n" }, 10);
  assert.ok(p.includes(GATE_CRITERIA_TEXT));
  assert.ok(p.includes(GATE_LITMUS_TEXT));
  assert.ok(p.includes("https://example.com/latest"));
  assert.ok(p.includes("10"));
  assert.ok(p.includes("bakeoffItems"));
  assert.match(p, /WebFetch/);
  assert.match(p, /指示.*無視/);
});

test("normalizeGateItem: フォールバックで reject に倒した項目は invalid:true", () => {
  assert.equal(normalizeGateItem({ verdict: "maybe" }).invalid, true);
  assert.equal(normalizeGateItem({ verdict: "accept", criterion: "none" }).invalid, true);
  assert.equal(normalizeGateItem("garbage").invalid, true);
  assert.equal(normalizeGateItem({ verdict: "reject", criterion: "none" }).invalid, false);
  assert.equal(normalizeGateItem({ verdict: "accept", criterion: "A" }).invalid, false);
});

test("parseBakeoffOutput: URL重複は最初の1件に除去し duplicatesRemoved を返す", () => {
  const out = parseBakeoffOutput({
    bakeoffItems: [
      { title: "a", url: "https://x/1", verdict: "accept", criterion: "A" },
      { title: "a2", url: "https://x/1/", verdict: "reject" },
      { title: "b", url: "https://x/2", verdict: "reject" },
      { title: "c", url: "", verdict: "reject" },
      { title: "d", url: "", verdict: "reject" },
    ],
  });
  assert.equal(out.items.length, 4);
  assert.equal(out.duplicatesRemoved, 1);
});

test("summarizeBakeoff: invalidCount を集計する", () => {
  const s = summarizeBakeoff([
    normalizeGateItem({ verdict: "maybe", url: "u" }),
    normalizeGateItem({ verdict: "accept", criterion: "A", url: "v" }),
  ]);
  assert.equal(s.invalidCount, 1);
});
