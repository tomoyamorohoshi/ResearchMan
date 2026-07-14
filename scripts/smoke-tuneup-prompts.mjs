// scripts/lib/tuneup-prompts.mjs の単体検証（TDD: 実装前にこのテストを書き、失敗を確認してから実装した）。
// biweekly-tuneup.mjsのmain()は即時実行スクリプトのため単体テストできない
// （OPERATIONS.md「main()を即実行するスクリプトをimportしない」参照）。分析パス1のプロンプト組み立て
// （ごみ箱=弱化シグナル・ユーザー追加事例=強化シグナルが正しく文字列に含まれるか、
// ユーザー追加事例0件時にセクションが省略されるか）を、実ファイルI/O・実Claude CLI呼び出しなしに
// 純関数として検証する。
// 実行: node scripts/smoke-tuneup-prompts.mjs
import { buildPass1Prompt } from "./lib/tuneup-prompts.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

const favStats = {
  favoriteCaseCount: 1,
  totalCaseCount: 2,
  favoriteTechCount: 1,
  totalTechCount: 2,
  caseTagDistributionAll: { "Tech/AI": 1 },
  caseTagDistributionFav: { "Tech/AI": 1 },
  techDomainDistributionAll: {},
  techDomainDistributionFav: {},
  caseSourcesDistributionFav: {},
  techTypeDistributionFav: {},
  favoriteCases: [],
  favoriteTech: [],
};

const oldResearchTuning = { tech: { lanes: [] }, cc: { roundFoci: [] } };
const oldXRadarQueries = ["q1"];
const oldResearchPlan = "# 現行プラン";

// ── ごみ箱（弱化シグナル）セクションは常に含まれる ──
{
  const trashStats = {
    trashedCaseCount: 3,
    totalCaseCount: 10,
    caseTagDistributionTrashed: { "Tech/XR": 3 },
    caseCategoryDistributionTrashed: { "体験": 3 },
    caseSourcesDistributionTrashed: { Award: 3 },
    trashedCases: [{ id: "c2", title: "Case2", tags: ["Tech/XR"], categories: ["体験"], year: "2025" }],
  };
  const userCaseStats = { userCaseCount: 0, caseTagDistributionUser: {}, caseCategoryDistributionUser: {}, userCases: [] };

  const prompt = buildPass1Prompt({ favStats, trashStats, userCaseStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan });

  assert(prompt.includes("ごみ箱"), "プロンプトにごみ箱セクションの見出しが含まれる");
  assert(prompt.includes("弱化シグナル"), "プロンプトに弱化シグナルという語が含まれる");
  assert(prompt.includes('"Tech/XR":3'), `ごみ箱タグ分布がプロンプトに含まれる (has: ${prompt.includes('"Tech/XR":3')})`);
  assert(prompt.includes("体験"), "ごみ箱カテゴリ分布がプロンプトに含まれる");
}

// ── ユーザー追加事例0件のときはセクションを省略する ──
{
  const trashStats = { trashedCaseCount: 0, totalCaseCount: 10, caseTagDistributionTrashed: {}, caseCategoryDistributionTrashed: {}, caseSourcesDistributionTrashed: {}, trashedCases: [] };
  const userCaseStats = { userCaseCount: 0, caseTagDistributionUser: {}, caseCategoryDistributionUser: {}, userCases: [] };

  const prompt = buildPass1Prompt({ favStats, trashStats, userCaseStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan });

  assert(!prompt.includes("ユーザー追加事例"), "ユーザー追加事例0件のとき、そのセクション見出しが含まれない");
  assert(!prompt.includes("強化シグナル"), "ユーザー追加事例0件のとき、強化シグナルという語が含まれない");
}

// ── ユーザー追加事例が1件以上あるときはセクションが含まれる ──
{
  const trashStats = { trashedCaseCount: 0, totalCaseCount: 10, caseTagDistributionTrashed: {}, caseCategoryDistributionTrashed: {}, caseSourcesDistributionTrashed: {}, trashedCases: [] };
  const userCaseStats = {
    userCaseCount: 2,
    caseTagDistributionUser: { "Tech/AI": 2 },
    caseCategoryDistributionUser: { "AIクリエイティブ": 2 },
    userCases: [{ id: "u1", title: "User1", tags: ["Tech/AI"], categories: ["AIクリエイティブ"], year: "2026" }],
  };

  const prompt = buildPass1Prompt({ favStats, trashStats, userCaseStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan });

  assert(prompt.includes("ユーザー追加事例"), "ユーザー追加事例が1件以上あればセクション見出しが含まれる");
  assert(prompt.includes("強化シグナル"), "ユーザー追加事例が1件以上あれば強化シグナルという語が含まれる");
  assert(prompt.includes('"Tech/AI":2'), "ユーザー追加事例のタグ分布がプロンプトに含まれる");
}

// ── 出力フォーマット（JSON1つのみ要求）は既存のまま壊れていない ──
{
  const trashStats = { trashedCaseCount: 0, totalCaseCount: 10, caseTagDistributionTrashed: {}, caseCategoryDistributionTrashed: {}, caseSourcesDistributionTrashed: {}, trashedCases: [] };
  const userCaseStats = { userCaseCount: 0, caseTagDistributionUser: {}, caseCategoryDistributionUser: {}, userCases: [] };
  const prompt = buildPass1Prompt({ favStats, trashStats, userCaseStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan });
  assert(prompt.includes('"researchTuning"'), "出力フォーマットにresearchTuningキーの指示が含まれる");
  assert(prompt.includes('"rationale"'), "出力フォーマットにrationaleキーの指示が含まれる");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: tuneup-prompts");
}
