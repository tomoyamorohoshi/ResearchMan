// scripts/lib/tuneup-guardrails.mjs の単体検証（TDD: 実装前にこのテストを書き、失敗を確認してから実装した）。
// biweekly-tuneup.mjs が受け取るLLM出力（research-tuning.json/idea-tuning.json改訂案）を
// 機械的にスキーマ検証・変更量上限チェックする。実装計画バッチ2bのガードレール要件:
//   スキーマ: 型・必須キー・レーン数3〜6・クエリ数≤6・重み0.25〜4.0・混合比合計=1
//   変更量上限: レーン差替え≤2・クエリ差替え≤3・重み変更≤10項目
// 実行: node scripts/smoke-tuneup-guardrails.mjs
import {
  validateResearchTuning,
  validateIdeaTuning,
  validateXRadarQueries,
  countLaneChanges,
  countQueryChanges,
  countWeightChanges,
} from "./lib/tuneup-guardrails.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

const validResearchTuning = {
  tech: {
    lanes: [
      { label: "L1", sources: "S1" },
      { label: "L2", sources: "S2" },
      { label: "L3", sources: "S3" },
      { label: "L4", sources: "S4" },
    ],
  },
  cc: {
    roundFoci: [
      { label: "R1", sources: "S1", diversity: "D1" },
      { label: "R2", sources: "S2", diversity: "D2" },
      { label: "R3", sources: "S3", diversity: "D3" },
    ],
  },
};

const validIdeaTuning = {
  seedCount: 10,
  caseSample: 14,
  techSample: 12,
  patternMix: { contextXTech: 0.4, techXTech: 0.2, repurpose: 0.2, free: 0.2 },
  samplingWeights: { caseTags: { "Tech/AI": 1.5 }, techDomains: {} },
  promptText: {
    roleIntro: "intro {seedCount}",
    patternDefinitions: { techXTech: "a", contextXTech: "b", repurpose: "c" },
    styleNotes: "notes",
  },
};

// ── validateResearchTuning: 正常系 ──
{
  const r = validateResearchTuning(validResearchTuning);
  assert(r.ok === true, `正常な research-tuning 候補は受理される (${JSON.stringify(r.errors)})`);
}

// ── validateResearchTuning: レーン数が範囲外(2件・7件) ──
{
  const tooFew = { ...validResearchTuning, tech: { lanes: validResearchTuning.tech.lanes.slice(0, 2) } };
  const r = validateResearchTuning(tooFew);
  assert(r.ok === false, "tech.lanesが2件(下限3未満)は拒否される");
}
{
  const tooMany = {
    ...validResearchTuning,
    tech: { lanes: Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, sources: `S${i}` })) },
  };
  const r = validateResearchTuning(tooMany);
  assert(r.ok === false, "tech.lanesが7件(上限6超)は拒否される");
}

// ── validateResearchTuning: 必須キー欠落・型不正 ──
{
  const missingSources = {
    ...validResearchTuning,
    tech: { lanes: [{ label: "L1" }, ...validResearchTuning.tech.lanes.slice(1)] },
  };
  const r = validateResearchTuning(missingSources);
  assert(r.ok === false, "レーンのsources欠落は拒否される");
}
{
  const wrongType = { ...validResearchTuning, cc: { roundFoci: "not-an-array" } };
  const r = validateResearchTuning(wrongType);
  assert(r.ok === false, "roundFociが配列でないと拒否される");
}

// ── validateXRadarQueries: クエリ数上限 ──
{
  const ok = validateXRadarQueries(["q1", "q2", "q3"]);
  assert(ok.ok === true, "クエリ3件は受理される");
  const tooMany = validateXRadarQueries(["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
  assert(tooMany.ok === false, "クエリ7件(上限6超)は拒否される");
  const empty = validateXRadarQueries([]);
  assert(empty.ok === false, "クエリ0件は拒否される");
}

// ── validateIdeaTuning: 正常系 ──
{
  const r = validateIdeaTuning(validIdeaTuning);
  assert(r.ok === true, `正常な idea-tuning 候補は受理される (${JSON.stringify(r.errors)})`);
}

// ── validateIdeaTuning: 混合比合計が1でない ──
{
  const badMix = { ...validIdeaTuning, patternMix: { contextXTech: 0.5, techXTech: 0.2, repurpose: 0.2, free: 0.2 } };
  const r = validateIdeaTuning(badMix);
  assert(r.ok === false, "patternMixの合計が1.1で拒否される");
}

// ── validateIdeaTuning: 重みが範囲外(0.25〜4.0) ──
{
  const badWeight = { ...validIdeaTuning, samplingWeights: { caseTags: { "Tech/AI": 5.0 }, techDomains: {} } };
  const r = validateIdeaTuning(badWeight);
  assert(r.ok === false, "重み5.0(上限4.0超)は拒否される");
}
{
  const badWeight = { ...validIdeaTuning, samplingWeights: { caseTags: { "Tech/AI": 0.1 }, techDomains: {} } };
  const r = validateIdeaTuning(badWeight);
  assert(r.ok === false, "重み0.1(下限0.25未満)は拒否される");
}

// ── 変更量上限: レーン差替え≤2 ──
{
  const oldLanes = validResearchTuning.tech.lanes;
  const newLanes3replaced = oldLanes.map((l, i) => (i < 3 ? { ...l, sources: "CHANGED" } : l));
  assert(
    countLaneChanges(oldLanes, newLanes3replaced) === 3,
    `3件差替えでchanged=3を検出 (got ${countLaneChanges(oldLanes, newLanes3replaced)})`
  );
  const newLanes1replaced = oldLanes.map((l, i) => (i === 0 ? { ...l, sources: "CHANGED" } : l));
  assert(
    countLaneChanges(oldLanes, newLanes1replaced) === 1,
    `1件差替えでchanged=1を検出 (got ${countLaneChanges(oldLanes, newLanes1replaced)})`
  );
}

// ── 変更量上限: クエリ差替え≤3 ──
{
  const oldQ = ["q1", "q2", "q3", "q4", "q5", "q6"];
  const newQ4 = ["q1changed", "q2changed", "q3changed", "q4changed", "q5", "q6"];
  assert(countQueryChanges(oldQ, newQ4) === 4, `4件差替えでchanged=4を検出 (got ${countQueryChanges(oldQ, newQ4)})`);
}

// ── 変更量上限: 重み変更≤10項目 ──
{
  const oldW = { caseTags: { a: 1, b: 1 }, techDomains: {} };
  const newW = { caseTags: { a: 2, b: 1, c: 1.5 }, techDomains: {} }; // a変更 + c新規 = 2件
  assert(countWeightChanges(oldW, newW) === 2, `重み変更2件を検出 (got ${countWeightChanges(oldW, newW)})`);
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: tuneup-guardrails");
}
