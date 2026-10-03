/**
 * 隔週チューンアップの Exhibition 対応（SPEC §8 tuneup）。純関数。LLM は使わず決定論で提案する
 * （プロファイルの暴走を機械的に抑えるため。ガードレールも同ファイルで機械検証する）。
 *
 *  - computeExhibitionStats: お気に入り(重み1)・intake 投稿(重み2=お気に入りの2倍)・ごみ箱の分布
 *  - proposeExhibitionProfile: 提案対象は data/exhibition-profile.json の
 *      likes.themes[].weight / watch.artists・venues（intake 成功の作家・会場を追加） / scoring.threshold.add のみ
 *  - checkExhibitionProfileChange: 上記以外（exclusions.hard・collectAll を含む）の変更は拒否＝自動変更禁止
 */

export const EXHIBITION_GUARDRAIL_LIMITS = {
  themeWeightMin: 1,
  themeWeightMax: 5,
  themeWeightChangesMax: 3,
  watchAdditionsMax: 5,
  thresholdAddMin: 55,
  thresholdAddMax: 80,
  thresholdAddStepMax: 5,
};

// タグ → likes.themes[].key（weight 提案用）
const TAG_TO_THEME = {
  media_art: "media_art",
  video_art: "media_art",
  sound: "media_art",
  generative: "generative_onchain",
  onchain: "generative_onchain",
  light: "light_space",
  glass: "light_space",
  installation: "light_space",
  kinetic: "kinetic",
  ai_media_art: "ai_media_art",
  design_archive: "design_archive",
  graphic_design: "design_archive",
  architecture: "design_archive",
};

const scoreBand = (s) => (s >= 80 ? "80-100" : s >= 70 ? "70-79" : s >= 60 ? "60-69" : "0-59");
const bump = (map, k, w) => {
  if (k) map[k] = (map[k] || 0) + w;
};

/**
 * @param {{favIds:string[], trashedIds:string[], items:object[]}} p  items は exhibition.json の items
 */
export function computeExhibitionStats({ favIds, trashedIds, items }) {
  const fav = new Set(favIds || []);
  const trash = new Set(trashedIds || []);
  const stats = { favoriteCount: 0, intakeCount: 0, trashedCount: 0, tags: {}, venueTypes: {}, prefectures: {}, scoreBands: {}, trashRate: 0 };
  let positive = 0;
  for (const it of items || []) {
    const isIntake = it.origin === "intake";
    const w = (fav.has(it.id) ? 1 : 0) + (isIntake ? 2 : 0);
    if (fav.has(it.id)) stats.favoriteCount++;
    if (isIntake) stats.intakeCount++;
    if (trash.has(it.id)) stats.trashedCount++;
    if (w > 0) {
      positive++;
      for (const t of it.tags || []) bump(stats.tags, t, w);
      bump(stats.venueTypes, it.venueType, w);
      bump(stats.prefectures, it.prefecture, w);
      bump(stats.scoreBands, scoreBand(it.score), w);
    }
  }
  const denom = positive + stats.trashedCount;
  stats.trashRate = denom ? Math.round((stats.trashedCount / denom) * 100) / 100 : 0;
  return stats;
}

const hasName = (list, name) => list.some((x) => x === name || x.includes(name) || name.includes(x));

/**
 * 決定論の提案。入力は変更しない。
 */
