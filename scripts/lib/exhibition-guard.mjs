/**
 * Exhibition 日次ジョブの commit 前ガード（push 滞留事故の再発防止）。
 * 監査（audit-exhibition.mjs）に落ちるデータを commit すると pre-push で全 push が止まるため、
 * commit 前に同じ監査を走らせ、落ちたら作業ツリーを元に戻して commit しない。
 */

/** 失敗 run の作業ツリー復元。追跡ファイルは checkout、新規サムネ（未追跡）だけ clean で除去する。 */
export const EXHIBITION_REVERT_GIT_ARGS = [
  ["checkout", "--", "data/exhibition.json"],
  ["clean", "-fd", "public/thumbnails/exhibition"],
];

/**
 * 通過したときだけ onPass を呼ぶ（intake の PATCH・保留リスト更新など、巻き戻せない確定処理をここに置く）。
 * @param {{audit:()=>{status:number|null}, revert:()=>void, onPass?:()=>unknown}} p
 * @returns {{ok:true}|{ok:false, status:number|null}}
 */
export function guardAudit({ audit, revert, onPass }) {
  const r = audit();
  if (r && r.status === 0) {
    if (onPass) onPass();
    return { ok: true };
  }
  revert();
  return { ok: false, status: r ? r.status : null };
}
