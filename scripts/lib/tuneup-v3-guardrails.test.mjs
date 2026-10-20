// v3 Phase 3 のガードレール追加分のテスト（node:test）。
//  - cc.roundFoci は4レンズ固定（件数・順序・領域は変えない。文言と sourceRefs の並びのみ可）
//  - data/sources.json の tier/enabled 変更を checkSourcesChange に実配線（applySourceChanges / checkSourcesChangeProposal）
// 実行: node --test scripts/lib/tuneup-v3-guardrails.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRoundFociLenses,
  overlayRoundFociText,
  checkResearchTuningChange,
  applySourceChanges,
  checkSourcesChangeProposal,
} from "./tuneup-guardrails.mjs";

const lens = (n, o = {}) => ({
  label: `レンズ${n}`,
  sources: `src${n}`,
  sourceRefs: [`s${n}a`, `s${n}b`, `s${n}c`],
  diversity: `div${n}`,
  lens: n,
  langs: ["en", "ja"],
  ...o,
});
const foci = () => [1, 2, 3, 4].map((n) => lens(n));
const tuning = (roundFoci = foci()) => ({
  tech: { lanes: [1, 2, 3].map((n) => ({ label: `T${n}`, sources: `ts${n}` })) },
  cc: { roundFoci },
});

test("checkRoundFociLenses: 文言変更(label/sources/diversity)と sourceRefs 並べ替えは OK", () => {
  const next = foci();
  next[0].label = "新しい文言";
  next[1].diversity = "別の多様性";
  next[2].sources = "別ソース";
  next[3].sourceRefs = ["s4c", "s4a", "s4b"];
  assert.deepEqual(checkRoundFociLenses(foci(), next), { ok: true, errors: [] });
});

test("checkRoundFociLenses: 5件目の追加を拒否", () => {
  const r = checkRoundFociLenses(foci(), [...foci(), lens(5)]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /4|件数/);
});

test("checkRoundFociLenses: 削除(3件)を拒否", () => {
  assert.equal(checkRoundFociLenses(foci(), foci().slice(0, 3)).ok, false);
});

test("checkRoundFociLenses: 順序入れ替えを拒否", () => {
  const next = foci();
  [next[0], next[1]] = [next[1], next[0]];
  assert.equal(checkRoundFociLenses(foci(), next).ok, false);
});

test("checkRoundFociLenses: 領域を決める他キー(lens/langs等)の変更を拒否", () => {
  const next = foci();
  next[0].lens = 9;
  assert.equal(checkRoundFociLenses(foci(), next).ok, false);
  const next2 = foci();
  next2[1].langs = ["fr"];
  assert.equal(checkRoundFociLenses(foci(), next2).ok, false);
});

test("checkRoundFociLenses: sourceRefs の追加・削除(並びだけでない変更)を拒否", () => {
  const next = foci();
  next[0].sourceRefs = ["s1a", "s1b"];
  assert.equal(checkRoundFociLenses(foci(), next).ok, false);
  const next2 = foci();
  next2[0].sourceRefs = ["s1a", "s1b", "zzz"];
  assert.equal(checkRoundFociLenses(foci(), next2).ok, false);
});

test("checkRoundFociLenses: 旧側が配列でなければ判定しない(初期導入)", () => {
  assert.equal(checkRoundFociLenses(undefined, foci()).ok, true);
});

test("overlayRoundFociText: AI が lens/langs を落とした・変えた出力でも、文言キーだけ採用し他は旧値を保つ", () => {
  const aiOut = [1, 2, 3, 4].map((n) => ({ label: `新${n}`, sources: `s${n}`, diversity: `d${n}`, sourceRefs: [`s${n}c`, `s${n}b`, `s${n}a`], lens: 99 }));
  const merged = overlayRoundFociText(foci(), aiOut);
  assert.equal(merged[0].label, "新1");
  assert.equal(merged[0].lens, 1);
  assert.deepEqual(merged[0].langs, ["en", "ja"]);
  assert.deepEqual(merged[0].sourceRefs, ["s1c", "s1b", "s1a"]);
  assert.deepEqual(checkRoundFociLenses(foci(), merged), { ok: true, errors: [] });
});

test("overlayRoundFociText: 件数が違えば AI 出力をそのまま返す(ガードレールで拒否させる)", () => {
  const five = [...foci(), lens(5)];
  assert.equal(overlayRoundFociText(foci(), five), five);
  assert.equal(overlayRoundFociText(undefined, five), five);
});

test("checkResearchTuningChange: roundFoci の5件目追加は総合判定でも拒否される", () => {
  const r = checkResearchTuningChange(tuning(), tuning([...foci(), lens(5)]));
  assert.equal(r.ok, false);
});

test("checkResearchTuningChange: 4レンズ維持の文言変更(2件以内)は通る", () => {
  const next = foci();
  next[0].label = "x";
  const r = checkResearchTuningChange(tuning(), tuning(next));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// ── sources.json 配線 ──
const mkSrc = (id, o = {}) => ({ id, kind: "web", locator: `https://${id}.com/`, lang: "en", region: "欧州", tier: 2, hitDensity: null, enabled: false, note: "", ...o });
const reg = () => ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => mkSrc(id));

test("applySourceChanges: id 指定の部分更新を適用し、元配列を破壊しない", () => {
  const old = reg();
  const snap = JSON.stringify(old);
  const next = applySourceChanges(old, [{ id: "a", tier: 1 }, { id: "b", enabled: true }]);
  assert.equal(next.find((s) => s.id === "a").tier, 1);
  assert.equal(next.find((s) => s.id === "b").enabled, true);
  assert.equal(JSON.stringify(old), snap);
});

test("checkSourcesChangeProposal: tier/enabled 各5件までは OK", () => {
  const changes = ["a", "b", "c", "d", "e"].map((id) => ({ id, tier: 1, enabled: true }));
  const r = checkSourcesChangeProposal(reg(), changes);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.tierChanges, 5);
  assert.equal(r.enabledChanges, 5);
  assert.equal(r.next.length, 8);
});

test("checkSourcesChangeProposal: 6件の tier 変更を拒否", () => {
  const r = checkSourcesChangeProposal(reg(), ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, tier: 1 })));
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /tier changes exceed/);
});

test("checkSourcesChangeProposal: 6件の enabled 変更を拒否", () => {
  const r = checkSourcesChangeProposal(reg(), ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, enabled: true })));
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /enabled changes exceed/);
});

test("checkSourcesChangeProposal: tier/enabled 以外のキー変更(locator等)を拒否", () => {
  const r = checkSourcesChangeProposal(reg(), [{ id: "a", locator: "https://evil.com/" }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /locator/);
});

test("checkSourcesChangeProposal: 未知 id の追加を拒否 / changes が配列でなければ拒否 / 空配列は変更なしで OK", () => {
  assert.equal(checkSourcesChangeProposal(reg(), [{ id: "zzz", tier: 1 }]).ok, false);
  assert.equal(checkSourcesChangeProposal(reg(), "x").ok, false);
  const none = checkSourcesChangeProposal(reg(), []);
  assert.equal(none.ok, true);
  assert.equal(none.tierChanges + none.enabledChanges, 0);
});

test("checkSourcesChangeProposal: tier の値域違反はスキーマで拒否", () => {
  assert.equal(checkSourcesChangeProposal(reg(), [{ id: "a", tier: 99 }]).ok, false);
});
