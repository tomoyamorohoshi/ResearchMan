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
  for (const s of ["gateTier別", "レンズ別", "却下ログ", "基準A", "巡回先", "sourceChanges", "gateCriterionProposal"]) assert.ok(p.includes(s), s);
});

test("具体例の why: 例に要約を添え、側ごとの why を litmusWhy で書かせる。有効化(false→true)は禁止と明記", () => {
  const input = v3();
  input.tierStats.borderlineFav[0] = { title: "favX", link: "", summary: "S".repeat(300) };
  const p = buildPass1Prompt({ ...base(), v3Input: input });
  assert.match(p, /litmusWhy/);
  assert.match(p, /採用側.*基準|どの基準/);
  assert.match(p, /不採用側|届かない/);
  assert.match(p, /enabled は true→false のみ|有効化.*しない/);
  assert.ok(!p.includes("S".repeat(100)), "要約は短く切って渡す");
  assert.ok(p.includes("S".repeat(V3_PROMPT_LIMITS.summaryMax)));
});

test("直近の却下・置き換え済みの案を渡し、再提案を避けるよう指示する（件数上限あり）", () => {
  const recent = many(9, (i) => ({ id: `G${i}`, status: i % 2 ? "rejected" : "superseded", criterionId: "B", after: `案${i}-` + "z".repeat(500), reason: "r" }));
  const p = buildPass1Prompt({ ...base(), v3Input: v3({ recentProposals: recent }) });
  assert.match(p, /再提案/);
  assert.ok(p.includes("案0-"));
  assert.ok(!p.includes(`案${V3_PROMPT_LIMITS.recentProposals}-`));
  assert.ok(!p.includes("z".repeat(V3_PROMPT_LIMITS.proposalTextMax + 50)));
});

test("case-gate.json が読めない(gateAvailable=false)ときは基準・案・why の節と出力欄を出さない", () => {
  const p = buildPass1Prompt({ ...base(), v3Input: v3({ gateAvailable: false, criteria: null }) });
  assert.ok(!p.includes("gateCriterionProposal"));
  assert.ok(!p.includes("litmusWhy"));
  assert.match(p, /sourceChanges/);
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
