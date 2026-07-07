/**
 * 重み付き非復元抽出（generate-idea-seeds.mjsのCase Study/Technologyサンプリング用）。
 *
 * data/idea-tuning.json の samplingWeights（既定は全キー1.0）を選択確率に反映する。
 * 挙動不変の担保: 全アイテムの重みが1のときは、従来の Fisher-Yates シャッフル＋slice と
 * **全く同じコード** を通す（重み付き経路には一切入らない）。これにより既定設定
 * （samplingWeights: {caseTags:{}, techDomains:{}}）では旧実装とアルゴリズムレベルで同一になる
 * ことを保証する（バッチ2a リファクタの「挙動不変」要件）。
 */

/**
 * アイテムのタグ/ドメイン配列から重みを計算する。
 * 複数タグがある場合は各タグの重みを掛け合わせる（未指定タグは1.0扱い）。
 * タグ/ドメインが空配列・未定義なら1.0。
 * @param {string[]|undefined} keys アイテムの tags または domains
 * @param {Record<string, number>} weightMap キー→倍率（既定オブジェクトは空={}=全1.0）
 */
export function computeItemWeight(keys, weightMap) {
  if (!keys || !keys.length || !weightMap) return 1;
  let w = 1;
  for (const k of keys) {
    const v = weightMap[k];
    if (typeof v === "number" && Number.isFinite(v)) w *= v;
  }
  return w;
}

/**
 * 重み配列に基づく非復元抽出。weights が未指定、または全アイテムの重みが1のときは
 * 従来のFisher-Yatesシャッフル（挙動不変・同一コード経路）。
 * それ以外は「残りプールから重み比例で1件ずつ選び除外する」ルーレット選択を繰り返す。
 * @param {any[]} arr 抽出元配列
 * @param {number} n 抽出件数
 * @param {number[]} [weights] arr と同じ長さの重み配列（省略時は一様ランダム）
 */
export function weightedSample(arr, n, weights = null) {
  const allUnitWeight = !weights || weights.every((w) => w === 1);
  if (allUnitWeight) {
    // 既存の sample() と完全同一（挙動不変の要）
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }
  const pool = arr.map((item, i) => ({ item, w: weights[i] > 0 ? weights[i] : 0 }));
  const picked = [];
  for (let k = 0; k < n && pool.length; k++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    if (total <= 0) {
      // 残り全員の重みが0（理論上は起きないが防御）: 先頭から順に採用
      picked.push(pool.shift().item);
      continue;
    }
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    picked.push(pool.splice(idx, 1)[0].item);
  }
  return picked;
}
