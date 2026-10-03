/**
 * Exhibition 通知の priority 判定（SPEC ユーザー確定: 70点以上=routine(23:45ダイジェスト)、80点以上(highlight)を含む回のみ critical）。
 * summary は auto-research-exhibition.mjs が書く {count, cases:[{score,highlight}], unverified?}。
 */
export const NOTIFY_THRESHOLD = 70;

/**
 * @param {{count?:number, cases?:{score?:number, highlight?:boolean}[], unverified?:object[]}} summary
 * @returns {{send:boolean, priority:"routine"|"critical", reason:string}}
 */
export function decideExhibitionNotify(summary) {
  const cases = summary?.cases || [];
  if (!cases.length) return { send: true, priority: "routine", reason: "新規追加なし（ダイジェスト用）" };
  if (cases.some((c) => c.highlight || (c.score ?? 0) >= 80)) return { send: true, priority: "critical", reason: "highlight(80点以上)を含む" };
  if (cases.some((c) => (c.score ?? 0) >= NOTIFY_THRESHOLD)) return { send: true, priority: "routine", reason: "70点以上の新着" };
  if ((summary.unverified || []).length) return { send: true, priority: "routine", reason: "裏取り待ちあり" };
  return { send: false, priority: "routine", reason: "追加はあるが全て70点未満（通知対象外）" };
}

/**
 * push 済みだが verify-deploy が時間切れの通知 priority。
 * 0件追加の回は急ぎの情報が無い（反映遅延は次回確認で足りる）ため routine、追加ありは従来どおり critical。
 */
export function decideDeployTimeoutPriority(summary) {
  return (summary?.cases || []).length ? "critical" : "routine";
}
