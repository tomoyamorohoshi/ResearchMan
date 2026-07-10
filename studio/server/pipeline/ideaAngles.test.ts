/**
 * pipeline/ideaAngles.ts の純粋関数テスト（node:test）。
 * 生成オーケストレーション(generateIdeaAngles)自体はAgent SDK呼び出しを伴うため対象外
 * （sdkRunner.ts・caseResearch.tsの各Agent呼び出しと同じ位置づけ）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildIdeaAnglesPrompt, validateIdeaAngles } from "./ideaAngles.js";

test("buildIdeaAnglesPrompt: 事例一覧を含み15〜25個の指示を出す", () => {
  const prompt = buildIdeaAnglesPrompt("- [case-1] Foo（Client）: summary");
  assert.match(prompt, /case-1/);
  assert.match(prompt, /15〜25/);
});

const VALID_IDS = new Set(["case-1", "case-2", "case-3", "case-4"]);

function makeAngle(i: number, exemplars: string[] = ["case-1"]) {
  return { id: `angle-${i}`, label: `切り口${i}`, description: `説明${i}`, exemplarCaseIds: exemplars };
}

test("validateIdeaAngles: 配列でなければ失敗", () => {
  const r = validateIdeaAngles({ not: "array" }, VALID_IDS);
  assert.equal(r.ok, false);
});

test("validateIdeaAngles: 15個未満は失敗", () => {
  const raw = Array.from({ length: 10 }, (_, i) => makeAngle(i));
  const r = validateIdeaAngles(raw, VALID_IDS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /15/);
});

test("validateIdeaAngles: 15〜25個は成功しそのまま通る", () => {
  const raw = Array.from({ length: 18 }, (_, i) => makeAngle(i));
  const r = validateIdeaAngles(raw, VALID_IDS);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.angles.length, 18);
});

test("validateIdeaAngles: 25個超は先頭25個に丸められる", () => {
  const raw = Array.from({ length: 30 }, (_, i) => makeAngle(i));
  const r = validateIdeaAngles(raw, VALID_IDS);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.angles.length, 25);
});

test("validateIdeaAngles: 実在しないexemplarCaseIdは除外され、0件になった切り口自体も破棄される", () => {
  const raw = [
    ...Array.from({ length: 16 }, (_, i) => makeAngle(i, ["case-1", "存在しないid"])),
    makeAngle(99, ["存在しないidのみ"]), // exemplar全滅 → 破棄される
  ];
  const r = validateIdeaAngles(raw, VALID_IDS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.angles.length, 16); // 99番は破棄されている
    assert.ok(r.angles.every((a) => a.exemplarCaseIds.every((id) => VALID_IDS.has(id))));
  }
});

test("validateIdeaAngles: id/label/descriptionが欠落した要素は無視される", () => {
  const raw = [
    ...Array.from({ length: 15 }, (_, i) => makeAngle(i)),
    { id: "", label: "空id", description: "d", exemplarCaseIds: ["case-1"] },
    { id: "no-label", label: "", description: "d", exemplarCaseIds: ["case-1"] },
  ];
  const r = validateIdeaAngles(raw, VALID_IDS);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.angles.length, 15);
});

test("validateIdeaAngles: id重複は先勝ちで1件のみ採用", () => {
  const raw = [
    ...Array.from({ length: 15 }, (_, i) => makeAngle(i)),
    { id: "dup", label: "A", description: "descA", exemplarCaseIds: ["case-1"] },
    { id: "dup", label: "B", description: "descB", exemplarCaseIds: ["case-2"] },
  ];
  const r = validateIdeaAngles(raw, VALID_IDS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.angles.length, 16); // 15 + dup(1件のみ採用)
    const dupEntries = r.angles.filter((a) => a.id === "dup");
    assert.equal(dupEntries.length, 1);
    assert.equal(dupEntries[0].label, "A");
  }
});
