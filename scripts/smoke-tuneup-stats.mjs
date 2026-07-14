// scripts/lib/tuneup-stats.mjs の単体検証。
// 実行: node scripts/smoke-tuneup-stats.mjs
import {
  favoriteIds,
  computeFavoriteStats,
  computeIdeaStructureStats,
  computeTrashStats,
  computeUserCaseStats,
  deriveTrashEndpoint,
} from "./lib/tuneup-stats.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// ── favoriteIds ──
{
  const items = { a: { fav: true, ts: 1 }, b: { fav: false, ts: 2 }, c: { fav: true, ts: 3 } };
  const ids = favoriteIds(items);
  assert(JSON.stringify(ids.sort()) === JSON.stringify(["a", "c"]), `fav:trueのみ抽出 (${JSON.stringify(ids)})`);
  assert(JSON.stringify(favoriteIds(undefined)) === "[]", "itemsがundefinedでも空配列");
  assert(JSON.stringify(favoriteIds({})) === "[]", "itemsが空でも空配列");
}

// ── computeFavoriteStats ──
{
  const cases = [
    { id: "c1", title: "Case1", tags: ["Tech/AI", "Form/Product"], sources: ["Radar"], year: "2026" },
    { id: "c2", title: "Case2", tags: ["Tech/XR"], sources: ["Award"], year: "2025" },
  ];
  const tech = [
    { id: "t1", title: "Tech1", domains: ["CreatorTools"], type: "Tool" },
    { id: "t2", title: "Tech2", domains: ["Spatial/3D", "AI/Agents"], type: "Research" },
  ];
  const favIds = ["c1", "t1"];
  const stats = computeFavoriteStats({ favIds, cases, tech });
  assert(stats.favoriteCaseCount === 1, "お気に入り事例数=1");
  assert(stats.favoriteTechCount === 1, "お気に入り技術数=1");
  assert(stats.totalCaseCount === 2, "全事例数=2");
  assert(stats.caseTagDistributionAll["Tech/AI"] === 1, "全体タグ分布にTech/AIが1件");
  assert(stats.caseTagDistributionFav["Tech/AI"] === 1, "お気に入りタグ分布にTech/AIが1件");
  assert(stats.caseTagDistributionFav["Tech/XR"] === undefined, "お気に入りタグ分布にTech/XRは無い(c2は非fav)");
  assert(stats.techDomainDistributionFav["CreatorTools"] === 1, "お気に入りdomain分布にCreatorToolsが1件");
  assert(stats.favoriteCases[0].id === "c1", "favoriteCasesにc1が含まれる");
}

// ── computeIdeaStructureStats ──
{
  const ideas = [
    { pattern: "文脈×技術", refs: [{ type: "case", id: "c1" }, { type: "tech", id: "t1" }] },
    { pattern: "文脈×技術", refs: [{ type: "tech", id: "t1" }] },
    { pattern: "技術×技術", refs: [{ type: "tech", id: "t1" }, { type: "tech", id: "t2" }] },
    { pattern: null, refs: [] },
  ];
  const stats = computeIdeaStructureStats(ideas);
  assert(stats.totalIdeas === 4, "総アイデア数=4");
  assert(stats.patternCounts["文脈×技術"] === 2, "文脈×技術パターン数=2");
  assert(stats.patternCounts["技術×技術"] === 1, "技術×技術パターン数=1");
  assert(stats.uniqueRefsUsed === 3, "ユニークref数=3(c1,t1,t2)");
  const t1 = stats.overusedRefs.find((r) => r.ref === "tech:t1");
  assert(t1 && t1.count === 3, `tech:t1が3回参照(overused)として検出 (${JSON.stringify(stats.overusedRefs)})`);
}

