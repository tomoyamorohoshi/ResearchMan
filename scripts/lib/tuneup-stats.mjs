/**
 * 隔週チューンアップ（scripts/biweekly-tuneup.mjs）の分析パス1/2に渡す統計量の計算。
 * 全て純粋関数（fs非依存）。お気に入りitems・cases.json・tech.json・ideas.jsonを渡して
 * 分布・偏りを機械的に集計し、Claude CLIプロンプトの「入力素材」として使う。
 */

function tally(list, keyExtractor) {
  const counts = {};
  for (const item of list) {
    const keys = keyExtractor(item) || [];
    for (const k of keys) counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

/** お気に入りitems（{id:{fav,ts}}）から fav:true のidだけを抽出する。 */
export function favoriteIds(items) {
  return Object.entries(items || {})
    .filter(([, v]) => v && v.fav === true)
    .map(([id]) => id);
}

/**
 * お気に入り事例・技術の全体分布との比較統計を計算する（分析パス1「リサーチ計画」の入力素材）。
 */
export function computeFavoriteStats({ favIds, cases, tech }) {
  const favSet = new Set(favIds);
  const favCases = cases.filter((c) => favSet.has(c.id));
  const favTech = tech.filter((t) => favSet.has(t.id));

  return {
    favoriteCaseCount: favCases.length,
    favoriteTechCount: favTech.length,
    totalCaseCount: cases.length,
    totalTechCount: tech.length,
    caseTagDistributionAll: tally(cases, (c) => c.tags),
    caseTagDistributionFav: tally(favCases, (c) => c.tags),
    techDomainDistributionAll: tally(tech, (t) => t.domains),
    techDomainDistributionFav: tally(favTech, (t) => t.domains),
    caseSourcesDistributionFav: tally(favCases, (c) => c.sources),
    techTypeDistributionFav: tally(favTech, (t) => (t.type ? [t.type] : [])),
    favoriteCases: favCases.map((c) => ({ id: c.id, title: c.title, tags: c.tags || [], year: c.year })),
    favoriteTech: favTech.map((t) => ({ id: t.id, title: t.title, domains: t.domains || [], type: t.type })),
  };
}

/**
 * data/ideas.json 全蓄積の機械指標（分析パス2「アイデア構造見直し」の入力素材）。
 * パターン分布・ref再利用率（同一事例/技術が何回参照されたか）を集計する。
 */
export function computeIdeaStructureStats(ideas) {
  const patternCounts = tally(ideas, (i) => (i.pattern ? [i.pattern] : []));
  const refCounts = {};
  for (const idea of ideas) {
    for (const ref of idea.refs || []) {
      const key = `${ref.type}:${ref.id}`;
      refCounts[key] = (refCounts[key] || 0) + 1;
    }
  }
  const refFrequency = Object.entries(refCounts).sort((a, b) => b[1] - a[1]);
  return {
    totalIdeas: ideas.length,
    patternCounts,
    uniqueRefsUsed: refFrequency.length,
    // 3回以上参照されたrefは「使い回され気味」の目安（上位20件のみ。プロンプト肥大化防止）
    overusedRefs: refFrequency.filter(([, n]) => n >= 3).slice(0, 20).map(([ref, count]) => ({ ref, count })),
  };
}
