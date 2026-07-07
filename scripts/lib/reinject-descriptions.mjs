/**
 * biweekly-tuneup.mjs 用: Claude CLIが返した改訂案JSONに、旧設定の `_description`
 * （スキーマの説明コメント相当フィールド）を再注入する。プロンプトの出力例には
 * `_description` を含めていないため、LLM出力はこれを落として返しがち。値そのものには
 * 一切手を触れず、`_description` キーの有無だけを旧設定から復元する。
 *
 * キー順は旧オブジェクト（oldObj）の並びを保持する（先に oldObj のキー順で埋め、
 * newObj にしか無いキーだけを末尾に追加）。`{ ...newObj, _description: ... }` のように
 * 末尾へ追記すると `_description` が本来の先頭位置から末尾へ移動してしまい、
 * JSON.stringify の出力が丸ごと変わって見え、実運用のgit diffが「全体書き換え」に
 * 見えてしまう（2026-07-08 実機テストで発生した実バグ。再発防止のため必ずキー順を保つ）。
 */
export function reinjectDescriptions(oldObj, newObj) {
  if (Array.isArray(newObj) || !newObj || typeof newObj !== "object") return newObj;
  const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  const oldKeys = isPlainObject(oldObj) ? Object.keys(oldObj) : [];
  const result = {};

  for (const key of oldKeys) {
    if (key === "_description") {
      result._description = oldObj._description;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(newObj, key)) {
      result[key] = reinjectDescriptions(oldObj[key], newObj[key]);
    }
    // oldにしかない実質キー（_description以外）はここでは復元しない。
    // ガードレール（必須キー検証）はこの関数の呼び出し前に通過済みの前提であり、
    // 想定外の欠落を静かに埋め戻すと古い値がこっそり生き残る事故になりうるため
  }
  for (const key of Object.keys(newObj)) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = newObj[key];
    }
  }
  return result;
}
