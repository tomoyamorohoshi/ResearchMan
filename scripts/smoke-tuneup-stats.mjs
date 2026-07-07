// scripts/lib/tuneup-stats.mjs の単体検証。
// 実行: node scripts/smoke-tuneup-stats.mjs
import { favoriteIds, computeFavoriteStats, computeIdeaStructureStats } from "./lib/tuneup-stats.mjs";

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

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: tuneup-stats");
}
