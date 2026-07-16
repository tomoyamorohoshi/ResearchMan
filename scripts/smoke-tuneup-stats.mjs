// scripts/lib/tuneup-stats.mjs の単体検証。
// 実行: node scripts/smoke-tuneup-stats.mjs
import {
  favoriteIds,
  computeFavoriteStats,
  computeIdeaStructureStats,
  computeTrashStats,
  computeUserCaseStats,
  computeIdeaFeedbackStats,
  deriveTrashEndpoint,
  deriveIdeaLikesEndpoint,
  deriveIdeaTrashEndpoint,
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

// ── computeIdeaFeedbackStats（アイデア評価シグナル: いいね=強化・ゴミ箱=弱化） ──
{
  const cases = [
    { id: "c1", tags: ["Tech/AI", "Form/Product"] },
    { id: "c2", tags: ["Tech/XR"] },
  ];
  const tech = [{ id: "t1", domains: ["CreatorTools"] }];
  const ideas = [
    { id: "i1", pattern: "文脈×技術", refs: [{ type: "case", id: "c1" }, { type: "tech", id: "t1" }] },
    { id: "i2", pattern: "文脈×技術", refs: [{ type: "case", id: "c2" }] },
    { id: "i3", pattern: "転用", refs: [{ type: "case", id: "c1" }] },
    { id: "i4", pattern: "転用", refs: [] },
  ];

  // 基本のパターン/参照先タグ分布
  {
    const stats = computeIdeaFeedbackStats({ likedIds: ["i1", "i3"], trashedIds: ["i2"], ideas, cases, tech });
    assert(stats.likedIdeaCount === 2, `いいね数=2 (got ${stats.likedIdeaCount})`);
    assert(stats.trashedIdeaCount === 1, `ゴミ箱数=1 (got ${stats.trashedIdeaCount})`);
    assert(stats.patternLikeCounts["文脈×技術"] === 1, "いいねパターン分布に文脈×技術が1件(i1)");
    assert(stats.patternLikeCounts["転用"] === 1, "いいねパターン分布に転用が1件(i3)");
    assert(stats.patternTrashCounts["文脈×技術"] === 1, "ゴミ箱パターン分布に文脈×技術が1件(i2)");
    // i1・i3ともc1を参照しているため、Tech/AIは2回加算される(i1経由+i3経由)
    assert(stats.refTagLikeCounts["Tech/AI"] === 2, `いいね参照先タグ分布にTech/AIが2件(i1,i3→c1経由) (got ${stats.refTagLikeCounts["Tech/AI"]})`);
    assert(stats.refTagLikeCounts["CreatorTools"] === 1, "いいね参照先domain分布にCreatorToolsが1件(i1→t1経由)");
    assert(stats.refTagTrashCounts["Tech/XR"] === 1, "ゴミ箱参照先タグ分布にTech/XRが1件(i2→c2経由)");
    assert(stats.scoredIdeaCount === 0, "scoresを持つideaが無ければscoredIdeaCount=0");
    assert(stats.scoreCorrelations === null, "scoresが無ければscoreCorrelationsはnull");
  }

  // scoresがある場合の相関（いいねしたideaほどdiscoveryが高い→正の相関になるはず）
  {
    const scoredIdeas = [
      { id: "s1", pattern: "転用", refs: [], scores: { discovery: 9, surprise: 5, conviction: 5 } },
      { id: "s2", pattern: "転用", refs: [], scores: { discovery: 8, surprise: 5, conviction: 5 } },
      { id: "s3", pattern: "転用", refs: [], scores: { discovery: 2, surprise: 5, conviction: 5 } },
      { id: "s4", pattern: "転用", refs: [], scores: { discovery: 1, surprise: 5, conviction: 5 } },
    ];
    const stats = computeIdeaFeedbackStats({ likedIds: ["s1", "s2"], trashedIds: ["s3", "s4"], ideas: scoredIdeas, cases: [], tech: [] });
    assert(stats.scoredIdeaCount === 4, `scoredIdeaCount=4 (got ${stats.scoredIdeaCount})`);
    assert(stats.scoreCorrelations !== null, "scoresが2件以上あれば相関を計算する");
    assert(
      stats.scoreCorrelations.discovery.withLiked > 0.9,
      `いいね済みほどdiscoveryが高いので強い正の相関になる (got ${stats.scoreCorrelations.discovery.withLiked})`
    );
    assert(
      stats.scoreCorrelations.discovery.withTrashed < -0.9,
      `ゴミ箱ほどdiscoveryが低いので強い負の相関になる (got ${stats.scoreCorrelations.discovery.withTrashed})`
    );
    // surprise/convictionは全件同値(分散0)なので相関は判定不能(null)
    assert(stats.scoreCorrelations.surprise.withLiked === null, "分散0の次元は相関null(NaN回避)");
  }

  // scoresが1件しか無い場合は相関計算をしない(nullのまま)
  {
    const oneScored = [{ id: "o1", pattern: null, refs: [], scores: { discovery: 5, surprise: 5, conviction: 5 } }];
    const stats = computeIdeaFeedbackStats({ likedIds: [], trashedIds: [], ideas: oneScored, cases: [], tech: [] });
    assert(stats.scoreCorrelations === null, "scoresが1件のみなら相関はnull(データ不足)");
  }

  // scores[dim]に非数値(undefined等)が混じっても、その次元の相関がNaNに汚染されない(修正2の回帰防止)。
  // 有効な(数値の)ペアが3件残るので、それらだけで相関が計算されるはず(NaNでもnullでもない)。
  {
    const mixedIdeas = [
      { id: "n1", pattern: null, refs: [], scores: { discovery: 9, surprise: 5, conviction: 5 } },
      { id: "n2", pattern: null, refs: [], scores: { discovery: 8, surprise: 5, conviction: 5 } },
      { id: "n3", pattern: null, refs: [], scores: { discovery: 2, surprise: 5, conviction: 5 } },
      { id: "n4", pattern: null, refs: [], scores: { discovery: undefined, surprise: 5, conviction: 5 } }, // 非数値混入
    ];
    const stats = computeIdeaFeedbackStats({ likedIds: ["n1", "n2"], trashedIds: ["n3"], ideas: mixedIdeas, cases: [], tech: [] });
    assert(stats.scoredIdeaCount === 4, `scores持ちideaは4件(値の有効性は問わない) (got ${stats.scoredIdeaCount})`);
    assert(
      !Number.isNaN(stats.scoreCorrelations.discovery.withLiked),
      `discoveryに非数値混入のideaがあっても相関はNaNにならない (got ${stats.scoreCorrelations.discovery.withLiked})`
    );
    assert(
      stats.scoreCorrelations.discovery.withLiked !== null,
      "有効ペアが3件(n1,n2,n3)残るので相関はnullにならず計算される"
    );
  }

  // 非数値混入の結果、有効ペアが2件未満に減った場合はnull(データ不足)のまま(既存のn<2判定を変えない)
  {
    const mostlyInvalid = [
      { id: "p1", pattern: null, refs: [], scores: { discovery: 9, surprise: 5, conviction: 5 } },
      { id: "p2", pattern: null, refs: [], scores: { discovery: "N/A", surprise: 5, conviction: 5 } },
      { id: "p3", pattern: null, refs: [], scores: { discovery: undefined, surprise: 5, conviction: 5 } },
    ];
    const stats = computeIdeaFeedbackStats({ likedIds: ["p1"], trashedIds: [], ideas: mostlyInvalid, cases: [], tech: [] });
    assert(
      stats.scoreCorrelations.discovery.withLiked === null,
      `discoveryの有効ペアが1件(p1)のみのため相関はnull (got ${stats.scoreCorrelations.discovery.withLiked})`
    );
  }

  // 空入力でも例外を投げない
  {
    const stats = computeIdeaFeedbackStats({ likedIds: [], trashedIds: [], ideas: [], cases: [], tech: [] });
    assert(stats.likedIdeaCount === 0 && stats.trashedIdeaCount === 0, "空入力でも0件で例外を投げない");
  }
}

// ── deriveIdeaLikesEndpoint / deriveIdeaTrashEndpoint（favoritesエンドポイントからの導出） ──
{
  const likes = deriveIdeaLikesEndpoint("https://research-man.vercel.app/api/favorites", null);
  assert(likes === "https://research-man.vercel.app/api/idea-likes", `favoritesからidea-likesを導出 (got ${likes})`);

  const trash = deriveIdeaTrashEndpoint("https://research-man.vercel.app/api/favorites", null);
  assert(trash === "https://research-man.vercel.app/api/idea-trash", `favoritesからidea-trashを導出 (got ${trash})`);

  const likesOverride = deriveIdeaLikesEndpoint("https://research-man.vercel.app/api/favorites", "https://example.com/custom-likes");
  assert(likesOverride === "https://example.com/custom-likes", "idea-likesの明示指定はそちらを優先する");

  const nonStandard = deriveIdeaLikesEndpoint("https://research-man.vercel.app/api/favorites-legacy", null);
  assert(nonStandard === null, "非標準URLは導出失敗でnullを返す(idea-likes)");

  const nonStandardTrash = deriveIdeaTrashEndpoint("https://research-man.vercel.app/api/favorites-legacy", null);
  assert(nonStandardTrash === null, "非標準URLは導出失敗でnullを返す(idea-trash)");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: tuneup-stats");
}
