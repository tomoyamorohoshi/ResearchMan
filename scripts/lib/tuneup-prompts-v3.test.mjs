// tuneup-prompts.mjs の v3 追加分のテスト（node:test）。
// 実行: node --test scripts/lib/tuneup-prompts-v3.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPass1Prompt, buildV3Section, V3_PROMPT_LIMITS } from "./tuneup-prompts.mjs";

const base = () => ({
  favStats: { favoriteCaseCount: 1, favoriteTechCount: 0, totalCaseCount: 2, totalTechCount: 0, caseTagDistributionAll: {}, caseTagDistributionFav: {}, techDomainDistributionAll: {}, techDomainDistributionFav: {}, caseSourcesDistributionFav: {}, techTypeDistributionFav: {}, favoriteCases: [], favoriteTech: [] },
  trashStats: { trashedCaseCount: 0, totalCaseCount: 2, caseTagDistributionTrashed: {}, caseCategoryDistributionTrashed: {}, caseSourcesDistributionTrashed: {}, trashedCases: [] },
  userCaseStats: { userCaseCount: 0 },
  oldResearchTuning: { tech: { lanes: [] }, cc: { roundFoci: [] } },
  oldXRadarQueries: ["q"],
  oldResearchPlan: "plan",
});
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const v3 = (o = {}) => ({
  tierStats: { byTier: { accept: { count: 1 }, borderline: { count: 2 }, legacy: { count: 3 } }, borderlineFav: many(50, (i) => ({ title: `fav${i}`, link: `https://a/${i}` })), borderlineTrashed: many(50, (i) => ({ title: `trash${i}`, link: "" })) },
  lensStats: { byLens: { 1: { count: 1, fav: 0, trashed: 0 } }, untagged: 5 },
  rejectionSummary: { windowDays: 7, total: 99, byReason: [{ reason: "r", count: 9 }], byPipeline: { cc: 99 }, samples: many(40, (i) => ({ title: `rej${i}`, reason: "r" })) },
  criteria: [{ id: "A", text: "基準A" }],
  litmusChanges: [{ side: "accept", action: "add", added: { title: "新例" }, removed: null }],
  sourcesSummary: many(200, (i) => ({ id: `src${i}`, tier: 1, enabled: true, lang: "en", region: "x", count: 1, fav: 0, trashed: 0 })),
  ...o,
});

test("v3Input なしなら v3 セクション・出力フィールドは出ない(後方互換)", () => {
  const p = buildPass1Prompt(base());
  assert.ok(!p.includes("gateCriterionProposal"));
  assert.ok(!p.includes("sourceChanges"));
  assert.equal(buildV3Section(null), "");
});

test("v3Input ありなら gateTier・レンズ・却下ログ・基準・巡回先と出力フィールドが入る", () => {
  const p = buildPass1Prompt({ ...base(), v3Input: v3() });
  for (const s of ["gateTier別", "レンズ別", "却下ログ", "基準A", "巡回先", "sourceChanges", "gateCriterionProposal", "新例"]) assert.ok(p.includes(s), s);
});

test("4レンズ固定の指示があり、roundFoci に「3〜6件」とは書かない", () => {
  const p = buildPass1Prompt({ ...base(), v3Input: v3() });
  assert.match(p, /4レンズ固定/);
  assert.ok(!/roundFoci[^\n]*3〜6/.test(p));
  assert.match(p, /tech\.lanes は件数3〜6件/);
});

test("プロンプト肥大防止: borderline例・却下サンプル・巡回先行数に上限がある", () => {
  const p = buildPass1Prompt({ ...base(), v3Input: v3() });
  assert.ok(p.includes(`fav${V3_PROMPT_LIMITS.borderlineExamples - 1}"`));
  assert.ok(!p.includes(`fav${V3_PROMPT_LIMITS.borderlineExamples}"`));
  assert.ok(!p.includes(`rej${V3_PROMPT_LIMITS.rejectionSamples}"`));
  assert.ok(p.includes(`src${V3_PROMPT_LIMITS.sourcesLines - 1}\t`));
  assert.ok(!p.includes(`src${V3_PROMPT_LIMITS.sourcesLines}\t`));
  assert.ok(p.length < 20000, `prompt length ${p.length}`);
});