export function proposeExhibitionProfile(profile, stats, items) {
  const next = structuredClone(profile);
  const L = EXHIBITION_GUARDRAIL_LIMITS;

  // intake 成功（origin=intake）の作家・会場を watch へ追加
  const intakeItems = (items || []).filter((i) => i.origin === "intake");
  const addTo = (list, candidates) => {
    let added = 0;
    for (const c of candidates) {
      if (added >= L.watchAdditionsMax) break;
      if (c && !hasName(list, c)) {
        list.push(c);
        added++;
      }
    }
  };
  addTo(next.watch.artists, intakeItems.flatMap((i) => i.artists || []));
  addTo(next.watch.venues, intakeItems.map((i) => i.venue));

  // ごみ箱率が高ければ add 閾値を引き上げ（5件以上・50%以上）
  if (stats.trashedCount >= 5 && stats.trashRate >= 0.5) {
    next.scoring.threshold.add = Math.min(L.thresholdAddMax, Math.min(profile.scoring.threshold.add + L.thresholdAddStepMax, L.thresholdAddMax));
  }

  // 支配的なタグのテーマ重みを +1（正シグナル合計5以上・最大シェア40%以上）
  const total = Object.values(stats.tags).reduce((a, b) => a + b, 0);
  if (total >= 5) {
    const themeWeights = {};
    for (const [tag, w] of Object.entries(stats.tags)) bump(themeWeights, TAG_TO_THEME[tag], w);
    const [topKey, topW] = Object.entries(themeWeights).sort((a, b) => b[1] - a[1])[0] || [];
    if (topKey && topW / total >= 0.4) {
      const theme = next.likes.themes.find((t) => t.key === topKey);
      if (theme && theme.weight < L.themeWeightMax) theme.weight += 1;
    }
  }

  if (JSON.stringify(next) !== JSON.stringify(profile)) next.updatedAt = new Date().toISOString().slice(0, 10);
  return next;
}

/** 許可された提案対象フィールドを無効化したコピー（それ以外が不変かの比較用）。 */
function neutralize(p) {
  const c = structuredClone(p);
  for (const t of c.likes?.themes || []) t.weight = null;
  if (c.watch) {
    c.watch.artists = null;
    c.watch.venues = null;
  }
  if (c.scoring?.threshold) c.scoring.threshold.add = null;
  delete c.updatedAt;
  return c;
}

/**
 * @returns {{ok:boolean, errors:string[], weightChanges:number}}
 */
export function checkExhibitionProfileChange(oldProfile, newProfile) {
  const L = EXHIBITION_GUARDRAIL_LIMITS;
  const errors = [];
  if (!newProfile || typeof newProfile !== "object") return { ok: false, errors: ["profile must be an object"], weightChanges: 0 };

  if (JSON.stringify(neutralize(oldProfile)) !== JSON.stringify(neutralize(newProfile))) {
    errors.push("disallowed change: only likes.themes[].weight / watch.artists,venues / scoring.threshold.add may change (exclusions.hard・collectAll は自動変更禁止)");
  }

  const oldThemes = oldProfile.likes?.themes || [];
  const newThemes = newProfile.likes?.themes || [];
  let weightChanges = 0;
  for (const nt of newThemes) {
    if (!Number.isInteger(nt.weight) || nt.weight < L.themeWeightMin || nt.weight > L.themeWeightMax) {
      errors.push(`theme weight out of range [${L.themeWeightMin},${L.themeWeightMax}]: ${nt.key}=${nt.weight}`);
    }
    const ot = oldThemes.find((t) => t.key === nt.key);
    if (ot && ot.weight !== nt.weight) weightChanges++;
  }
  if (weightChanges > L.themeWeightChangesMax) errors.push(`theme weight changes exceed limit (${weightChanges} > ${L.themeWeightChangesMax})`);

  for (const key of ["artists", "venues"]) {
    const o = oldProfile.watch?.[key] || [];
    const n = newProfile.watch?.[key];
    if (!Array.isArray(n)) {
      errors.push(`watch.${key} must be an array`);
      continue;
    }
    for (const x of o) if (!n.includes(x)) errors.push(`watch.${key} removal not allowed: ${x}`);
    const addedCount = n.filter((x) => !o.includes(x)).length;
    if (addedCount > L.watchAdditionsMax) errors.push(`watch.${key} additions exceed limit (${addedCount} > ${L.watchAdditionsMax})`);
  }

  const oa = oldProfile.scoring?.threshold?.add;
  const na = newProfile.scoring?.threshold?.add;
  if (!Number.isInteger(na) || na < L.thresholdAddMin || na > L.thresholdAddMax) {
    errors.push(`scoring.threshold.add out of range [${L.thresholdAddMin},${L.thresholdAddMax}]: ${na}`);
  } else if (Math.abs(na - oa) > L.thresholdAddStepMax) {
    errors.push(`scoring.threshold.add change exceeds ${L.thresholdAddStepMax}: ${oa} -> ${na}`);
  }

  return { ok: errors.length === 0, errors, weightChanges };
}
