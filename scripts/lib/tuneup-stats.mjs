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
 * ごみ箱（TOPの/api/trash。弱化シグナル: ユーザーが関心なしとしてごみ箱に入れた事例）の分布計算
 * （分析パス1「リサーチ計画」の入力素材）。trashedIdsの抽出はfavoriteIds()を再利用する
 * （/api/trashのレスポンス形状はfavoritesと同じ{items:{id:{fav,ts}}}で、fav:true=ごみ箱行きの
 * 意味も共通のため）。
 */
export function computeTrashStats({ trashedIds, cases }) {
  const trashedSet = new Set(trashedIds);
  const trashedCases = cases.filter((c) => trashedSet.has(c.id));
  return {
    trashedCaseCount: trashedCases.length,
    totalCaseCount: cases.length,
    caseTagDistributionTrashed: tally(trashedCases, (c) => c.tags),
    caseCategoryDistributionTrashed: tally(trashedCases, (c) => c.categories),
    caseSourcesDistributionTrashed: tally(trashedCases, (c) => c.sources),
    trashedCases: trashedCases.map((c) => ({
      id: c.id,
      title: c.title,
      tags: c.tags || [],
      categories: c.categories || [],
      year: c.year,
    })),
  };
}

/**
 * ユーザーがLINE経由で自ら登録した事例（cases.json内 sources:["User"]。強化シグナル: 明確な
 * 関心の表明）の分布計算（分析パス1「リサーチ計画」の入力素材）。
 */
export function computeUserCaseStats({ cases }) {
  const userCases = cases.filter((c) => (c.sources || []).includes("User"));
  return {
    userCaseCount: userCases.length,
    caseTagDistributionUser: tally(userCases, (c) => c.tags),
    caseCategoryDistributionUser: tally(userCases, (c) => c.categories),
    userCases: userCases.map((c) => ({
      id: c.id,
      title: c.title,
      tags: c.tags || [],
      categories: c.categories || [],
      year: c.year,
    })),
  };
}

/**
 * Pearson相関係数。nが2未満、またはいずれかの系列の分散が0（全件同値）の場合はnull
 * （相関が定義できない/NaNになるのを避けるため。呼び出し側はnullを「判定不能」として扱う）。
 */
function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

/**
 * アイデア評価シグナル（GET /api/idea-likes＝強化・GET /api/idea-trash＝弱化）とdata/ideas.jsonを
 * 結合した分布計算（分析パス2「アイデア構造見直し」の入力素材）。
 * - パターン(pattern)別のいいね/ゴミ箱分布
 * - refs先（cases.jsonのtags / tech.jsonのdomains）のいいね/ゴミ箱分布
 * - scores（{discovery,surprise,conviction}。2026-07-16以降のideaにのみ存在しうる）といいね/
 *   ゴミ箱フラグとのPearson相関係数（-1〜1。scoresを持つideaが2件未満、または分散0の次元はnull）
 */
