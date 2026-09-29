// tuneup-guardrails.mjs の validateSourcesRegistry/checkSourcesChange、
// tuneup-stats.mjs の computeSourceGateStats のテスト（node:test）。
// 実行: node --test scripts/lib/tuneup-sources.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSourcesRegistry,
  checkSourcesChange,
  validateResearchTuning,
  GUARDRAIL_LIMITS,
} from "./tuneup-guardrails.mjs";
import { computeSourceGateStats } from "./tuneup-stats.mjs";

const mk = (id, o = {}) => ({
  id,
  kind: "web",
  locator: `https://${id}.com/`,
  lang: "en",
  region: "欧州",
  tier: 2,
  hitDensity: null,
  enabled: false,
  note: "",
  ...o,
});
const base = () => ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => mk(id));

test("validateSourcesRegistry: 再エクスポート（正常・異常）", () => {
  assert.deepEqual(validateSourcesRegistry(base()), { ok: true, errors: [] });
  assert.equal(validateSourcesRegistry([mk("a", { kind: "rss" })]).ok, false);
});

test("checkSourcesChange: tier/enabledのみの変更は ok", () => {
  const next = base();
  next[0].tier = 1;
  next[1].enabled = true;
  const r = checkSourcesChange(base(), next);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.tierChanges, 1);
  assert.equal(r.enabledChanges, 1);
});

test("checkSourcesChange: 変更なしは ok（0件）", () => {
  const r = checkSourcesChange(base(), base());
  assert.deepEqual([r.ok, r.tierChanges, r.enabledChanges], [true, 0, 0]);
});

test("checkSourcesChange: idの追加・削除は拒否", () => {
  const added = [...base(), mk("z")];
  assert.equal(checkSourcesChange(base(), added).ok, false);
  const removed = base().slice(1);
  assert.equal(checkSourcesChange(base(), removed).ok, false);
});

test("checkSourcesChange: kind/locator/lang/region の変更は拒否（オーナー判断）", () => {
  for (const [k, v] of [["kind", "x_query"], ["locator", "https://evil.example/"], ["lang", "ja"], ["region", "日本"]]) {
    const next = base();
    next[0] = { ...next[0], [k]: v };
    const r = checkSourcesChange(base(), next);
    assert.equal(r.ok, false, k);
    assert.ok(r.errors.some((e) => e.includes(k)), `${k}: ${r.errors.join(" / ")}`);
  }
});

test("checkSourcesChange: hitDensity/note の変更も tuneup 範囲外として拒否", () => {
  const next = base();
  next[0].hitDensity = 0.5;
  assert.equal(checkSourcesChange(base(), next).ok, false);
  const next2 = base();
  next2[0].note = "changed";
  assert.equal(checkSourcesChange(base(), next2).ok, false);
});

test("checkSourcesChange: 変更量上限（tier5件・enabled5件）を超えたら拒否、ちょうどは ok", () => {
  assert.equal(GUARDRAIL_LIMITS.sourceTierChangesMax, 5);
  assert.equal(GUARDRAIL_LIMITS.sourceEnabledChangesMax, 5);
  const five = base();
  for (let i = 0; i < 5; i++) {
    five[i].tier = 1;
    five[i].enabled = true;
  }
  assert.equal(checkSourcesChange(base(), five).ok, true);
  const six = base();
  for (let i = 0; i < 6; i++) six[i].tier = 1;
  const r6 = checkSourcesChange(base(), six);
  assert.equal(r6.ok, false);
  assert.equal(r6.tierChanges, 6);
  const sixE = base();
  for (let i = 0; i < 6; i++) sixE[i].enabled = true;
  assert.equal(checkSourcesChange(base(), sixE).ok, false);
});

test("checkSourcesChange: 新レジストリがスキーマ違反（tier範囲外）なら拒否・非配列も拒否", () => {
  const next = base();
  next[0].tier = 9;
  assert.equal(checkSourcesChange(base(), next).ok, false);
  assert.equal(checkSourcesChange(base(), null).ok, false);
});

test("validateResearchTuning: roundFoci は sources か sourceRefs のどちらかがあればよい（互換）", () => {
  const lanes = [1, 2, 3].map((i) => ({ label: `L${i}`, sources: `S${i}` }));
  const foci = (over) => [1, 2, 3].map((i) => ({ label: `R${i}`, diversity: `D${i}`, ...over(i) }));
  const t = (roundFoci) => ({ tech: { lanes }, cc: { roundFoci } });
  assert.equal(validateResearchTuning(t(foci((i) => ({ sources: `S${i}` })))).ok, true, "sourcesのみ");
  assert.equal(validateResearchTuning(t(foci((i) => ({ sources: `S${i}`, sourceRefs: ["a"] })))).ok, true, "両方");
  assert.equal(validateResearchTuning(t(foci(() => ({ sourceRefs: ["a"] })))).ok, true, "sourceRefsのみ");
  assert.equal(validateResearchTuning(t(foci(() => ({})))).ok, false, "どちらも無い");
  assert.equal(validateResearchTuning(t(foci((i) => ({ sources: `S${i}`, sourceRefs: "a" })))).ok, false, "sourceRefsが配列でない");
  assert.equal(validateResearchTuning(t(foci((i) => ({ sources: `S${i}`, sourceRefs: [""] })))).ok, false, "sourceRefsに空文字");
});

test("computeSourceGateStats: Radar事例のみを 情報源別・基準別 に集計し、gateフィールド無しは unknown", () => {
  const cases = [
    { id: "r1", sources: ["Radar"], gateCriterion: "A", sourceId: "itsnicethat" },
    { id: "r2", sources: ["Radar"], gateCriterion: "A", sourceId: "itsnicethat" },
    { id: "r3", sources: ["Radar"], gateCriterion: "B", sourceId: "bpando" },
    { id: "r4", sources: ["Radar"] }, // 旧エントリ
    { id: "r5", sources: ["Radar"], gateCriterion: "", sourceId: "" },
    { id: "u1", sources: ["User"], gateCriterion: "", sourceId: "" }, // Radar外は対象外
    { id: "c1", sources: ["Cannes"] },
  ];
  const s = computeSourceGateStats({ favIds: ["r1", "r3", "r4", "u1"], trashedIds: ["r2", "r5"], cases });
  assert.equal(s.radarCaseCount, 5);
  assert.deepEqual(s.bySource.itsnicethat, { count: 2, fav: 1, trashed: 1, favRate: 0.5 });
  assert.deepEqual(s.bySource.bpando, { count: 1, fav: 1, trashed: 0, favRate: 1 });
  assert.deepEqual(s.bySource.unknown, { count: 2, fav: 1, trashed: 1, favRate: 0.5 });
  assert.deepEqual(s.byCriterion.A, { count: 2, fav: 1, trashed: 1, favRate: 0.5 });
  assert.deepEqual(s.byCriterion.B, { count: 1, fav: 1, trashed: 0, favRate: 1 });
  assert.deepEqual(s.byCriterion.unknown, { count: 2, fav: 1, trashed: 1, favRate: 0.5 });
  assert.equal(s.byCriterion.C, undefined);
});

test("computeSourceGateStats: 空入力・undefinedでも落ちない", () => {
  const s = computeSourceGateStats({ favIds: undefined, trashedIds: undefined, cases: [] });
  assert.equal(s.radarCaseCount, 0);
  assert.deepEqual(s.bySource, {});
  assert.deepEqual(s.byCriterion, {});
});
