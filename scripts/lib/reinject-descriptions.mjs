/**
 * biweekly-tuneup.mjs 用: Claude CLIが返した改訂案JSONに、旧設定の `_description`
 * （スキーマの説明コメント相当フィールド）を再注入する。プロンプトの出力例には
 * `_description` を含めていないため、LLM出力はこれを落として返しがち。値そのものには
 * 一切手を触れず、`_description` キーの有無だけを旧設定から復元する。
 */
export function reinjectDescriptions(oldObj, newObj) {
  if (Array.isArray(newObj) || !newObj || typeof newObj !== "object") return newObj;
  const result = { ...newObj };
  if (oldObj && typeof oldObj === "object" && oldObj._description !== undefined) {
    result._description = oldObj._description;
  }
  for (const key of Object.keys(newObj)) {
    if (oldObj && typeof oldObj[key] === "object") {
      result[key] = reinjectDescriptions(oldObj[key], newObj[key]);
    }
  }
  return result;
}