export function computeIdeaFeedbackStats({ likedIds, trashedIds, ideas, cases, tech }) {
  const likedSet = new Set(likedIds || []);
  const trashedSet = new Set(trashedIds || []);
  const caseTagsById = new Map((cases || []).map((c) => [c.id, c.tags || []]));
  const techDomainsById = new Map((tech || []).map((t) => [t.id, t.domains || []]));

  const patternLikeCounts = {};
  const patternTrashCounts = {};
  const refTagLikeCounts = {};
  const refTagTrashCounts = {};
  let likedIdeaCount = 0;
  let trashedIdeaCount = 0;

  for (const idea of ideas || []) {
    const isLiked = likedSet.has(idea.id);
    const isTrashed = trashedSet.has(idea.id);
    if (isLiked) likedIdeaCount++;
    if (isTrashed) trashedIdeaCount++;
    if (idea.pattern) {
      if (isLiked) patternLikeCounts[idea.pattern] = (patternLikeCounts[idea.pattern] || 0) + 1;
      if (isTrashed) patternTrashCounts[idea.pattern] = (patternTrashCounts[idea.pattern] || 0) + 1;
    }
    if (isLiked || isTrashed) {
      for (const ref of idea.refs || []) {
        const tags = ref.type === "case" ? caseTagsById.get(ref.id) : ref.type === "tech" ? techDomainsById.get(ref.id) : undefined;
        if (!tags) continue;
        for (const tag of tags) {
          if (isLiked) refTagLikeCounts[tag] = (refTagLikeCounts[tag] || 0) + 1;
          if (isTrashed) refTagTrashCounts[tag] = (refTagTrashCounts[tag] || 0) + 1;
        }
      }
    }
  }

  const scoredIdeas = (ideas || []).filter((i) => i.scores && typeof i.scores === "object");
  let scoreCorrelations = null;
  if (scoredIdeas.length >= 2) {
    const likedFlags = scoredIdeas.map((i) => (likedSet.has(i.id) ? 1 : 0));
    const trashedFlags = scoredIdeas.map((i) => (trashedSet.has(i.id) ? 1 : 0));
    scoreCorrelations = {};
    for (const dim of ["discovery", "surprise", "conviction"]) {
      // scores[dim]が非数値(undefined・不正な文字列等)のideaが混じっていても、そのideaだけを
      // 除外してから相関を計算する（Number()がNaNになる値がpearsonCorrelationの積算に混入し、
      // ペア全体の相関係数がNaN汚染されるのを避けるため。n<2/分散0→nullという既存ポリシーは
      // pearsonCorrelation側の判定にそのまま委ねる）。
      const validLikedFlags = [];
      const validTrashedFlags = [];
      const validValues = [];
      scoredIdeas.forEach((idea, idx) => {
        const value = Number(idea.scores[dim]);
        if (!Number.isFinite(value)) return;
        validLikedFlags.push(likedFlags[idx]);
        validTrashedFlags.push(trashedFlags[idx]);
        validValues.push(value);
      });
      scoreCorrelations[dim] = {
        withLiked: pearsonCorrelation(validLikedFlags, validValues),
        withTrashed: pearsonCorrelation(validTrashedFlags, validValues),
      };
    }
  }

  return {
    likedIdeaCount,
    trashedIdeaCount,
    patternLikeCounts,
    patternTrashCounts,
    refTagLikeCounts,
    refTagTrashCounts,
    scoredIdeaCount: scoredIdeas.length,
    scoreCorrelations,
  };
}

/**
 * favoritesのendpointから/api/idea-likesのendpointを機械的に導出する。deriveTrashEndpointと同じ
 * 流儀（末尾/api/favorites[/]の置換。overrideがあれば常にそちらを優先し、置換不発＝非標準URLは
 * 導出失敗としてnullを返す）。
 */
export function deriveIdeaLikesEndpoint(favoritesEndpoint, override) {
  if (override) return override;
  const source = favoritesEndpoint || "";
  const derived = source.replace(/\/api\/favorites(\/)?$/, "/api/idea-likes$1");
  return derived === source ? null : derived;
}

/** favoritesのendpointから/api/idea-trashのendpointを機械的に導出する（deriveIdeaLikesEndpointと同じ流儀）。 */
export function deriveIdeaTrashEndpoint(favoritesEndpoint, override) {
  if (override) return override;
  const source = favoritesEndpoint || "";
  const derived = source.replace(/\/api\/favorites(\/)?$/, "/api/idea-trash$1");
  return derived === source ? null : derived;
}

/**
 * favoritesのendpointから/api/trashのendpointを機械的に導出する（末尾が/api/favorites[/]の形を
 * /api/trash[/]へ置換）。favsyncConfig.trashEndpointが明示されていればそちらを常に優先する
 * （設定ファイルでの上書きを許す。既存の~/.researchman-favsync.jsonの流儀を壊さない後方互換のため）。
 * favoritesEndpointが末尾/api/favorites[/]の形にマッチしない（非標準URL）場合は置換が不発になり
 * favoritesEndpointの文字列がそのまま返ってしまう。これを「導出失敗」として黙って見逃すと、
 * 呼び出し側がfavoritesのレスポンスをtrash（弱化シグナル）として誤集計する危険があるため、
 * 置換が実際に起きなかった場合はnullを返し、導出不可を明示する。
 */
export function deriveTrashEndpoint(favoritesEndpoint, trashEndpointOverride) {
  if (trashEndpointOverride) return trashEndpointOverride;
  const source = favoritesEndpoint || "";
  const derived = source.replace(/\/api\/favorites(\/)?$/, "/api/trash$1");
  return derived === source ? null : derived;
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