// ── computeTrashStats（ごみ箱＝弱化シグナル） ──
{
  const cases = [
    { id: "c1", title: "Case1", tags: ["Tech/AI", "Form/Product"], categories: ["AIクリエイティブ"], sources: ["Radar"], year: "2026" },
    { id: "c2", title: "Case2", tags: ["Tech/XR"], categories: ["体験"], sources: ["Award"], year: "2025" },
    { id: "c3", title: "Case3", tags: ["Tech/AI"], categories: ["AIクリエイティブ"], sources: ["Order"], year: "2025" },
  ];
  const trashedIds = ["c2"];
  const stats = computeTrashStats({ trashedIds, cases });
  assert(stats.trashedCaseCount === 1, `ごみ箱事例数=1 (got ${stats.trashedCaseCount})`);
  assert(stats.totalCaseCount === 3, "全事例数=3");
  assert(stats.caseTagDistributionTrashed["Tech/XR"] === 1, "ごみ箱タグ分布にTech/XRが1件");
  assert(stats.caseTagDistributionTrashed["Tech/AI"] === undefined, "ごみ箱タグ分布にTech/AIは無い(c1,c3は非trash)");
  assert(stats.caseCategoryDistributionTrashed["体験"] === 1, "ごみ箱カテゴリ分布に体験が1件");
  assert(stats.caseSourcesDistributionTrashed["Award"] === 1, "ごみ箱sources分布にAwardが1件");
  assert(stats.trashedCases[0].id === "c2", "trashedCasesにc2が含まれる");

  const empty = computeTrashStats({ trashedIds: [], cases });
  assert(empty.trashedCaseCount === 0, "trashedIdsが空なら0件");
  assert(Object.keys(empty.caseTagDistributionTrashed).length === 0, "trashedIdsが空ならタグ分布も空");
}

// ── computeUserCaseStats（ユーザー追加事例＝強化シグナル） ──
{
  const cases = [
    { id: "c1", title: "Case1", tags: ["Tech/AI"], categories: ["AIクリエイティブ"], sources: ["Radar"], year: "2026" },
    { id: "c2", title: "Case2", tags: ["Tech/XR"], categories: ["体験"], sources: ["User"], year: "2025" },
    { id: "c3", title: "Case3", tags: ["Tech/XR", "Form/Product"], categories: ["体験"], sources: ["User", "Radar"], year: "2025" },
  ];
  const stats = computeUserCaseStats({ cases });
  assert(stats.userCaseCount === 2, `ユーザー追加事例数=2 (got ${stats.userCaseCount})`);
  assert(stats.caseTagDistributionUser["Tech/XR"] === 2, "ユーザー事例タグ分布にTech/XRが2件");
  assert(stats.caseTagDistributionUser["Tech/AI"] === undefined, "ユーザー事例タグ分布にTech/AIは無い(c1は非User)");
  assert(stats.caseCategoryDistributionUser["体験"] === 2, "ユーザー事例カテゴリ分布に体験が2件");
  assert(stats.userCases.map((c) => c.id).sort().join(",") === "c2,c3", "userCasesにc2,c3が含まれる");

  const none = computeUserCaseStats({ cases: [cases[0]] });
  assert(none.userCaseCount === 0, "User事例が無ければ0件");
}

// ── deriveTrashEndpoint（favoritesエンドポイントからtrashエンドポイントを導出） ──
{
  const derived = deriveTrashEndpoint("https://research-man.vercel.app/api/favorites", null);
  assert(derived === "https://research-man.vercel.app/api/trash", `favoritesエンドポイントからtrashを導出 (got ${derived})`);

  const overridden = deriveTrashEndpoint("https://research-man.vercel.app/api/favorites", "https://example.com/custom-trash");
  assert(overridden === "https://example.com/custom-trash", "trashEndpointの明示指定はそちらを優先する");

  const trailingSlash = deriveTrashEndpoint("https://research-man.vercel.app/api/favorites/", null);
  assert(trailingSlash === "https://research-man.vercel.app/api/trash/", `末尾スラッシュも保持して導出 (got ${trailingSlash})`);

  // 非標準URL（/api/favoritesで終わらない）は置換が不発になり得るため、導出失敗としてnullを返すべき
  // （favoritesのレスポンスをtrashとして誤集計してしまうバグの回帰防止）。
  const nonStandard = deriveTrashEndpoint("https://research-man.vercel.app/api/favorites-legacy", null);
  assert(nonStandard === null, `非標準URLは導出失敗でnullを返す (got ${nonStandard})`);

  const noMatchAtAll = deriveTrashEndpoint("https://example.com/completely/different/path", null);
  assert(noMatchAtAll === null, `/api/favoritesを含まないURLもnullを返す (got ${noMatchAtAll})`);

  // 明示overrideがあれば非標準URLでも常にoverrideを優先する
  const nonStandardOverridden = deriveTrashEndpoint("https://research-man.vercel.app/api/favorites-legacy", "https://example.com/custom-trash");
  assert(nonStandardOverridden === "https://example.com/custom-trash", "非標準URLでもoverride指定時はそちらを優先する");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: tuneup-stats");
}
